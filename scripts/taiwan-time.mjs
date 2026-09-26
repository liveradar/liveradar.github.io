/**
 * Shared UTC <-> Taiwan-time (+08:00, no DST) conversion helpers. Extracted
 * from billboard.mjs (2026-09-26, see PLAN-3-opentix.md) once a second
 * adapter (OPENTIX) needed the exact same conversions.
 */

function taiwanParts(isoUtc) {
  const shifted = new Date(new Date(isoUtc).getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    y: shifted.getUTCFullYear(),
    mo: pad(shifted.getUTCMonth() + 1),
    d: pad(shifted.getUTCDate()),
    h: pad(shifted.getUTCHours()),
    mi: pad(shifted.getUTCMinutes()),
  };
}

// "2026-10-04T09:00:00.000Z" -> "2026-10-04 17:00" (Taiwan time), the shape
// parseTicketPlusDate (normalize.mjs) reads date_raw as.
export function toTaiwanDateTimeDash(isoUtc) {
  const { y, mo, d, h, mi } = taiwanParts(isoUtc);
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

// Same moment, "YYYY/MM/DD HH:MM" — the shape parseKktixTimestamp
// (normalize.mjs, used for tickets_raw[].on_sale_at_raw) reads.
export function toTaiwanTimestampSlash(isoUtc) {
  const { y, mo, d, h, mi } = taiwanParts(isoUtc);
  return `${y}/${mo}/${d} ${h}:${mi}`;
}
