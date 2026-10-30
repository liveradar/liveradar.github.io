import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";

/**
 * 高雄流行音樂中心 (kpmc.com.tw) adapter — 音浪塔 only. Added 2026-10-30.
 *
 * Why this exists: artists.tw lists 13 音浪塔 shows in the next 180 days, we
 * had 0. 音浪塔 is run by the center itself and sells at the door / via the
 * organizer, so none of the ticket platforms carry it. Every other KPMC
 * venue (LIVE WAREHOUSE 大庫/小庫, 海音館, 鯨魚堤岸) already comes in through
 * KKTIX / iNDIEVOX / 拓元 etc., so this deliberately skips them rather than
 * creating a second card for the same show.
 *
 * `/program/` is a Vue page, but its whole upcoming catalog is embedded in
 * the static HTML as `var items={"Jan":[...],...}` (month -> shows, months
 * with nothing are null) — no browser, no API call. Each show has
 * year / date_time ("11.01 (Sun) 19:30") / location / state / link /
 * show_category. show_category 134 is 演出; 136 展覽, 140 課程, 142 other
 * (市集, 電影海報販售展, 爵式 Open Jam), 401 公告 — only 134 is a concert.
 *
 * The list has no price, so each kept show's own page is fetched for the
 * 「票價資訊」 block (e.g. "單人500元 / 現場收費"). A failed detail fetch just
 * leaves the price empty — the show still lists.
 */

export const name = "高雄流行音樂中心";
export const priority = 12;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const LIST_URL = "https://kpmc.com.tw/program/";
const VENUE_RAW = "音浪塔 高音塔 / 高雄市鹽埕區真愛路1號"; // address from the site footer; "/" splits it the way parseKktixVenue expects
const CONCERT_CATEGORY = 134;
const REQUEST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pulls the `var items={...}` object out of the list page; null if absent. */
export function extractItems(html) {
  const start = html.indexOf("var items=");
  if (start === -1) return null;
  const open = html.indexOf("{", start);
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = open; i < html.length; i++) {
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
      if (depth === 0) return JSON.parse(html.slice(open, i + 1));
    }
  }
  return null;
}

export function isWaveTowerConcert(item) {
  return Number(item.show_category) === CONCERT_CATEGORY && /音浪塔/.test(item.location ?? "");
}

/** "11.01 (Sun) 19:30" + year "2026" -> "2026-11-01 19:30"; null if unparseable. */
export function toDateRaw(item) {
  const m = /^(\d{2})\.(\d{2})\s*\([A-Za-z]+\)\s*(\d{2}):(\d{2})/.exec(item.date_time ?? "");
  if (!m || !/^\d{4}$/.test(item.year ?? "")) return null;
  return `${item.year}-${m[1]}-${m[2]} ${m[3]}:${m[4]}`;
}

/** Text lines under the detail page's 「票價資訊」 heading, e.g. ["單人500元", "現場收費"]. */
export function parsePriceLines(html) {
  const $ = cheerio.load(html);
  const lines = [];
  $(".m-single-info__item").each((_, item) => {
    if ($(item).find(".m-single-info__title").first().text().trim() !== "票價資訊") return;
    $(item)
      .find(".m-single-info__paragraph")
      .each((__, p) => lines.push($(p).text().trim()));
  });
  return lines.filter(Boolean);
}

// "門票含100元餐飲抵用券" / "單人400元 含150元午茶飲品": the 含-clause is a
// voucher inside the ticket price, not a cheaper ticket — left in, it became
// price_min (real: Jun Iida 11/1 showed 100–700 instead of 700).
const INCLUDED_ITEM_RE = /(?:門票)?含\s*\d[\d,]*\s*元\S*/g;
// "雙人900元" is the price for two, not a dearer ticket — it would inflate
// price_max (Billboard Live's "pair" tiers are dropped for the same reason).
const PAIR_PRICE_RE = /雙人\s*\d[\d,]*\s*元/g;

export function itemToRawEvent(item, priceLines) {
  const dateRaw = toDateRaw(item);
  if (!dateRaw) return null;
  return {
    raw_id: String(item.id),
    url: item.link,
    // The list embeds HTML entities in titles ("Chill &#038; High").
    title_raw: cheerio.load(`<p>${item.desc}</p>`)("p").text().trim(),
    venue_raw: VENUE_RAW,
    date_raw: dateRaw,
    tickets_raw: [],
    // parsePriceFromText only looks under a 票價 label.
    price_text_raw: priceLines.length ? `票價：${priceLines.join(" ").replace(INCLUDED_ITEM_RE, "").replace(PAIR_PRICE_RE, "").replace(/\s+/g, " ").trim()}` : "",
    sale_status_text: "",
    register_status: item.state === "soldout" ? "SOLD_OUT" : null,
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

export async function fetch() {
  const items = extractItems(await getHtml(LIST_URL));
  if (!items) throw new Error("kpmc: `var items=` not found on /program/ — page layout changed?");
  const shows = Object.values(items).flatMap((month) => month ?? []).filter(isWaveTowerConcert);

  const results = [];
  for (const item of shows) {
    let priceLines = [];
    try {
      await sleep(REQUEST_DELAY_MS);
      priceLines = parsePriceLines(await getHtml(item.link));
    } catch (err) {
      logProgress(`高雄流行音樂中心: price fetch failed for ${item.link}: ${err.message}`);
    }
    const raw = itemToRawEvent(item, priceLines);
    if (raw) results.push(raw);
  }
  logProgress(`高雄流行音樂中心: ${results.length} 音浪塔 show(s)`);
  return results;
}
