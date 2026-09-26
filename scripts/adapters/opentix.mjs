import { logProgress } from "../progress-log.mjs";
import { toTaiwanDateTimeDash, toTaiwanTimestampSlash } from "../taiwan-time.mjs";

/**
 * OPENTIX (兩廳院文化生活, opentix.life) adapter. Added 2026-09-26
 * (PLAN-3-opentix.md). robots.txt is `Allow: /` — plain HTTP, no Cloudflare.
 *
 * Only 5 categories, per Max's explicit scope decision (2026-09-25):
 * 戲劇-音樂劇/戲劇-現代戲劇 (theater, becomes a many-sessions run card — see
 * scripts/runs.mjs) and 音樂-流行音樂/音樂-爵士樂/音樂-世界民族 (a normal
 * one-session-per-card music listing, same as every other source).
 * Deliberately NOT the classical-music categories (管絃樂團/室內樂/獨奏/...)
 * — 9/25 review found they barely overlap with LiveRadar's existing
 * indie/underground focus.
 *
 * Two-step fetch:
 *  1. search.opentix.life/search (categoryFilter) gives the full program
 *     list AND every session's structured schedule/price data in one call —
 *     no separate detail-page visit needed for that part.
 *  2. The event page's own JSON-LD (`@type: "Event"`) is the ONLY place
 *     with real remaining-inventory ("SoldOut"/"InStock") — the search API
 *     doesn't have it. Matched back to the search API's session by
 *     (Taiwan-time start, to the minute + venue name), NOT by array order —
 *     2 real programs 2026-09-25 had a different session count on each side.
 */

export const name = "OPENTIX";
export const priority = 8;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const BASE_URL = "https://www.opentix.life";
const SEARCH_URL = "https://search.opentix.life/search";
const CATEGORIES = ["戲劇-音樂劇", "戲劇-現代戲劇", "音樂-流行音樂", "音樂-爵士樂", "音樂-世界/民族"];
const SEARCH_DELAY_MS = 300;
const PAGE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isKidsProgram(categories) {
  return Array.isArray(categories) && categories.some((c) => c.startsWith("親子-"));
}

/**
 * 音樂劇 wins outright over 舞台劇 when a program is dual-tagged (e.g.
 * "寶塚OG夢幻舞台" carries both 戲劇-音樂劇 and 音樂-流行音樂) — a simple,
 * predictable rule beats guessing per-program which category "really"
 * describes it (2026-09-25 decision). Neither theater category present ->
 * undefined, meaning "plain music listing, no run grouping".
 */
export function classifyCategory(categories) {
  if (!Array.isArray(categories)) return undefined;
  if (categories.includes("戲劇-音樂劇")) return "音樂劇";
  if (categories.includes("戲劇-現代戲劇")) return "舞台劇";
  return undefined;
}

/**
 * Mirrors OPENTIX's own status vocabulary (found in its JS bundle,
 * 2026-09-25): 0 正常, 1 暫停銷售, 2 取消演出, 3 延期, 4 變更演出者. Only 1/2
 * mean "don't sell this" — 3/4 are informational, sales continue normally.
 * `availability` (from the event page's own JSON-LD, or null when that
 * page fetch was skipped/failed) is OPENTIX's own computed InStock/SoldOut
 * signal — checked ahead of the date-window fallback since it's the more
 * direct source of truth when it's available at all.
 */
export function timeSaleSignal(time, availability, nowMs = Date.now()) {
  if (time.status === 1 || time.status === 2) {
    return { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null };
  }
  if (availability === "SoldOut") {
    return { sale_signal: "SOLD_OUT", on_sale_at: null };
  }
  if (typeof time.onlineStart === "number" && nowMs < time.onlineStart) {
    return { sale_signal: "COMING_SOON", on_sale_at: toTaiwanTimestampSlash(new Date(time.onlineStart).toISOString()) };
  }
  if (typeof time.onlineEnd === "number" && nowMs > time.onlineEnd) {
    return { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null };
  }
  return { sale_signal: "IN_STOCK", on_sale_at: null };
}

/**
 * time.minPrice/maxPrice -> tickets_raw entries (statusFromTickets/
 * priceFromTickets in normalize.mjs read name/price/closed/waiting/
 * on_sale_at_raw), same "structured tickets_raw" shape billboard.mjs's
 * buildTicketsRaw uses. A free program (both 0) gets one "免費" entry with
 * price: null so the card doesn't show a misleading "NT$0 up".
 */
export function buildTicketsRaw(time, signal) {
  const closed = signal.sale_signal === "SOLD_OUT" || signal.sale_signal === "REGISTRATION_CLOSED";
  const waiting = signal.sale_signal === "COMING_SOON";
  const on_sale_at_raw = waiting ? signal.on_sale_at : null;
  if (!(time.maxPrice > 0)) {
    return [{ name: "免費", price: null, closed, waiting, on_sale_at_raw }];
  }
  return [
    { name: "最低票價", price: time.minPrice, closed, waiting, on_sale_at_raw },
    { name: "最高票價", price: time.maxPrice, closed, waiting, on_sale_at_raw },
  ];
}

// "YYYY-MM-DD HH:MM" in Taiwan time, from either an epoch-ms search-API
// `start`/`onlineStart` value or a JSON-LD `startDate` string that's
// ALREADY Taiwan local time with no timezone marker at all ("2026-10-24T
// 14:30:00") — the two sides need the exact same key shape to match by
// (time, venue) instead of by array order.
export function taiwanMinuteKey(value) {
  if (typeof value === "number") return toTaiwanDateTimeDash(new Date(value).toISOString());
  return String(value).replace("T", " ").slice(0, 16);
}

const LD_JSON_RE = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;

/** Every `@type: "Event"` JSON-LD block on an event page -> {minuteKey, venueName, availability}. Non-Event blocks (BreadcrumbList, etc.) and malformed JSON are skipped, not fatal. */
export function parseEventAvailability(html) {
  const entries = [];
  for (const match of html.matchAll(LD_JSON_RE)) {
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (data["@type"] !== "Event") continue;
    entries.push({
      minuteKey: taiwanMinuteKey(data.startDate),
      venueName: data.location?.name ?? "",
      availability: data.offers?.availability ?? null,
    });
  }
  return entries;
}

/** Looks up a search-API session's real availability by (start time to the minute, venue name) — never by position, since two real programs 2026-09-25 had a different session count on each side. */
export function findAvailability(entries, timeStartMs, venueName) {
  const key = taiwanMinuteKey(timeStartMs);
  return entries.find((e) => e.minuteKey === key && e.venueName === venueName)?.availability ?? null;
}

export function buildRawEvent(program, venue, time, category, signal) {
  return {
    raw_id: `${program.id}_${time.start}`,
    url: `${BASE_URL}/event/${program.id}`,
    title_raw: program.title,
    // parseKktixVenue (normalize.mjs default) checks the "address" half for
    // a known city name first — venue.city ("臺中" etc.) works directly;
    // falls back to treating the venue name itself as the address (and
    // then venues.yml) when city is missing or something unusable like the
    // real "GLOBALVILLAGEONEARTH" (a 池上 outdoor event) seen 2026-09-25.
    venue_raw: `${venue.name} / ${venue.city ?? ""}`,
    date_raw: toTaiwanDateTimeDash(new Date(time.start).toISOString()),
    tickets_raw: buildTicketsRaw(time, signal),
    register_status: signal.sale_signal,
    price_text_raw: "",
    sale_status_text: "",
    source_name: name,
    ...(category ? { category, run_key: `opentix:${program.id}:${venue.name}` } : {}),
  };
}

async function postSearchOnce(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(SEARCH_URL, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", Origin: BASE_URL },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`POST search -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postSearch(body) {
  try {
    return await postSearchOnce(body);
  } catch (err) {
    logProgress(`OPENTIX retry: search ${JSON.stringify(body)} - ${err.message}`);
    return await postSearchOnce(body); // a second failure throws and propagates, aborting the whole run (see fetch.mjs's fallback path)
  }
}

async function fetchEventPageHtmlOnce(programId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(`${BASE_URL}/event/${programId}`, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`GET event/${programId} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Unlike postSearch, a failure here only affects ONE program's SoldOut
// detection (falls back to whatever the date-window check alone decides) —
// never fatal to the whole run, so it's caught here rather than propagated.
async function fetchAvailabilityEntries(programId) {
  try {
    return parseEventAvailability(await fetchEventPageHtmlOnce(programId));
  } catch (err) {
    logProgress(`OPENTIX: event page fetch failed for ${programId} (1st try): ${err.message}`);
    try {
      return parseEventAvailability(await fetchEventPageHtmlOnce(programId));
    } catch (err2) {
      logProgress(`OPENTIX: event page fetch failed for ${programId}, giving up: ${err2.message}`);
      return [];
    }
  }
}

// Pure so pagination can be tested against a real/fake API response shape
// without any network mocking — real observed shape 2026-09-25: 48 hits at
// 15/page, page 3 (offset 45, 3 found) has nextOffset: null.
export function shouldContinuePaging(result) {
  return (result?.found?.length ?? 0) > 0 && result?.nextOffset != null;
}

/** A program can legitimately appear across multiple category queries (dual-tagged, e.g. "寶塚OG夢幻舞台" in both 戲劇-音樂劇 and 音樂-流行音樂) — id is the one stable identity to dedupe on. */
export function dedupeProgramsById(sourceItems) {
  const byId = new Map();
  for (const item of sourceItems) {
    if (item?.id) byId.set(item.id, item);
  }
  return [...byId.values()];
}

async function fetchPrograms() {
  const allFound = [];
  for (const category of CATEGORIES) {
    let offset;
    while (true) {
      await sleep(SEARCH_DELAY_MS);
      const body = { language: "zh-CHT", categoryFilter: [category], sortBy: "ABOUT_TO_BEGIN" };
      if (offset != null) body.offset = offset;
      const data = await postSearch(body);
      const result = data.result ?? {};
      const found = result.found ?? [];
      for (const item of found) if (item.source) allFound.push(item.source);
      logProgress(`OPENTIX: ${category} offset ${offset ?? 0} - ${found.length} program(s)`);
      if (!shouldContinuePaging(result)) break;
      offset = result.nextOffset;
    }
  }
  return dedupeProgramsById(allFound);
}

export async function fetch() {
  const allPrograms = await fetchPrograms();
  // 9/25 real programs: e.g. "新北市生音藝術節- C MUSICAL韓國授權親子音樂劇"
  // carries BOTH 戲劇-現代戲劇 and 親子-戲劇 — categoryFilter alone can't
  // exclude these (they legitimately match one of the 5 categories too),
  // so this checks the program's own full categories list.
  const programs = allPrograms.filter((p) => !isKidsProgram(p.categories));

  const nowMs = Date.now();
  const results = [];
  let pageFetchCount = 0;
  for (const program of programs) {
    const category = classifyCategory(program.categories);
    const eventVenues = program.eventVenues ?? [];
    // A program whose every session hasn't reached its own onlineStart yet
    // can't possibly be sold out — skip the event-page request entirely.
    const needsPage = eventVenues.some((v) => (v.times ?? []).some((t) => nowMs >= (t.onlineStart ?? Infinity)));
    let availabilityEntries = [];
    if (needsPage) {
      await sleep(PAGE_DELAY_MS);
      availabilityEntries = await fetchAvailabilityEntries(program.id);
      pageFetchCount += 1;
    }
    for (const venue of eventVenues) {
      for (const time of venue.times ?? []) {
        const availability = findAvailability(availabilityEntries, time.start, venue.name);
        const signal = timeSaleSignal(time, availability, nowMs);
        results.push(buildRawEvent(program, venue, time, category, signal));
      }
    }
  }

  logProgress(`OPENTIX: ${programs.length} program(s), ${pageFetchCount} event page(s) fetched, ${results.length} session(s) total`);
  return results;
}
