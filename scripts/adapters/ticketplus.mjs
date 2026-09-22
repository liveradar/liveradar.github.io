import { logProgress } from "../progress-log.mjs";
import { withBrowser, newPage } from "../browser.mjs";

/**
 * Ticket Plus (ticketplus.com.tw, "遠大售票系統") adapter. Added 2026-09-17.
 *
 * By far the cleanest of the five sources: it's a Vue SPA with genuinely no
 * server-rendered HTML at all (a plain fetch of the homepage gets an ~6KB
 * empty shell), but everything it renders comes from a public, unauthenticated
 * JSON API — `apis.ticketplus.com.tw/config/api/v1/getS3?path=...` — that a
 * plain fetch() can call directly. No Cloudflare, no client-side-only data,
 * no freeform-text venue parsing like iNDIEVOX/FANSI GO needed: `sessions.json`
 * has structured `date`/`time`/`location`/`address` fields per session.
 *
 * Three-step fetch: `main/mainEvents.json` lists every currently active
 * event's id (confirmed: `allEventId.length` exactly matches the number of
 * entries in `allEventMainPageInfo` — this is genuinely the full catalog, not
 * just a homepage teaser); `event/{id}/sessions.json` gives each event's
 * individual show dates. A single event can have multiple sessions (e.g. a
 * 2-city tour with different dates/venues per session, or a Taipei run with
 * a matinee and an evening show) — each session becomes its own RawEvent,
 * same as one KKTIX/tixcraft listing row each.
 *
 * Price is the one field NOT in sessions.json's structured data — like
 * tixcraft/iNDIEVOX/FANSI GO it only exists as prose, in `event/{id}/event.json`'s
 * `info` field (the "活動介紹" tab's raw HTML, found 2026-09-18). Fetched once
 * per eventId, not once per session, since normalize.mjs's parsePriceFromText
 * does the actual number extraction from that HTML.
 */

export const name = "Ticket Plus";
export const priority = 5;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const API_BASE = "https://apis.ticketplus.com.tw/config/api/v1/getS3";
// 2026-09-18: lowered from the original blanket 2000ms (§4.3's NFR-04
// default, applied uniformly to every adapter without per-source tuning).
// With incremental fetch now skipping the expensive event.json price call
// for already-known events, sessions.json's own per-eventId delay became the
// pipeline's last remaining bottleneck (~88 eventIds × 2s ≈ 3min, checked on
// every run regardless of what's known, since it's the only way to notice a
// newly added session on an event we already have). This is a lightweight
// JSON GET against a large commercial ticketing platform's public API, not a
// full page load against a small indie venue's site — 500ms is still real
// spacing, not zero.
const REQUEST_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;
const STATUS_NAV_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 2026-09-22 (Max: "結束販售（或已售完）/尚未開賣/現正開賣...如果沒有api或
// 是結構化資料可以確定狀態，那可以從文字內容確認吧"): checked — neither
// sessions.json nor event.json has anything resembling a sale-status field,
// but the actual event PAGE (client-rendered Vue) shows one per session as
// plain text next to each row: "銷售一空" (sold out), "登記截止"
// (registration window for THIS listing closed — real case: MAHIRU's lottery-
// only listing), or nothing at all when the session is currently buyable.
// Confirmed via the real DOM (not the JSON API) that a session's row is
// `.row.pa-4.flex-column.flex-sm-row.no-gutters`, its name is in
// `.font-weight-bold.text-regular`, and the status text (if any) is in
// `.text-title`, matched by exact session.name text against sessions.json.
async function fetchSaleStatusMap(browser, eventId) {
  const page = await newPage(browser);
  try {
    await page.goto(`https://ticketplus.com.tw/activity/${eventId}`, {
      waitUntil: "domcontentloaded",
      timeout: STATUS_NAV_TIMEOUT_MS,
    });
    await page.waitForSelector(".row.pa-4.flex-column.flex-sm-row.no-gutters", { timeout: STATUS_NAV_TIMEOUT_MS });
    // 2026-09-22 real bug, found AFTER this shipped and a full re-fetch quietly
    // lost the YOASOBI sold-out signal Max had just confirmed: `.text-title`
    // is populated by a SEPARATE async call the page makes after the row
    // itself renders — confirmed directly (`.text-title` reads back as `[]`
    // immediately after the row selector resolves, but correctly shows
    // "銷售一空" once that follow-up request settles). Reading it right after
    // the row appears silently got every session's status as "" — no error
    // was ever thrown, so 289 events could go through a full re-fetch with
    // this appearing to work while actually reporting nothing, ever. Waiting
    // for the network to go idle (not a fixed sleep — a genuinely-open
    // session has no such follow-up call to wait for, so this returns as
    // soon as it can either way, ~3s observed for both cases) instead of
    // guessing a delay long enough to be a safe fixed number.
    await page.waitForLoadState("networkidle", { timeout: STATUS_NAV_TIMEOUT_MS }).catch(() => {});
    return await page.$$eval(".row.pa-4.flex-column.flex-sm-row.no-gutters", (rows) =>
      rows.map((row) => ({
        name: row.querySelector(".font-weight-bold.text-regular")?.textContent.trim() ?? "",
        status: row.querySelector(".text-title")?.textContent.trim() ?? "",
      })),
    );
  } finally {
    await page.close();
  }
}

async function fetchJsonOnce(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(`${API_BASE}?path=${encodeURIComponent(path)}`, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(path) {
  try {
    return await fetchJsonOnce(path);
  } catch (err) {
    logProgress(`ticketplus retry: ${path} - ${err.message}`);
    return await fetchJsonOnce(path);
  }
}

export async function fetch(knownRawIds = new Set()) {
  logProgress("fetching Ticket Plus main event list");
  const main = await fetchJson("main/mainEvents.json");
  const eventIds = main.allEventId ?? [];
  logProgress(`Ticket Plus: ${eventIds.length} event(s) listed`);

  const results = [];
  let skippedEventCount = 0;
  let statusFailures = 0;
  await withBrowser(async (browser) => {
    for (const eventId of eventIds) {
      await sleep(REQUEST_DELAY_MS);
      let sessionsData;
      try {
        sessionsData = await fetchJson(`event/${eventId}/sessions.json`);
      } catch (err) {
        logProgress(`ticketplus sessions fetch failed for ${eventId}: ${err.message}`);
        continue;
      }

      const sessions = (sessionsData.sessions ?? []).filter(
        (s) => !s.hidden && !s.name?.includes("周邊商品"), // withdrawn session / merch pre-order, same filters as before
      );
      if (sessions.length === 0) continue;

      // 2026-09-18, incremental fetch: sessions.json is still checked for
      // EVERY eventId, every run — it's the only way to notice a newly added
      // session (e.g. a tour adding a city) on an event we already know about.
      // But if every one of this eventId's sessions is already known, there's
      // nothing new to normalize, so skip the event.json price call entirely
      // (that's the one that used to double Ticket Plus's own fetch time) and
      // let fetch.mjs reuse each session's previous normalized data instead.
      const sessionRawIds = sessions.map((s) => `${eventId}_${s.sessionId}`);
      if (sessionRawIds.every((rawId) => knownRawIds.has(rawId))) {
        skippedEventCount += 1;
        for (const rawId of sessionRawIds) {
          results.push({ raw_id: rawId, source_name: name, reuse_previous: true });
        }
        continue;
      }

      // Price lives in this event's own freeform "活動介紹" (info) field, not
      // in sessions.json (structured but has no price field at all) — fetched
      // once per eventId, not once per session, since price is one value for
      // the whole event, not per session/city (2026-09-18). A failure here
      // isn't fatal to the event itself, just leaves its price unparsed.
      //
      // No separate sleep before this one: it piggybacks on the same eventId
      // iteration as sessions.json above, right after it — a real measured run
      // of a second REQUEST_DELAY_MS here doubled Ticket Plus's own total fetch
      // time (~3min to ~6min out of ~14min for the whole pipeline) for very
      // little politeness benefit over a same-eventId back-to-back pair; the
      // 2s gap BETWEEN different eventIds (the sleep above) is what actually
      // paces the request rate against the server.
      let priceTextRaw = "";
      try {
        const eventData = await fetchJson(`event/${eventId}/event.json`);
        priceTextRaw = eventData.info ?? "";
      } catch (err) {
        logProgress(`ticketplus event.json fetch failed for ${eventId}: ${err.message}`);
      }

      // 2026-09-22 (Max): per-session sale status ("銷售一空"/"登記截止"),
      // see fetchSaleStatusMap's doc comment — only source for this, no JSON
      // API has it. One Playwright page load per eventId, same cost class as
      // the price fetch this is piggybacking after.
      let statusRows = [];
      try {
        statusRows = await fetchSaleStatusMap(browser, eventId);
      } catch (err) {
        statusFailures += 1;
        logProgress(`ticketplus sale-status fetch failed for ${eventId}: ${err.message}`);
      }
      const statusByName = new Map(statusRows.map((r) => [r.name, r.status]));

      for (const session of sessions) {
        results.push({
          raw_id: `${eventId}_${session.sessionId}`,
          url: `https://ticketplus.com.tw/activity/${eventId}`,
          title_raw: session.name,
          // "location / address" mirrors KKTIX's venue_raw shape exactly, so
          // normalize.mjs reuses parseKktixVenue for this source too.
          venue_raw: `${session.location ?? ""} / ${session.address ?? ""}`,
          // date+time concatenated into one string for parseTicketPlusDate to
          // split — RawEvent only has a single date_raw field.
          date_raw: `${session.date ?? ""} ${session.time ?? ""}`,
          tickets_raw: [],
          price_text_raw: priceTextRaw,
          sale_status_text: statusByName.get(session.name) ?? "",
          source_name: name,
        });
      }
    }
  });
  if (statusFailures > 0) {
    logProgress(`Ticket Plus: sale-status fetch failed for ${statusFailures} event(s)`);
  }

  logProgress(`Ticket Plus: ${results.length} session(s) fetched (${skippedEventCount} event(s) fully known, price fetch skipped)`);
  return results;
}
