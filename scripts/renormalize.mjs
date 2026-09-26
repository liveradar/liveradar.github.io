/**
 * Re-applies data/artists.yml to already-fetched events, with zero network
 * requests. 2026-09-24: the daily routine used to add newly verified artists
 * to artists.yml and then re-run the WHOLE fetch pipeline just so those few
 * events would pick up their headliners/tags_origin — ~30 minutes and
 * hundreds of requests to change a handful of fields that only depend on the
 * title (already stored) and artists.yml. This does just that part.
 *
 * Scope is deliberately narrow: only events with no recognized headliner yet
 * (the ones needs-review.json lists as artist_unrecognized). Already-classified
 * events are left alone — their tags may come from a cross-source merge in
 * dedup.mjs that a per-title recompute here would undo.
 *
 * Usage: node scripts/renormalize.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtists, matchArtists, guessTagsType } from "./normalize.mjs";
import { acquireRunLock } from "./run-lock.mjs";

acquireRunLock("npm run renormalize");

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const REVIEW_PATH = path.join(DATA_DIR, "needs-review.json");

const artistsYml = loadArtists();
const eventsFile = JSON.parse(readFileSync(EVENTS_PATH, "utf-8"));
const events = eventsFile.events ?? eventsFile;

const resolvedRawIds = new Set();
for (const event of events) {
  if (event.headliners?.length) continue;
  // A theater/musical run's tags_type is its own category ("音樂劇"/"舞台劇",
  // see normalize.mjs), not something guessTagsType() should ever overwrite —
  // its title rarely names an "artist" matchArtists() would find anyway.
  if (event.category) continue;
  const headliners = matchArtists(event.title_raw, artistsYml);
  if (headliners.length === 0) continue;
  event.headliners = headliners;
  event.lineup = headliners;
  event.tags_type = guessTagsType(event.title_raw, headliners.length);
  event.tags_origin = [
    ...new Set(headliners.map((h) => artistsYml.find((a) => a.canonical === h)?.tags_origin_default).filter(Boolean)),
  ];
  event.updated_at = new Date().toISOString();
  for (const s of event.sources) resolvedRawIds.add(`${s.name}|${s.raw_id}`);
  console.log(`resolved: ${event.title_raw} -> ${headliners.join(", ")} (${event.tags_origin.join(", ")})`);
}

const reviewFile = JSON.parse(readFileSync(REVIEW_PATH, "utf-8"));
const reviewItems = reviewFile.items ?? reviewFile;
const remaining = reviewItems.filter(
  (item) => !(item.reason === "artist_unrecognized" && resolvedRawIds.has(`${item.source}|${item.raw_id}`)),
);

writeFileSync(EVENTS_PATH, JSON.stringify(eventsFile, null, 2) + "\n"); // same format fetch.mjs writes
writeFileSync(
  REVIEW_PATH,
  JSON.stringify(Array.isArray(reviewFile) ? remaining : { ...reviewFile, items: remaining }, null, 2) + "\n",
);
console.log(`${resolvedRawIds.size} source listing(s) resolved, ${remaining.length} needs-review item(s) remaining`);
