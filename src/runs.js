/**
 * Multi-session "run" events (舞台劇/音樂劇 — one card per production per
 * venue, see PLAN-1-theater-runs.md) carry a `sessions` array from
 * scripts/runs.mjs's groupRuns() instead of a single date/time. Everything
 * here re-derives "today's view" of a run from that array client-side,
 * because data/events.json only refreshes once a day (the scheduled fetch)
 * but sessions keep passing every day in between — a 10/1–10/31 run must
 * not still look like it's dated 10/1 on the morning of 10/2.
 */

/** Browser-LOCAL "YYYY-MM-DD" — never toISOString() (UTC), same reasoning as filter.js's isPast(). */
export function localTodayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A run event's sessions that haven't happened yet, in their original (date, time) sorted order. Non-run events have no `sessions` at all, so this is `[]` for them. */
export function upcomingSessions(event, todayIso = localTodayIso()) {
  return (event.sessions ?? []).filter((s) => s.date >= todayIso);
}

/**
 * A run event as it should look RIGHT NOW: date/time swapped to the next
 * upcoming session, or (every session already passed) the last one, so
 * filter.js's isPast() naturally buckets it as ended instead of a stale
 * scheduled-fetch snapshot. A non-run event (no `sessions`) passes through
 * unchanged.
 */
export function materializeRun(event, todayIso = localTodayIso()) {
  if (!event.sessions) return event;
  const upcoming = upcomingSessions(event, todayIso);
  const next = upcoming[0] ?? event.sessions[event.sessions.length - 1];
  return { ...event, date: next.date, time: next.time };
}

/**
 * Every date a card should be considered "on" — the run's upcoming session
 * dates (or, once it's ended, every session date, so it still resolves to
 * something real), or just `[event.date]` for a non-run event. Used
 * wherever a single event.date isn't enough on its own: month filtering,
 * the favorites calendar's day dots.
 */
export function eventDates(event, todayIso = localTodayIso()) {
  if (!event.sessions) return [event.date];
  const upcoming = upcomingSessions(event, todayIso);
  return (upcoming.length > 0 ? upcoming : event.sessions).map((s) => s.date);
}
