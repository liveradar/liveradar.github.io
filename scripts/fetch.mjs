import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as kktix from "./adapters/kktix.mjs";
import * as tixcraft from "./adapters/tixcraft.mjs";
import * as indievox from "./adapters/indievox.mjs";
import * as fansi from "./adapters/fansi.mjs";
import * as ticketplus from "./adapters/ticketplus.mjs";
import * as manual from "./adapters/manual.mjs";
import { loadArtists, loadVenues, normalize } from "./normalize.mjs";
import { dedupe } from "./dedup.mjs";
import { diff } from "./diff.mjs";
import { resetProgressLog, logProgress } from "./progress-log.mjs";
import { notifySourceAnomaly } from "./notify.mjs";
import { classifySourceRun } from "./source-status.mjs";
import { fallbackEventsForSource, fallbackReviewItemsForSource } from "./source-fallback.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const adapters = [kktix, tixcraft, indievox, fansi, ticketplus, manual];

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
    for (const source of event.sources) {
      if (!map.has(source.name)) map.set(source.name, new Set());
      map.get(source.name).add(source.raw_id);
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
    rawEvents = await adapter.fetch(knownRawIdsBySource.get(adapter.name) ?? new Set());
  } catch (err) {
    error = err.message;
    logProgress(`${adapter.name} fetch() threw: ${err.stack}`);
  }
  logProgress(`=== finished adapter: ${adapter.name}, ${rawEvents.length} raw event(s) ===`);

  const previous = previousSources.find((s) => s.name === adapter.name);
  const { entry, anomaly } = classifySourceRun(adapter.name, { error, rawCount: rawEvents.length }, previous);

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
  const freshRawEvents = [];
  for (const raw of rawEvents) {
    if (raw.reuse_previous) {
      reuseRawIds.add(raw.raw_id);
    } else {
      freshRawEvents.push(raw);
    }
  }
  if (reuseRawIds.size > 0) {
    const reused = fallbackEventsForSource(previousEvents, adapter.name, reuseRawIds);
    normalizedEvents.push(...reused);
    logProgress(`${adapter.name}: reused ${reused.length} already-known event(s) without re-fetching detail`);
  }

  for (const raw of freshRawEvents) {
    // A single malformed record must never take down the whole run — every
    // other successfully-scraped event (and this run's writes) would be
    // lost with it (found in review: this loop had no isolation at all).
    try {
      const result = normalize(raw, artistsYml, venuesYml);
      if (result.event) {
        normalizedEvents.push(result.event);
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

  const deduped = dedupe(normalizedEvents);
  const { events, digest } = diff(previousEvents, deduped);

  writeFileSync(
    path.join(DATA_DIR, "events.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), events }, null, 2) + "\n"
  );
  writeFileSync(path.join(DATA_DIR, "digest.json"), JSON.stringify(digest, null, 2) + "\n");
  writeFileSync(
    path.join(DATA_DIR, "needs-review.json"),
    JSON.stringify({ items: needsReview }, null, 2) + "\n"
  );
  writeFileSync(
    path.join(DATA_DIR, "sources.json"),
    JSON.stringify({ sources: sourcesStatus }, null, 2) + "\n"
  );

  console.log(
    `LiveRadar fetch complete: ${events.length} recognized event(s) (${digest.added_ids.length} new, ${digest.updated.length} updated), ${needsReview.length} needing review.`
  );
}

main();
