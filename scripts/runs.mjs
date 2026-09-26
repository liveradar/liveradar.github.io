import { computeId } from "./dedup.mjs";
import { taiwanTodayDateStr } from "./normalize.mjs";

/**
 * Collapses per-session Event objects that share a `run_key` (same
 * production, same venue — see PLAN-1-theater-runs.md) into ONE run event
 * carrying a `sessions` array, so a 50-performance theater run doesn't
 * become 50 separate timeline cards. `run_key`/`category` are set by an
 * adapter (e.g. OPENTIX, 寬宏/年代) on RawEvent, carried through by
 * normalize.mjs onto its output Event.
 *
 * Runs in fetch.mjs BETWEEN normalize() and dedupe() — dedupe.mjs treats any
 * event that already has `sessions` as already-merged and passes it through
 * untouched (no cross-source merge, no day/evening time-bucket splitting;
 * those solve a different problem this grouping already solves for category
 * events).
 */

const STATUS_PRIORITY = ["on_sale", "announced", "sold_out"];

function summarizeStatus(upcoming) {
  for (const status of STATUS_PRIORITY) {
    if (!upcoming.some((e) => e.status === status)) continue;
    if (status === "announced") {
      const onSaleAts = upcoming
        .filter((e) => e.status === "announced" && e.on_sale_at)
        .map((e) => e.on_sale_at)
        .sort();
      return { status: "announced", on_sale_at: onSaleAts[0] ?? null };
    }
    return { status, on_sale_at: null };
  }
  // No upcoming session is on_sale/announced/sold_out (including the
  // "no upcoming sessions left at all" case) — the whole run has ended.
  return { status: "ended", on_sale_at: null };
}

/**
 * @param {object[]} events - normalize.mjs output Event[] (no id yet)
 * @param {string} todayStr - "YYYY-MM-DD", Taiwan calendar date
 * @returns {object[]} events with run_key grouped into `sessions`-carrying
 *   run events; everything else passed through unchanged.
 */
export function groupRuns(events, todayStr = taiwanTodayDateStr()) {
  const passthrough = [];
  const groups = new Map(); // run_key -> per-session Event[]

  for (const event of events) {
    // Already merged (a previous run's fallback-reused event still carries
    // its own `sessions`) or not a run at all (no run_key) — nothing to do.
    if (event.sessions || !event.run_key) {
      passthrough.push(event);
      continue;
    }
    if (!groups.has(event.run_key)) groups.set(event.run_key, []);
    groups.get(event.run_key).push(event);
  }

  const runs = [];
  for (const [runKey, group] of groups) {
    const sorted = [...group].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.time ?? "").localeCompare(b.time ?? "");
    });
    const sessions = sorted.map((e) => ({ date: e.date, time: e.time, status: e.status }));

    const upcoming = sorted.filter((e) => e.date >= todayStr);
    // Every session already passed: fall back to the full run so date/venue/
    // etc still resolve to something real instead of undefined — status
    // naturally comes out "ended" from summarizeStatus([]) below.
    const relevant = upcoming.length > 0 ? upcoming : sorted;
    const first = relevant[0];
    const last = relevant[relevant.length - 1];

    const prices = sorted.flatMap((e) => [e.price_min, e.price_max]).filter((p) => p != null);
    const { status, on_sale_at } = summarizeStatus(upcoming);

    const id = computeId("run", runKey, "");
    runs.push({
      ...first,
      id,
      merged_ids: [id],
      date: first.date,
      time: first.time,
      date_end: last.date,
      status,
      on_sale_at,
      price_min: prices.length > 0 ? Math.min(...prices) : null,
      price_max: prices.length > 0 ? Math.max(...prices) : null,
      sources: [{ name: first.sources[0]?.name, url: first.ticket_url, raw_id: runKey }],
      sessions,
      first_seen_at: first.first_seen_at,
      updated_at: first.updated_at,
    });
  }

  return [...passthrough, ...runs];
}
