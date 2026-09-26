import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as kktix from "./adapters/kktix.mjs";
import * as tixcraft from "./adapters/tixcraft.mjs";
import * as indievox from "./adapters/indievox.mjs";
import * as fansi from "./adapters/fansi.mjs";
import * as ticketplus from "./adapters/ticketplus.mjs";
import * as billboard from "./adapters/billboard.mjs";
import * as ibon from "./adapters/ibon.mjs";
import * as opentix from "./adapters/opentix.mjs";
import * as kham from "./adapters/kham.mjs";
import * as era from "./adapters/era.mjs";
import * as manual from "./adapters/manual.mjs";
import { loadArtists, loadVenues, normalize } from "./normalize.mjs";
import { dedupe } from "./dedup.mjs";
import { groupRuns } from "./runs.mjs";
import { diff } from "./diff.mjs";
import { resetProgressLog, logProgress } from "./progress-log.mjs";
import { notifySourceAnomaly } from "./notify.mjs";
import { classifySourceRun } from "./source-status.mjs";
import { fallbackEventsForSource, fallbackReviewItemsForSource } from "./source-fallback.mjs";
import { refreshedStatus, combineSaleSignals } from "./sale-signal.mjs";
import { acquireRunLock } from "./run-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const adapters = [kktix, tixcraft, indievox, fansi, ticketplus, billboard, ibon, opentix, kham, era, manual];

function loadPreviousEvents() {
  try {
    const raw = readFileSync(path.join(DATA_DIR, "events.json"), "utf-8");
    return JSON.parse(raw).events ?? [];
  } catch {
    return []; // first run ever, or the file is missing/corrupt — treat everything as new.
  }
}

function loadPreviousSources() {
  try {
    const raw = readFileSync(path.join(DATA_DIR, "sources.json"), "utf-8");
    return JSON.parse(raw).sources ?? [];
  } catch {
    return [];
  }
}

function loadPreviousNeedsReview() {
  try {
    const raw = readFileSync(path.join(DATA_DIR, "needs-review.json"), "utf-8");
    return JSON.parse(raw).items ?? [];
  } catch {
    return [];
  }
}

/**
 * 2026-09-18, incremental fetch: {sourceName -> Set<raw_id>} for every event
 * that was ALREADY successfully recognized last run. Deliberately built only
 * from previousEvents, never from needs-review items — a needs-review raw_id
 * must always be re-fetched and re-normalized on every run, since that's the
 * exact mechanism that lets adding an artist to artists.yml later promote a
 * previously-unrecognized title into a real event. Treating it as "already
 * known, skip" would silently break that workflow forever for that item.
 */
function buildKnownRawIdsBySource(previousEvents) {
  const map = new Map();
  for (const event of previousEvents) {
    // D15 reversal (2026-09-21): an unrecognized-artist event still lands in
    // events.json (see normalize.mjs) instead of being blocked, but it must
    // NOT count as "known" here — otherwise, once its artist is later added
    // to artists.yml, incremental fetch would keep reusing this stale
    // headliners:[] copy forever instead of ever re-normalizing it against
    // the updated artist list. Only a successfully-classified event benefits
    // from the incremental-fetch skip; an unclassified one keeps getting
    // fetched fresh every run until it resolves.
    if (event.headliners.length === 0) continue;
    for (const source of event.sources) {
      if (!map.has(source.name)) map.set(source.name, new Map());
      // Carries the previous run's status, not just "seen before" — KKTIX
      // uses it to skip register_info checks that can't change anything
      // (see needsRegisterCheck in kktix.mjs). Every other adapter only ever
      // calls .has(), which a Map supports the same as the Set this used to be.
      map.get(source.name).set(source.raw_id, { status: event.status, on_sale_at: event.on_sale_at });
    }
  }
  return map;
}

/**
 * Runs one adapter end-to-end (fetch -> status classification -> fallback on
 * anomaly -> per-event normalize), fully self-contained so it can run
 * concurrently with the other adapters below. Never throws — every failure
 * mode (adapter.fetch() itself, notifySourceAnomaly, a single malformed raw
 * event) is caught internally, same isolation the old sequential loop had,
 * just scoped to a function instead of loop iterations.
 */
async function runAdapter(adapter, context) {
  const { artistsYml, venuesYml, previousSources, previousEvents, previousNeedsReview, knownRawIdsBySource } = context;

  logProgress(`=== starting adapter: ${adapter.name} ===`);
  let rawEvents = [];
  let error = null;
  try {
    rawEvents = await adapter.fetch(knownRawIdsBySource.get(adapter.name) ?? new Map());
  } catch (err) {
    error = err.message;
    logProgress(`${adapter.name} fetch() threw: ${err.stack}`);
  }
  logProgress(`=== finished adapter: ${adapter.name}, ${rawEvents.length} raw event(s) ===`);

  const previous = previousSources.find((s) => s.name === adapter.name);
  const { entry, anomaly } = classifySourceRun(adapter.name, { error, rawCount: rawEvents.length }, previous);
  // Written into sources.json (committed), so a run on another machine — the
  // scheduled liveradar-daily-fetch — can be inspected after a git pull
  // without making any extra requests from here.
  if (typeof adapter.runStats === "function") {
    entry.stats = adapter.runStats();
    logProgress(`${adapter.name} stats: ${JSON.stringify(entry.stats)}`);
  }

  const normalizedEvents = [];
  const needsReview = [];

  if (anomaly) {
    // AC-11/SPEC §4.2 step 3: don't let a blocked/broken source erase its
    // share of real data — reuse what it contributed last run instead.
    // rawEvents is always [] here (both the "threw" and "0 results" cases
    // leave it empty), so there's nothing from this run to lose by doing so.
    const fallbackEvents = fallbackEventsForSource(previousEvents, adapter.name);
    const fallbackReview = fallbackReviewItemsForSource(previousNeedsReview, adapter.name);
    logProgress(
      `${adapter.name}: ${anomaly.reason}, reusing ${fallbackEvents.length} previous event(s) and ${fallbackReview.length} previous needs-review item(s)`
    );
    normalizedEvents.push(...fallbackEvents);
    needsReview.push(...fallbackReview);

    try {
      await notifySourceAnomaly({ name: adapter.name, ...anomaly });
    } catch (err) {
      logProgress(`notifySourceAnomaly failed for ${adapter.name}: ${err.stack}`);
    }
  }

  // 2026-09-18, incremental fetch: an adapter marks an already-known event's
  // raw entry with reuse_previous instead of re-fetching its expensive detail
  // page (see e.g. tixcraft.mjs) — reuse its previous normalized data outright
  // rather than re-running normalize() on the deliberately-incomplete stub.
  const reuseRawIds = new Set();
  const reuseSignals = new Map(); // raw_id -> { sale_signal, on_sale_at } (see sale-signal.mjs)
  const freshRawEvents = [];
  for (const raw of rawEvents) {
    if (raw.reuse_previous) {
      reuseRawIds.add(raw.raw_id);
      if (raw.sale_signal !== undefined) reuseSignals.set(raw.raw_id, raw);
    } else {
      freshRawEvents.push(raw);
    }
  }
  if (reuseRawIds.size > 0) {
    const reused = fallbackEventsForSource(previousEvents, adapter.name, reuseRawIds);
    // 2026-09-24: reused data used to keep its status forever. Apply the
    // adapter's fresh sale signal (if it checked one) — see sale-signal.mjs.
    let statusChanged = 0;
    for (const event of reused) {
      // 2026-09-25 real bug: a merged card can carry a fresh signal on MORE
      // THAN ONE of its sources this run (e.g. a VIP tier + a plain tier,
      // each their own KKTIX raw_id) — only checking sources[0] meant
      // whichever tier happened to be listed first decided the whole card's
      // status, even when a different tier's signal was the accurate one.
      const signal = combineSaleSignals(event.sources.map((s) => reuseSignals.get(s.raw_id)));
      const next = refreshedStatus(event, signal?.sale_signal ?? null, signal?.on_sale_at ?? null);
      if (!next) continue;
      logProgress(`${adapter.name}: status ${event.status} -> ${next.status}: ${event.title_raw}`);
      Object.assign(event, next, { updated_at: new Date().toISOString() });
      statusChanged += 1;
    }
    normalizedEvents.push(...reused);
    logProgress(
      `${adapter.name}: reused ${reused.length} already-known event(s) without re-fetching detail, ` +
        `${reuseSignals.size} status-checked, ${statusChanged} status change(s)`,
    );
  }

  for (const raw of freshRawEvents) {
    // A single malformed record must never take down the whole run — every
    // other successfully-scraped event (and this run's writes) would be
    // lost with it (found in review: this loop had no isolation at all).
    try {
      const result = normalize(raw, artistsYml, venuesYml);
      if (result.event) {
        normalizedEvents.push(result.event);
        // D15 reversal (2026-09-21): the event still shows even with no
        // recognized headliner (see normalize.mjs), but it's still logged
        // here as an enrichment backlog item — something should look this
        // artist up and add it to artists.yml so future events get proper
        // tags_origin/exclude-by-artist support, it just no longer blocks
        // this event from being visible in the meantime.
        // A theater/musical listing (rawEvent.category set) is never held
        // for artist assignment — a production/theater-company name isn't
        // an "artist" artists.yml tracks, and there are enough of these
        // (PLAN-1-theater-runs.md) to flood the review queue with entries
        // nobody is ever going to resolve.
        if (result.event.headliners.length === 0 && !result.event.category) {
          needsReview.push({
            raw_id: raw.raw_id,
            title_raw: raw.title_raw ?? null,
            url: raw.url ?? null,
            source: raw.source_name,
            reason: "artist_unrecognized",
            detail: null,
          });
        }
      } else if (result.needsReview) {
        needsReview.push(result.needsReview);
      } else {
        // result.excluded: confirmed non-music noise or a junk scrape —
        // deliberately dropped, not written to events.json OR needs-review.json.
        logProgress(`${adapter.name}: excluded (${result.excluded.reason}): ${result.excluded.title_raw}`);
      }
    } catch (err) {
      logProgress(`normalize() threw for raw_id=${raw.raw_id}: ${err.stack}`);
      needsReview.push({
        raw_id: raw.raw_id,
        title_raw: raw.title_raw ?? null,
        url: raw.url ?? null,
        source: raw.source_name,
        reason: "normalize_error",
        detail: err.message,
      });
    }
  }

  return { entry, normalizedEvents, needsReview };
}

async function main() {
  acquireRunLock("npm run fetch");
  resetProgressLog();
  const artistsYml = loadArtists();
  const venuesYml = loadVenues();
  const previousEvents = loadPreviousEvents();
  const previousSources = loadPreviousSources();
  const previousNeedsReview = loadPreviousNeedsReview();
  const knownRawIdsBySource = buildKnownRawIdsBySource(previousEvents);
  const context = { artistsYml, venuesYml, previousSources, previousEvents, previousNeedsReview, knownRawIdsBySource };

  // Each adapter only paces requests against its OWN source (NFR-04) — there's
  // no shared rate limit between, say, tixcraft and iNDIEVOX, so there's no
  // politeness reason to make them wait for each other. Running all 5
  // concurrently instead of one-after-another was the single biggest lever
  // for cutting the "重新抓取" button's wall-clock time: it used to be bounded
  // by the SUM of every adapter's own time, now it's bounded by whichever one
  // is slowest (2026-09-18, see HANDOFF.md for measured before/after).
  // allSettled, not all: runAdapter() already catches every failure mode it
  // knows about and never rethrows, but if something genuinely unexpected
  // still throws (a bug in classifySourceRun, say), that must not also wipe
  // out the other four adapters' already-successful results.
  const settled = await Promise.allSettled(adapters.map((adapter) => runAdapter(adapter, context)));

  const sourcesStatus = [];
  const normalizedEvents = [];
  const needsReview = [];
  for (let i = 0; i < adapters.length; i++) {
    const adapter = adapters[i];
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      sourcesStatus.push(outcome.value.entry);
      normalizedEvents.push(...outcome.value.normalizedEvents);
      needsReview.push(...outcome.value.needsReview);
    } else {
      logProgress(`${adapter.name}: runAdapter() itself threw unexpectedly: ${outcome.reason?.stack ?? outcome.reason}`);
      const previous = previousSources.find((s) => s.name === adapter.name);
      const { entry } = classifySourceRun(adapter.name, { error: String(outcome.reason), rawCount: 0 }, previous);
      sourcesStatus.push(entry);
    }
  }

  // groupRuns() before dedupe(): collapses same-production/same-venue
  // theater listings into one many-sessions card first (PLAN-1-theater-runs.md),
  // so dedupe()'s cross-source merge and day/evening time-bucket splitting
  // never see the individual per-performance events at all.
  const grouped = groupRuns(normalizedEvents);
  const deduped = dedupe(grouped);
  const { events, digest } = diff(previousEvents, deduped);

  // 2026-09-22 real bug: a single adapter run can legitimately produce the
  // same raw event twice within itself — e.g. KKTIX's org-page and
  // search-venue strategies (§5.1) both covering the same org, or a
  // fallback-reuse run (source-fallback.mjs) re-adding an item a fresh
  // strategy also just found. dedupe() above only dedupes recognized
  // events across sources; needsReview never went through any dedup, so the
  // exact same "指派藝人" item showed up twice in review.html (found live:
  // 陳如山「那些我賣不出去的歌」城市小巡迴). Keyed on (source, raw_id), same
  // identity KKTIX itself uses for a listing.
  const seenReviewKeys = new Set();
  const dedupedNeedsReview = needsReview.filter((item) => {
    const key = `${item.source}::${item.raw_id}`;
    if (seenReviewKeys.has(key)) return false;
    seenReviewKeys.add(key);
    return true;
  });

  writeFileSync(
    path.join(DATA_DIR, "events.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), events }, null, 2) + "\n"
  );
  writeFileSync(path.join(DATA_DIR, "digest.json"), JSON.stringify(digest, null, 2) + "\n");
  writeFileSync(
    path.join(DATA_DIR, "needs-review.json"),
    JSON.stringify({ items: dedupedNeedsReview }, null, 2) + "\n"
  );
  writeFileSync(
    path.join(DATA_DIR, "sources.json"),
    JSON.stringify({ sources: sourcesStatus }, null, 2) + "\n"
  );

  console.log(
    `LiveRadar fetch complete: ${events.length} recognized event(s) (${digest.added_ids.length} new, ${digest.updated.length} updated), ${dedupedNeedsReview.length} needing review.`
  );
}

main();
