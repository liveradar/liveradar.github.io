import { logProgress } from "../progress-log.mjs";

/**
 * Billboard Live TAIPEI adapter (billboardlivetaipei.tw). Added 2026-09-25.
 *
 * A single venue (信義區 ATT 4 FUN 7F) that sells its own tickets directly —
 * not on any of the other 5 platforms. See PLAN-billboard-live.md (written
 * 2026-09-25, deleted once this landed) for the full research this is based
 * on: real fetches against the live site, no guessing.
 *
 * No Cloudflare, plain fetch works. The event list page is a Next.js app —
 * `/tw/events` embeds its data as React Server Component payload chunks
 * (`self.__next_f.push([1,"..."])`) rather than a plain server-rendered
 * table, so this decodes those chunks back into one JSON text blob and pulls
 * every object that has a "shows" key out of it (extractEventObjects).
 * `/api/*` is Disallow'd in robots.txt — this never calls it, only the
 * public `/tw/events` page a browser would load.
 *
 * The default `/tw/events` page (no month filter) only shows 7 of the ~10
 * live events — LEO IEIRI, SUBARU SHIBUTANI and culenasm were missing from
 * it 2026-09-25 despite NOT being sold out (confirmed: 9, 164, 102 seats
 * left respectively). Cause unknown, but querying month-by-month
 * (`?selectedMonth=YYYY-M`, unpadded month) reliably returns everything, so
 * that's what this does — current Taiwan month plus the next 6, matching how
 * far ahead the site's own month picker (`getMonthsFromServiceStart`) goes.
 *
 * No incremental fetch / reuse_previous here unlike the other 5 adapters:
 * the whole catalog is 7 cheap requests, so every run just re-fetches and
 * re-normalizes everything fresh. diff.mjs only marks a field "updated" when
 * it actually changed, so this doesn't cause any log/digest noise.
 */

export const name = "Billboard Live";
export const priority = 6;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const BASE_URL = "https://www.billboardlivetaipei.tw";
// From /tw/access (confirmed 2026-09-25). "/" splits into KKTIX-shaped
// venue/address halves for parseKktixVenue to read the city out of.
const VENUE_RAW = "Billboard Live TAIPEI / 台北市信義區松壽路12號7F";
const REQUEST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;
const MONTHS_AHEAD = 7; // current Taiwan month + 6, same reach as the site's own month picker

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "YYYY-M" (month NOT zero-padded — that's what the site's own URLs use)
 * for the current Taiwan month through MONTHS_AHEAD-1 months ahead.
 */
export function taiwanMonthList(nowMs = Date.now()) {
  const shifted = new Date(nowMs + 8 * 60 * 60 * 1000);
  let year = shifted.getUTCFullYear();
  let month = shifted.getUTCMonth() + 1;
  const months = [];
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    months.push(`${year}-${month}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

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

// Every self.__next_f.push([1,"..."]) chunk's payload is a JS string
// literal (backslash-escaped) — decode each with JSON.parse and concatenate
// them back into one plain-text RSC blob to search over.
const NEXT_F_CHUNK_RE = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/gs;

export function extractRscText(html) {
  let text = "";
  for (const match of html.matchAll(NEXT_F_CHUNK_RE)) {
    try {
      text += JSON.parse(`"${match[1]}"`);
    } catch (err) {
      logProgress(`Billboard Live: failed to decode an RSC chunk: ${err.message}`);
    }
  }
  return text;
}

// Pulls out the raw JSON text of every object in the RSC blob that has a
// "shows" key (each is one event, with its full shows array already
// embedded — no need to visit each event's own detail page separately).
// A plain string-aware brace scan: track whether we're inside a JSON string
// (so a literal '{'/'}' inside title/description text doesn't miscount) and
// a stack of open-object start indices, flagging the current top-of-stack
// object whenever the literal `"shows":[` text is seen outside a string.
const SHOWS_MARKER = '"shows":[';

export function extractEventObjects(rscText) {
  const results = [];
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < rscText.length; i++) {
    const c = rscText[i];
    if (!inString && stack.length > 0 && rscText.startsWith(SHOWS_MARKER, i)) {
      stack[stack.length - 1].hasShows = true;
    }
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      stack.push({ start: i, hasShows: false });
    } else if (c === "}") {
      const frame = stack.pop();
      if (frame?.hasShows) results.push(rscText.slice(frame.start, i + 1));
    }
  }
  return results;
}

/**
 * Mirrors the site's own getShowBadgeStatus (found in its JS bundle) and
 * maps its outcome onto LiveRadar's shared sale-signal vocabulary
 * (sale-signal.mjs). Pure function of (event, show, nowMs) so it's testable
 * without any network access.
 */
export function showSaleSignal(event, show, nowMs = Date.now()) {
  if (event?.status === "cancelled" || show.status === "cancelled") {
    return { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null };
  }
  if (event?.status === "sold-out") {
    return { sale_signal: "SOLD_OUT", on_sale_at: null };
  }
  if (event?.status === "completed" || show.status === "completed" || show.status === "sale_ended") {
    return { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null };
  }
  const period = show.salesPeriod;
  if (!period?.startDate) {
    return { sale_signal: "COMING_SOON", on_sale_at: null };
  }
  const startMs = Date.parse(period.startDate);
  if (nowMs < startMs) {
    // Covers both "preparing" and "member-early-access" — the site treats
    // early access as a sub-window of "before general sale", and the
    // on-sale time worth showing a buyer is always the general startDate,
    // not the early-access one.
    return { sale_signal: "COMING_SOON", on_sale_at: toTaiwanTimestampSlash(period.startDate) };
  }
  if (period.endDate && nowMs > Date.parse(period.endDate)) {
    return { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null };
  }
  const available = show.availableCount;
  // <= 0, not === 0: a real show (家入レオ, checked 2026-09-25) had a
  // negative remaining count (-5) for a sold-through tier.
  if (typeof available === "number" && available <= 0) {
    return { sale_signal: "SOLD_OUT", on_sale_at: null };
  }
  return { sale_signal: "IN_STOCK", on_sale_at: null };
}

/**
 * show.ticketPrices ({tierName: price}) + show.productAvailability
 * ({tierName: {total, available}}, sometimes the literal string
 * "$undefined") -> tickets_raw entries (statusFromTickets/priceFromTickets
 * in normalize.mjs read name/price/closed/waiting/on_sale_at_raw).
 *
 * "pair-v2" (and any other "pair*" tier) is excluded — it's a 2-person seat
 * priced for two, and would otherwise inflate price_max misleadingly.
 */
export function buildTicketsRaw(show, signal) {
  const prices = show.ticketPrices;
  if (!prices || typeof prices !== "object") return [];
  const availability = show.productAvailability && typeof show.productAvailability === "object" ? show.productAvailability : null;
  const closedBySignal = signal.sale_signal === "SOLD_OUT" || signal.sale_signal === "REGISTRATION_CLOSED";
  const waiting = signal.sale_signal === "COMING_SOON";
  return Object.entries(prices)
    .filter(([tierName]) => !tierName.toLowerCase().startsWith("pair"))
    .map(([tierName, price]) => {
      const tierAvailable = availability?.[tierName]?.available;
      const closed = closedBySignal || (typeof tierAvailable === "number" && tierAvailable <= 0);
      return {
        name: tierName,
        price: typeof price === "number" ? price : null,
        closed,
        waiting,
        on_sale_at_raw: waiting ? signal.on_sale_at : null,
      };
    });
}

export function showToRawEvent(event, show, nowMs = Date.now()) {
  const signal = showSaleSignal(event, show, nowMs);
  return {
    raw_id: show._id,
    url: `${BASE_URL}/tw/events/${event.slug}`,
    title_raw: event.title,
    venue_raw: VENUE_RAW,
    date_raw: toTaiwanDateTimeDash(show.startTime),
    tickets_raw: buildTicketsRaw(show, signal),
    register_status: signal.sale_signal,
    price_text_raw: "",
    sale_status_text: "",
    source_name: name,
  };
}

async function fetchHtmlOnce(month) {
  const url = `${BASE_URL}/tw/events?query=&selectedMonth=${month}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(month) {
  try {
    return await fetchHtmlOnce(month);
  } catch (err) {
    logProgress(`Billboard Live retry: ${month} - ${err.message}`);
    return await fetchHtmlOnce(month); // let a second failure throw and propagate — see doc comment above
  }
}

export async function fetch() {
  const months = taiwanMonthList();
  // Keyed by show._id: the same event (and its shows) can legitimately
  // appear on more than one month's page (e.g. a tour spanning a month
  // boundary), and re-querying is cheaper than trying to predict which
  // month a given show's date falls in before parsing it.
  const showsById = new Map();
  for (const month of months) {
    await sleep(REQUEST_DELAY_MS);
    const html = await fetchHtml(month);
    const rsc = extractRscText(html);
    const eventTexts = extractEventObjects(rsc);
    let showCount = 0;
    for (const eventText of eventTexts) {
      let eventData;
      try {
        eventData = JSON.parse(eventText);
      } catch (err) {
        logProgress(`Billboard Live: failed to parse an event object in ${month}: ${err.message}`);
        continue;
      }
      if (!Array.isArray(eventData.shows)) continue;
      for (const show of eventData.shows) {
        if (!show?._id) continue;
        showsById.set(show._id, { event: eventData, show });
        showCount += 1;
      }
    }
    logProgress(`Billboard Live: ${month} - ${showCount} show(s)`);
  }

  const nowMs = Date.now();
  const results = [...showsById.values()].map(({ event, show }) => showToRawEvent(event, show, nowMs));
  logProgress(`Billboard Live: ${results.length} show(s) total across ${months.length} month(s)`);
  return results;
}
