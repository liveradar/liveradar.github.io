import { combineSaleSignals } from "../sale-signal.mjs";
import { logProgress } from "../progress-log.mjs";
import { parseVenueLine } from "./indievox.mjs";
import { withPage } from "../browser.mjs";

/**
 * ibon (ticket.ibon.com.tw) adapter, "娛樂" (entertainment) category only.
 * Added 2026-09-26 (PLAN-2-ibon.md). 9/25 research found the "娛樂" category
 * (30 activities) has zero overlap with the other 6 sources — real, live
 * shows (KANA-BOON at Legacy Taipei, 時速36公里 at PIPE, 厄倫蒂兒 at Zepp New
 * Taipei, ...) sold ONLY through ibon.
 *
 * Plain HTTP POST no longer works (2026-11-26: Cloudflare traffic control +
 * XSRF token) — calls run inside a Playwright page, see postJsonOnce.
 * robots.txt only disallows the queue-control pages (/Home/TicketflowControl, /UnderControl*,
 * /trafpage/) — everything used here is allowed.
 *
 * Two-step fetch, both public JSON APIs a browser calls itself:
 *  1. api/Result/GetResultData (CategoryCode: "entertainment") — the full
 *     list, one representative session per activity (NOT every session —
 *     e.g. 藤本洸大's 午場/晚場 only shows one of the two here).
 *  2. api/ActivityInfo/GetGameInfoList per ActivityID — every real session
 *     ("game"), each with its own sale window/inventory signal. A single
 *     performance is often split into MULTIPLE games (different ticket
 *     tiers/presale phases — BANG YONGGUK has 4 games for one showtime),
 *     so games are merged by (start date+time, venue) before becoming one
 *     RawEvent.
 */

export const name = "ibon";
export const priority = 7;

const BASE_URL = "https://ticket.ibon.com.tw";
const REQUEST_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;
const LIST_PAGE_SIZE = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 2026-11-26: ibon turned on Cloudflare traffic control (plain HTTP -> 403
// "流量控管") AND an Angular XSRF check (API -> 400 without an X-XSRF-TOKEN
// header copied from the XSRF-TOKEN cookie). Both pass only from inside a
// real browser page, so every API call is a fetch() run in that page.
// ponytail: module-level page, so no concurrent fetch() calls in one process; pass the page down if that is ever needed
let apiPage = null;

async function postJsonOnce(path, body) {
  return apiPage.evaluate(
    async ({ path, body, timeoutMs }) => {
      const token = decodeURIComponent((document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/) ?? [])[1] ?? "");
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
      return res.json();
    },
    { path, body, timeoutMs: REQUEST_TIMEOUT_MS },
  );
}

async function postJson(path, body) {
  try {
    return await postJsonOnce(path, body);
  } catch (err) {
    logProgress(`ibon retry: ${path} - ${err.message}`);
    return await postJsonOnce(path, body); // a second failure throws and propagates — see fetch()'s doc comment
  }
}

// The API result's ActivityContent is HTML-escaped ONCE on top of being
// HTML itself — "&lt;p&gt;...&lt;/p&gt;" — decode the entities back before
// handing it to parsePriceFromText/parseVenueLine, which expect real HTML.
export function decodeHtmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// "2026/11/15(日) 18:00\r\n" -> "2026-11-15 18:00" (parseTicketPlusDate's
// shape). An exhibition's date range ("2026/10/08(四) 10:00\r\n ~
// 2026/10/11(日) 18:00") is a multi-day span, not a single showtime — only
// the FIRST date/time is used, same convention as every other adapter's
// "date_raw has a range, take the start" handling (e.g. billboard.mjs).
export function parseShowSaleDate(raw) {
  const m = (raw ?? "").match(/(\d{4})\/(\d{2})\/(\d{2}).*?(\d{2}):(\d{2})/s);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, dateRaw: `${y}-${mo}-${d} ${h}:${mi}` };
}

/**
 * Per-game sale signal (sale-signal.mjs vocabulary), from GetGameInfoList's
 * own SoldOut/StartDT/EndDT/CanBuy fields — checked in this order:
 * SoldOut -> SOLD_OUT; before StartDT -> COMING_SOON (with that start time
 * as on_sale_at); past EndDT -> REGISTRATION_CLOSED; CanBuy -> IN_STOCK;
 * otherwise no signal.
 */
export function gameSaleSignal(game, nowMs = Date.now()) {
  if (game.SoldOut) return { sale_signal: "SOLD_OUT", on_sale_at: null };
  const startMs = game.StartDT ? Date.parse(`${game.StartDT}+08:00`) : NaN;
  if (!Number.isNaN(startMs) && nowMs < startMs) {
    return { sale_signal: "COMING_SOON", on_sale_at: `${game.StartDT}+08:00` };
  }
  const endMs = game.EndDT ? Date.parse(`${game.EndDT}+08:00`) : NaN;
  if (!Number.isNaN(endMs) && nowMs > endMs) {
    return { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null };
  }
  if (game.CanBuy) return { sale_signal: "IN_STOCK", on_sale_at: null };
  return { sale_signal: null, on_sale_at: null };
}

/**
 * Merges every game sharing the same (start date+time, venue) — a single
 * real performance split across multiple ticket-tier/presale-phase
 * listings — into one combined signal, earliest StartDT winning ties for
 * a COMING_SOON on_sale_at. Games are sorted by StartDT first so
 * combineSaleSignals sees the earliest COMING_SOON candidate first.
 */
export function groupGamesIntoSessions(games, nowMs = Date.now()) {
  const sorted = [...games].sort((a, b) => (a.StartDT ?? "").localeCompare(b.StartDT ?? ""));
  const byKey = new Map();
  for (const game of sorted) {
    const parsed = parseShowSaleDate(game.ShowSaleDate);
    if (!parsed) continue;
    const key = `${parsed.dateRaw}::${game.VenueRegion ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, { parsed, venue: game.VenueRegion ?? "", games: [] });
    byKey.get(key).games.push(game);
  }
  return [...byKey.values()].map(({ parsed, venue, games: groupGames }) => ({
    parsed,
    venue,
    signal: combineSaleSignals(groupGames.map((g) => gameSaleSignal(g, nowMs))) ?? { sale_signal: null, on_sale_at: null },
  }));
}

async function fetchActivityList() {
  const rows = [];
  let pageIndex = 0;
  while (true) {
    await sleep(REQUEST_DELAY_MS);
    const data = await postJson("/api/Result/GetResultData", {
      id: "",
      Location: "",
      CategoryCode: "entertainment",
      StartDate: "",
      EndDate: "",
      ATAP: "",
      ATAPW: "",
      PageIndex: pageIndex,
      PageSize: LIST_PAGE_SIZE,
    });
    const item = data.Item ?? {};
    const pageRows = item.Rows ?? [];
    rows.push(...pageRows);
    logProgress(`ibon: list page ${pageIndex} - ${pageRows.length} row(s), total so far ${rows.length}/${item.Total ?? "?"}`);
    if (pageRows.length === 0 || rows.length >= (item.Total ?? 0)) break;
    pageIndex += 1;
  }
  return rows;
}

async function fetchGames(activityId) {
  try {
    const data = await postJson("/api/ActivityInfo/GetGameInfoList", { id: activityId, hasDeadline: true, SystemBrowseType: 0 });
    return data.Item?.GIHtmls ?? [];
  } catch (err) {
    logProgress(`ibon: GetGameInfoList failed for activity ${activityId}: ${err.message}`);
    return [];
  }
}

export async function fetch() {
  return withPage(async (page) => {
    // The list page makes the site set its XSRF cookie and clear Cloudflare.
    await page.goto(`${BASE_URL}/Result?id=&Location=&StartDate=&EndDate=&CategoryCode=entertainment`, { waitUntil: "networkidle", timeout: 40000 });
    apiPage = page;
    try {
      return await fetchAll();
    } finally {
      apiPage = null;
    }
  });
}

async function fetchAll() {
  const rows = await fetchActivityList();
  // "entertainment,exhibition" (a real dual-tagged row seen 9/25) is still
  // an exhibition at heart — excluded the same as a plain "exhibition" row.
  const entertainmentRows = rows.filter((r) => (r.ActivityCategoryCode ?? "").split(",").every((c) => c !== "exhibition"));

  const nowMs = Date.now();
  const results = [];
  for (const row of entertainmentRows) {
    await sleep(REQUEST_DELAY_MS);
    const games = await fetchGames(row.ActivityID);
    if (games.length === 0) continue;
    const sessions = groupGamesIntoSessions(games, nowMs);
    const contentHtml = decodeHtmlEntities(row.ActivityContent ?? "");
    // parseVenueLine (shared with indievox.mjs) pulls the "場地：X（address）"
    // line out of the free-text content — that address is what
    // parseKktixVenue (normalize.mjs's default) actually needs to resolve a
    // city; VenueRegion alone is often just a bare venue name with no
    // address of its own (e.g. "SUB LIVE").
    const venueLine = parseVenueLine(contentHtml) ?? "";
    for (const session of sessions) {
      results.push({
        raw_id: `${row.ActivityID}_${session.parsed.date.replace(/-/g, "")}${session.parsed.time.replace(":", "")}`,
        url: `${BASE_URL}/ActivityInfo/Details/${row.ActivityID}`,
        title_raw: row.ActivityName,
        venue_raw: `${session.venue} / ${venueLine}`,
        date_raw: session.parsed.dateRaw,
        tickets_raw: [],
        price_text_raw: contentHtml,
        sale_status_text: "",
        register_status: session.signal.sale_signal,
        on_sale_at: session.signal.on_sale_at,
        source_name: name,
      });
    }
  }

  logProgress(`ibon: ${entertainmentRows.length} activity(ies), ${results.length} session(s) total`);
  return results;
}
