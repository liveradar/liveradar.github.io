/**
 * Scans data/events.json for upcoming events with suspicious-looking fields
 * — no network requests, no writes. 2026-09-26 (Max: "那要怎麼防範這種問
 * 題"): two real bugs found the same day (花澤香菜／囪擊音樂祭, both KKTIX
 * "group-hub" pages that got scraped as their own duplicate card, one stuck
 * showing city 未知) share the same root cause — a known event's fields are
 * only ever refreshed for its sale STATUS (see fetch.mjs's reuse_previous
 * handling), never re-derived, so a bad scrape or a later normalize.mjs fix
 * can sit there silently forever. There's no cheap way to guarantee that
 * never happens again, but this makes existing cases easy to FIND instead of
 * relying on Max spotting one by eye on the timeline (see HANDOFF.md's own
 * "9/25 city:未知 清單追查" — this is that same manual audit, scripted so it
 * can happen weekly instead of only when someone happens to notice).
 *
 * Deliberately a read-only report, not an auto-fixer: every case so far has
 * needed a human to look at the real ticket page and decide what the
 * correct value actually is (see the two 2026-09-26 commits) — guessing
 * wrong here would be worse than staying silent.
 *
 * Usage: node scripts/health-check.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { taiwanTodayDateStr } from "./normalize.mjs";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

export function isUpcoming(event, todayStr) {
  return (event.date_end ?? event.date) >= todayStr;
}

export function findUnknownCity(events) {
  return events.filter((e) => e.city === "未知");
}

export function findEmptyVenue(events) {
  return events.filter((e) => !e.venue);
}

// "announced" events legitimately have no price yet (sales haven't opened) —
// only flag a MISSING price on a status that implies real ticket data should
// already exist.
export function findMissingPrice(events) {
  return events.filter(
    (e) => e.price_min == null && e.price_max == null && (e.status === "on_sale" || e.status === "sold_out"),
  );
}

// A theater/musical run (event.category set, PLAN-1-theater-runs.md) is
// titled after the SHOW, not a performer — matchArtists() finding nothing
// there is normal, not a scrape gap (see renormalize.mjs's own identical
// skip). Everything else showing headliners: [] means normalize() never
// recognized anyone in the title at all.
export function findMissingHeadliner(events) {
  return events.filter((e) => !e.category && (e.headliners?.length ?? 0) === 0);
}

function dupeKey(event) {
  return `${event.date}T${event.time ?? ""}|${(event.venue ?? "").trim().toLowerCase()}`;
}

// The exact shape of both 2026-09-26 bugs: same date+time+venue under two
// different ids that dedup.mjs's headliner-based computeId() never merged
// (a KKTIX group-hub page vs. its own already-separately-listed children).
// Flags the GROUP, not a verdict — a coincidental same-timeslot double-
// booking at one venue is also possible, if rare; a human still decides.
export function findLikelyDuplicates(events) {
  const byKey = new Map();
  for (const e of events) {
    if (!e.date || !e.venue) continue; // nothing meaningful to group on
    const key = dupeKey(e);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}

function formatEvent(e) {
  return `  - [${e.id}] ${e.title_raw} (${e.date}${e.time ? " " + e.time : ""}) ${e.venue || "(無場館)"} · ${e.sources?.map((s) => s.name).join("/")}\n    ${e.ticket_url ?? ""}`;
}

function report(title, items, formatter = formatEvent) {
  console.log(`\n== ${title}（${items.length} 筆） ==`);
  if (items.length === 0) {
    console.log("  (無)");
    return;
  }
  for (const item of items) console.log(formatter(item));
}

function main() {
  const eventsFile = JSON.parse(readFileSync(path.join(DATA_DIR, "events.json"), "utf-8"));
  const allEvents = eventsFile.events ?? eventsFile;
  const today = taiwanTodayDateStr();
  const upcoming = allEvents.filter((e) => isUpcoming(e, today));

  console.log(`data/events.json: ${allEvents.length} 筆場次，${upcoming.length} 筆尚未結束（今天 ${today}）`);

  report("城市未知", findUnknownCity(upcoming));
  report("場館空白", findEmptyVenue(upcoming));
  report("售票中／已售完但缺票價", findMissingPrice(upcoming));
  report("沒有辨識出主唱／演出者", findMissingHeadliner(upcoming));
  report("疑似重複（同日期＋時間＋場館，但 id 不同）", findLikelyDuplicates(upcoming), (group) =>
    group.map(formatEvent).join("\n") + "\n",
  );
}

main();
