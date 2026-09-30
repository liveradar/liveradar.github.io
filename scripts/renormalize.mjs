/**
 * Re-applies data/artists.yml, data/venues.yml and the exclusion rules to
 * already-fetched events, with zero network requests. 2026-09-24: the daily
 * routine used to re-run the WHOLE fetch pipeline (~30 min, hundreds of
 * requests) just so a handful of events would pick up a new artist; 2026-09-30
 * extended the same idea to a new venues.yml entry and a new NOISE_KEYWORDS
 * phrase, which used to force that same full re-fetch.
 *
 * Scope is deliberately narrow: only events with no recognized headliner yet
 * get artists re-matched, only events with city 未知 get a city re-resolved.
 * Already-classified events are left alone — their tags may come from a
 * cross-source merge in dedup.mjs that a per-title recompute here would undo.
 *
 * Usage: node scripts/renormalize.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtists, loadVenues, applyArtistMatch, resolveStoredCity, exclusionReason } from "./normalize.mjs";
import { loadExclusionCache, recordExclusion, saveExclusionCache } from "./exclusion-cache.mjs";
import { acquireRunLock } from "./run-lock.mjs";

acquireRunLock("npm run renormalize");

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const REVIEW_PATH = path.join(DATA_DIR, "needs-review.json");

const artistsYml = loadArtists();
const venuesYml = loadVenues();
const eventsFile = JSON.parse(readFileSync(EVENTS_PATH, "utf-8"));
const events = eventsFile.events ?? eventsFile;
const exclusionCache = loadExclusionCache();

const excludedKeys = new Set();
const kept = [];
for (const event of events) {
  const reason = exclusionReason({ title_raw: event.title_raw, url: event.sources[0]?.url, venue_raw: event.venue });
  if (reason) {
    for (const s of event.sources) {
      excludedKeys.add(`${s.name}|${s.raw_id}`);
      recordExclusion(exclusionCache, {
        source: s.name, raw_id: s.raw_id, title_raw: event.title_raw, url: s.url, venue_raw: event.venue, reason,
      });
    }
    console.log(`excluded (${reason}): ${event.title_raw}`);
    continue;
  }
  kept.push(event);
}

const resolvedRawIds = new Set();
let cityFixed = 0;
for (const event of kept) {
  if (applyArtistMatch(event, artistsYml)) {
    for (const s of event.sources) resolvedRawIds.add(`${s.name}|${s.raw_id}`);
    console.log(`resolved: ${event.title_raw} -> ${event.headliners.join(", ")} (${event.tags_origin.join(", ")})`);
  }
  if (event.city === "未知") {
    const city = resolveStoredCity(event, venuesYml);
    if (city) {
      event.city = city;
      event.updated_at = new Date().toISOString();
      cityFixed += 1;
      console.log(`city: ${event.title_raw} | ${event.venue} -> ${city}`);
    }
  }
}

const reviewFile = JSON.parse(readFileSync(REVIEW_PATH, "utf-8"));
const reviewItems = reviewFile.items ?? reviewFile;
const remaining = reviewItems.filter((item) => {
  const k = `${item.source}|${item.raw_id}`;
  if (excludedKeys.has(k)) return false;
  return !(item.reason === "artist_unrecognized" && resolvedRawIds.has(k));
});

if (eventsFile.events) eventsFile.events = kept;
writeFileSync(EVENTS_PATH, JSON.stringify(eventsFile.events ? eventsFile : kept, null, 2) + "\n"); // same format fetch.mjs writes
writeFileSync(
  REVIEW_PATH,
  JSON.stringify(Array.isArray(reviewFile) ? remaining : { ...reviewFile, items: remaining }, null, 2) + "\n",
);
saveExclusionCache(exclusionCache);
console.log(
  `${resolvedRawIds.size} source listing(s) resolved, ${cityFixed} city fix(es), ` +
    `${events.length - kept.length} event(s) excluded, ${remaining.length} needs-review item(s) remaining`,
);
