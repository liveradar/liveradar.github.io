/**
 * Minimal RFC 5545 .ics builder for a single-event "開賣提醒" (on-sale
 * reminder) — not a full calendar library, just the handful of fields a
 * static site with no backend needs: a VEVENT at the on-sale moment plus a
 * VALARM, so the user's own OS/calendar app is what actually notifies them
 * later (see render.js's remindButton comment for why this shape, not push).
 * Deliberately doesn't do RFC 5545 line-folding (lines >75 octets) — every
 * calendar app this was tested against (Google Calendar, Apple Calendar)
 * accepts unfolded lines fine, and folding correctly for multi-byte UTF-8
 * text adds real complexity for a case that hasn't caused a problem yet.
 */

function toIcsUtc(isoString) {
  return new Date(isoString)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function addMinutes(isoString, minutes) {
  return new Date(new Date(isoString).getTime() + minutes * 60000).toISOString();
}

function escapeIcsText(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * @param {object} event - { id, title, venue, onSaleAt (ISO string), ticketUrl }
 * @returns {string} .ics file content, CRLF line endings per RFC 5545
 */
export function buildOnSaleReminderIcs(event) {
  const summary = `🎫 開賣提醒：${event.title}`;
  const dtStart = toIcsUtc(event.onSaleAt);
  // Zero-duration VEVENTs render oddly in some calendar apps — a short
  // 15-minute block reads as a normal timed event without implying you
  // need to "attend" anything for that long.
  const dtEnd = toIcsUtc(addMinutes(event.onSaleAt, 15));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LiveRadar//OnSaleReminder//ZH",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:liveradar-onsale-${event.id}@liveradar.github.io`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    event.venue ? `DESCRIPTION:${escapeIcsText(event.venue)}` : null,
    event.ticketUrl ? `URL:${event.ticketUrl}` : null,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    `DESCRIPTION:${escapeIcsText(summary)}（15 分鐘後開賣）`,
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:PT0M",
    `DESCRIPTION:${escapeIcsText(summary)}（開賣了）`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n") + "\r\n";
}
