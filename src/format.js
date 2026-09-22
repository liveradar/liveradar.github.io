/** Formatting helpers shared by all pages. Pure functions, no DOM access. */

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * "2026-10-15" -> { day: "15", month: "10", weekday: "THU", groupLabel: "10月15日" }
 *
 * groupLabel only gets a year prefix ("2027年1月15日") when the date's year
 * isn't the current real-world year — a list sorted by date that scrolls
 * past a Dec 31 → Jan 1 boundary (real case: 12/26 into a 1/2 group with no
 * visual cue at all which year "1/2" was, found by Max scrolling the
 * timeline) otherwise looks identical to any other same-year gap. Compared
 * against the real "now", not the previous group's year, so this only ever
 * adds a year prefix to future-year dates, never every group.
 */
export function splitDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const yearPrefix = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : "";
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: String(d.getMonth() + 1),
    weekday: WEEKDAYS[d.getDay()],
    groupLabel: `${yearPrefix}${d.getMonth() + 1}月${d.getDate()}日`,
  };
}

/** Days from today to the given date, floor'd; negative if in the past. */
export function daysUntil(isoDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

export function formatPrice(min, max) {
  if (min == null) return "票價未公布";
  return `NT$${min.toLocaleString()} up`;
}

/** Whole days elapsed since an ISO datetime (e.g. Event.first_seen_at). */
export function daysSince(isoDateTime) {
  const then = new Date(isoDateTime);
  const now = new Date();
  return Math.floor((now - then) / 86400000);
}

/** e.g. "3 天後" for an on_sale_at datetime; null if already on sale / unknown. */
export function formatOnSaleCountdown(onSaleAtIso) {
  if (!onSaleAtIso) return null;
  const days = daysUntil(onSaleAtIso.slice(0, 10));
  if (days <= 0) return null;
  return `${days} 天後`;
}

/**
 * "2026-09-23T20:00:00+08:00" -> "9/23 20:00" (Max: "但我想要知道的預售
 * 準確的時間" — the "X 天後" countdown alone doesn't say WHEN, just how far
 * off). Reads the date/time digits straight out of the string instead of
 * going through a Date object — on_sale_at is always stored with an explicit
 * +08:00 offset already (see normalize.mjs's parseOnSaleAt/
 * parseKktixTimestamp), so there's no timezone conversion to get right or
 * wrong here, just formatting.
 */
export function formatOnSaleDateTime(onSaleAtIso) {
  if (!onSaleAtIso) return null;
  const m = onSaleAtIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, , mo, d, h, mi] = m;
  return `${Number(mo)}/${Number(d)} ${h}:${mi}`;
}
