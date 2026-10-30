import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";
import { withPage } from "../browser.mjs";
import { toTaiwanDateTimeDash } from "../taiwan-time.mjs";

/**
 * Blue Note Taipei (bluenotetaipei.com) adapter. Added 2026-10-30.
 *
 * A jazz club that books its own nights (RSVP only, door charge) — none of
 * it is on a ticket platform. artists.tw lists ~18 of its shows; we had 0.
 *
 * The site is Wix. `/events` is just a single-event page template (it shows
 * the next show, not a list); the real schedule is `/shows`, a Wix events
 * widget whose first page is embedded in the static HTML as full event
 * objects (`{"id":..., "scheduling":{"config":{"startDate":<UTC ISO>...}},
 * "title":...,"slug":...}`). That page holds only the next ~18 shows (about
 * three weeks); the rest sit behind the widget's 載入更多 button, which calls
 * `/_api/wix-one-events-server/web/paginated-events/viewer` (same event
 * objects, plus `total` and `hasMore`). So the list is read with Playwright:
 * open /shows, click 載入更多 until it's gone, and collect every event from
 * the page's own embedded data plus those API responses (2026-10-30: 18 + 15
 * = 33 shows, through late December). The load is checked against the API's
 * `total` — a short count throws, so a half-loaded page can't silently drop
 * shows (fetch.mjs keeps last run's events when an adapter throws). The
 * sitemap's 2,228 event URLs are no help — its lastmod isn't the show date.
 *
 * The list carries no price (`about` is empty there); it's in the show's own
 * page as a paragraph like "NT$550 入場費含一份選定飲料 …", so each show's
 * page is fetched once. A failed fetch leaves the price empty.
 *
 * Titles use Unicode "mathematical" letters/digits for style
 * ("𝖡𝖺𝗅𝖺𝗇𝖼𝖾𝖽 … | 𝟣𝟢𝟥𝟢"); NFKC turns them back into plain text, and the
 * trailing 4-digit date code the club appends ("1030") is dropped.
 */

export const name = "Blue Note Taipei";
export const priority = 13;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const BASE_URL = "https://www.bluenotetaipei.com";
const REQUEST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_LOAD_MORE_ATTEMPTS = 10; // 2 real clicks load everything today; the rest is slack for a hydration miss
const LOAD_MORE_API_RE = /paginated-events\/viewer/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every Wix event object ({"id":..., "scheduling":{"config"...}, ...}) embedded in the page. */
export function extractEvents(html) {
  const events = new Map();
  for (const m of html.matchAll(/"scheduling":\{"config"/g)) {
    const start = html.lastIndexOf('{"id":"', m.index);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const ev = JSON.parse(html.slice(start, i + 1));
            if (ev.id && ev.slug && ev.scheduling?.config?.startDate) events.set(ev.id, ev);
          } catch {
            // a malformed object just doesn't make the list
          }
          break;
        }
      }
    }
  }
  return [...events.values()];
}

// The club's date code is MMDD ("1030"), always after a space or "|" — a
// bare trailing year ("Jazz Night 2026") must survive.
const DATE_CODE_RE = /(?:\s+|\s*[|｜]\s*)(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s*$/;

export function cleanTitle(title) {
  return title
    .normalize("NFKC")
    .replace(DATE_CODE_RE, "")
    .replace(/\s*[|｜]\s*$/, "")
    .trim();
}

/** "票價：NT$550 …" from the first paragraph of the show page that has an NT$ amount; "" if none. */
export function parsePriceText(html) {
  const $ = cheerio.load(html);
  let found = "";
  $("[data-ricos-paragraph]").each((_, p) => {
    const text = $(p).text().replace(/\s+/g, " ").trim();
    if (!found && /NT\$\s*\d/.test(text)) found = text;
  });
  return found ? `票價：${found}` : "";
}

export function eventToRawEvent(ev, priceText) {
  // status 0 = scheduled; anything else (cancelled/ended/draft) isn't a show to list.
  if (ev.status !== 0 || Number.isNaN(Date.parse(ev.scheduling.config.startDate))) return null;
  const dateRaw = toTaiwanDateTimeDash(ev.scheduling.config.startDate);
  return {
    raw_id: `${ev.id}_${dateRaw.replace(/\D/g, "")}`,
    url: `${BASE_URL}/events/${ev.slug}`,
    title_raw: cleanTitle(ev.title),
    venue_raw: `${ev.location?.name ?? "Blue Note Taipei 台北藍調"} / ${ev.location?.address ?? ""}`,
    date_raw: dateRaw,
    tickets_raw: [],
    price_text_raw: priceText,
    sale_status_text: "",
    register_status: null,
    source_name: name,
  };
}

async function getHtml(url) {
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

/**
 * Every upcoming show, via a real browser (see the header). Exported pieces
 * stay pure; only this touches Playwright.
 */
export async function loadAllEvents() {
  return withPage(async (page) => {
    const byId = new Map();
    let expectedTotal = null;
    const add = (ev) => {
      if (ev?.id && ev.slug && ev.scheduling?.config?.startDate) byId.set(ev.id, ev);
    };
    page.on("response", async (res) => {
      if (!LOAD_MORE_API_RE.test(res.url())) return;
      try {
        const body = await res.json();
        for (const ev of body.events ?? []) add(ev);
        if (typeof body.total === "number") expectedTotal = body.total;
      } catch (err) {
        logProgress(`Blue Note Taipei: unreadable load-more response: ${err.message}`);
      }
    });

    await page.goto(`${BASE_URL}/shows`, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
    const button = page.getByText("載入更多", { exact: true }).first();
    await button.waitFor({ state: "visible", timeout: REQUEST_TIMEOUT_MS }).catch(() => {}); // no button = nothing more to load
    for (const ev of extractEvents(await page.content())) add(ev);

    for (let attempt = 0; attempt < MAX_LOAD_MORE_ATTEMPTS; attempt++) {
      if (!(await button.isVisible().catch(() => false))) break;
      // A click before the widget has hydrated does nothing, so wait for the
      // API call each click should trigger and just click again if none came.
      await Promise.all([
        page.waitForResponse((r) => LOAD_MORE_API_RE.test(r.url()), { timeout: 8000 }).catch(() => null),
        button.click({ timeout: 8000 }).catch(() => {}),
      ]);
      await page.waitForTimeout(500);
    }
    if (await button.isVisible().catch(() => false)) {
      throw new Error(`bluenote: 載入更多 still showing after ${MAX_LOAD_MORE_ATTEMPTS} attempts`);
    }
    if (expectedTotal != null && byId.size < expectedTotal) {
      throw new Error(`bluenote: loaded ${byId.size} of ${expectedTotal} shows`);
    }
    return [...byId.values()];
  });
}

export async function fetch() {
  const events = await loadAllEvents();
  if (events.length === 0) throw new Error("bluenote: no event objects found on /shows — page layout changed?");

  const results = [];
  for (const ev of events) {
    let priceText = "";
    try {
      await sleep(REQUEST_DELAY_MS);
      priceText = parsePriceText(await getHtml(`${BASE_URL}/events/${ev.slug}`));
    } catch (err) {
      logProgress(`Blue Note Taipei: price fetch failed for ${ev.slug}: ${err.message}`);
    }
    const raw = eventToRawEvent(ev, priceText);
    if (raw) results.push(raw);
  }
  logProgress(`Blue Note Taipei: ${results.length} show(s)`);
  return results;
}
