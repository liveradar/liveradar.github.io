/**
 * Remembers raw events that normalize() dropped (non-music noise, junk,
 * outside Taiwan) so KKTIX doesn't re-open their detail pages every run —
 * they aren't in events.json, so incremental fetch alone never treats them as
 * known. 2026-09-30: ~70 of the 192 detail pages a no-new-events run opened
 * were these.
 *
 * An entry is only honored while BOTH hold: it was checked within
 * MAX_AGE_DAYS, and exclusionReason() still excludes it under today's rules
 * (so removing a keyword immediately un-skips what it had excluded).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exclusionReason } from "./normalize.mjs";

const CACHE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "excluded-cache.json");
export const MAX_AGE_DAYS = 7;
// junk_title ("test") is deliberately NOT cached: organizers often create a
// placeholder listing first and rename it into the real show later.
export const CACHEABLE_REASONS = new Set(["non_music_noise", "outside_taiwan"]);

const key = (source, rawId) => `${source}|${rawId}`;

export function isCacheEntryValid(entry, now = Date.now()) {
  const age = now - Date.parse(entry.checked_at);
  if (!(age >= 0 && age < MAX_AGE_DAYS * 86400000)) return false;
  const reason = exclusionReason(entry);
  return reason !== null && CACHEABLE_REASONS.has(reason);
}

export function loadExclusionCache(now = Date.now()) {
  let items = {};
  try {
    items = JSON.parse(readFileSync(CACHE_PATH, "utf-8")).items ?? {};
  } catch {
    // first run or unreadable — start empty, nothing is skipped
  }
  const map = new Map();
  for (const [k, entry] of Object.entries(items)) if (isCacheEntryValid(entry, now)) map.set(k, entry);
  return map;
}

export function recordExclusion(map, { source, raw_id, title_raw, url, venue_raw, reason }) {
  if (!CACHEABLE_REASONS.has(reason) || !raw_id) return;
  map.set(key(source, raw_id), {
    source,
    raw_id,
    title_raw: title_raw ?? "",
    url: url ?? null,
    venue_raw: venue_raw ?? "",
    reason,
    checked_at: new Date().toISOString(),
  });
}

export function skipIdsForSource(map, source) {
  return new Set([...map.values()].filter((e) => e.source === source).map((e) => e.raw_id));
}

export function saveExclusionCache(map) {
  const items = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(CACHE_PATH, JSON.stringify({ items }, null, 2) + "\n");
}
