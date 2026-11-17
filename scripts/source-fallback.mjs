/**
 * SPEC §4.2 step 3: when a source fails (or silently returns 0 results) this
 * run, reuse what it contributed last time instead of contributing nothing.
 * Without this, a single blocked/broken source wipes its share of real data
 * out of events.json/needs-review.json on the very next run — this actually
 * happened once against a live GitHub Actions IP block (see HANDOFF.md's
 * "M11 的重大發現").
 */

/**
 * @param {object[]} previousEvents - last run's merged Event[] (data/events.json)
 * @param {string} sourceName
 * @param {Set<string>} [rawIds] - restrict to just these raw_ids (2026-09-18,
 *   incremental fetch: an adapter that skipped its own expensive per-event
 *   detail fetch for already-known events, see fetch.mjs's runAdapter(),
 *   uses this to reuse exactly those events' previous normalized data
 *   instead of the "reuse everything from this source" anomaly-fallback use
 *   below, which omitting this argument still does.
 * @returns {object[]} single-source Event-shaped objects (id/merged_ids
 *   stripped) ready to feed back into dedupe() alongside this run's freshly
 *   normalized events from other sources — dedupe() naturally re-merges them
 *   with anything a still-working source finds for the same show.
 */
export function fallbackEventsForSource(previousEvents, sourceName, rawIds = null) {
  const fallback = [];
  for (const event of previousEvents) {
    const ownSource = event.sources.find((s) => s.name === sourceName);
    if (!ownSource) continue;
    if (rawIds && !rawIds.has(ownSource.raw_id)) continue;
    const { id, merged_ids, sources, updated_fields, ...rest } = event;
    fallback.push({ ...rest, sources: [ownSource] });
  }
  return fallback;
}

/**
 * @param {object[]} previousReviewItems - last run's data/needs-review.json `items`
 * @param {string} sourceName
 * @returns {object[]} the subset that belonged to this source
 */
export function fallbackReviewItemsForSource(previousReviewItems, sourceName) {
  return previousReviewItems.filter((item) => item.source === sourceName);
}

import { readFileSync } from "node:fs";

/**
 * A missing file is a legitimate first run (-> fallback). A file that exists
 * but won't parse is NOT: treating it as "no previous data" would stamp every
 * event as newly added, re-fetch every detail page, and leave a broken source
 * with nothing to fall back to — so stop and let a human restore it from git.
 */
export function readPrevious(filePath, key) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  try {
    return JSON.parse(raw)[key] ?? [];
  } catch (err) {
    throw new Error(`${filePath} 無法解析（${err.message}）——先用 git 還原這個檔案再重跑，這次不抓取。`);
  }
}
