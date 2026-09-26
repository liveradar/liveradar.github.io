import { eventDates } from "./runs.js";

/**
 * The single implementation of the visibility decision tree (SPEC §6 / SRS §6.3).
 * Every page imports this instead of re-deriving visibility itself — that's what
 * keeps FR-33 (favorites always win) and FR-44 (exclude rules persist) correct
 * everywhere at once.
 *
 * Order matters and must not be reordered:
 * ended -> favorited (short-circuits the exclude rules below, but NOT the view
 * filters — see the 2026-09-21 note) -> single-event exclude -> artist -> type
 * -> keyword -> view filters (city/month/price).
 *
 * 2026-09-21 real bug (Max): FR-33's original decision tree (SRS §6.3) had the
 * favorited short-circuit skip the view-filter check too, so a favorited 台北
 * show still appeared while the city chip was set to 新北 — confusing, since
 * the whole point of picking a city chip is to see only that city. FR-33's own
 * wording only ever promised favorites win over "排除規則" (the PERMANENT
 * exclude rules: blocked artist/type/keyword/single-event), never over the
 * TEMPORARY view filters (city/month/type/origin/price chips) — those are a
 * different mechanism (`viewFilters`, not `prefs.excluded_*`). Favorites still
 * unconditionally win over every exclude rule below; they just also have to
 * pass the view filters like anything else now.
 */

/**
 * @param {object} event - normalized Event (SPEC §3.1)
 * @param {object} prefs - UserPrefs (SPEC §3.3)
 * @param {object} [viewFilters] - { city?: string, month?: string, favoritesOnly?: boolean, priceMax?: number }
 * @returns {{ bucket: "ended"|"show"|"hidden"|"filtered", pinned?: boolean, reason?: string }}
 */
export function resolveVisibility(event, prefs, viewFilters = {}) {
  if (isPast(event.date)) {
    return { bucket: "ended" };
  }

  if (prefs.favorites.includes(event.id)) {
    return passesViewFilters(event, viewFilters) ? { bucket: "show", pinned: true } : { bucket: "filtered" };
  }

  if (prefs.excluded_events.includes(event.id)) {
    return { bucket: "hidden", reason: "event" };
  }

  const artistsToCheck = prefs.strict_mode ? event.lineup : event.headliners;
  if (artistsToCheck.some((a) => prefs.excluded_artists.includes(a))) {
    return { bucket: "hidden", reason: "artist" };
  }

  if (event.tags_type.some((t) => prefs.excluded_types.includes(t))) {
    return { bucket: "hidden", reason: "type" };
  }

  if (prefs.mute_keywords.some((kw) => event.title_raw.includes(kw))) {
    return { bucket: "hidden", reason: "keyword" };
  }

  if (!passesViewFilters(event, viewFilters)) {
    return { bucket: "filtered" };
  }

  return { bucket: "show" };
}

/** Exported so state.js's hidden-rule counters can apply the same "future only" rule. */
export function isPast(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // "T00:00:00" forces local-time parsing, matching format.js's splitDate/daysUntil —
  // a bare "YYYY-MM-DD" parses as UTC midnight instead, which for viewers at or
  // behind UTC can make a same-day event compare as already past.
  return new Date(dateStr + "T00:00:00") < today;
}

function passesViewFilters(event, viewFilters) {
  if (viewFilters.city && event.city !== viewFilters.city) return false;
  // A theater run (PLAN-1-theater-runs.md) spans several months of sessions —
  // event.date alone is only the NEXT upcoming one, so picking October must
  // still surface a run whose next show is in September but has an October
  // date too. eventDates() is just [event.date] for a non-run event.
  if (viewFilters.month && !eventDates(event).some((d) => d.startsWith(viewFilters.month))) return false;
  if (viewFilters.type && !event.tags_type.includes(viewFilters.type)) return false;
  if (viewFilters.origin && !event.tags_origin.includes(viewFilters.origin)) return false;
  if (viewFilters.favoritesOnly) return false; // handled by caller pre-filtering favorites list
  if (viewFilters.priceMax != null && event.price_min != null && event.price_min > viewFilters.priceMax) {
    return false;
  }
  return true;
}

/**
 * Partition a list of events into what should render vs. what's hidden,
 * plus a count of how many are hidden by rules (for the footer bar, FR-47).
 * "filtered" (view filters) is intentionally excluded from the hidden count
 * per SRS §6.3 — only rule-based hiding counts there.
 */
export function partitionEvents(events, prefs, viewFilters = {}) {
  const visible = [];
  const ended = [];
  let hiddenByRules = 0;

  for (const event of events) {
    const result = resolveVisibility(event, prefs, viewFilters);
    if (result.bucket === "show") {
      visible.push({ event, pinned: !!result.pinned });
    } else if (result.bucket === "ended") {
      ended.push(event);
    } else if (result.bucket === "hidden") {
      hiddenByRules += 1;
    }
    // "filtered" -> not shown, not counted
  }

  return { visible, ended, hiddenByRules };
}
