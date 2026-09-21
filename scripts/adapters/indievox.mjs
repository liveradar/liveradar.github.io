import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";

/**
 * iNDIEVOX adapter. Added 2026-09-17 while chasing M12's coverage gap — this
 * platform is server-rendered (no Cloudflare, unlike KKTIX's search endpoint
 * or tixcraft's detail pages) and lists the whole site's activity, not just
 * a curated venue list, so it doesn't need KKTIX's ORG_PAGE/SEARCH split.
 *
 * Two-step fetch per event, same shape as KKTIX: the listing page only has
 * title+date; venue/price/organizer live in a freeform "活動資訊" text block
 * on each event's own detail page (organizer-authored, not a strict CMS
 * field — format varies, see parseVenueLine below for what's handled).
 */

export const name = "iNDIEVOX";
export const priority = 3;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ROUNDS = 15; // listing pages are date-windowed (~7 days each); safety cap on pagination

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // globalThis.fetch, not bare fetch — see kktix.mjs's identical warning;
    // this file's own exported `fetch` shadows the global one the same way.
    const res = await globalThis.fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url) {
  try {
    return await fetchOnce(url);
  } catch (err) {
    logProgress(`indievox retry: ${url} - ${err.message}`);
    return await fetchOnce(url);
  }
}

function formatDateParam(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026/09/19 (六)" -> "2026-09-19"; used only to paginate, normalize.mjs re-parses the real date_raw per event. */
function parseListDate(raw) {
  const m = raw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function fetchListingPage(startDate) {
  const url = `https://www.indievox.com/activity/list?type=card&startDate=${formatDateParam(startDate)}&endDate=`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];
  $("div.thumbnails.activity a[href*='/activity/detail/']").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).find(".multi_ellipsis").first().text().trim();
    const date_raw = $(el).find(".date").first().text().trim();
    if (href && title) items.push({ url: href, title_raw: title, date_raw });
  });
  return items;
}

/** Best-effort: pulls "地點｜X" / "地點：X" (fullwidth or ASCII separator, optionally wrapped in one or more tags) out of the detail page's freeform info block. Organizer-authored text, not a strict field — absence just means this event falls back to venues.yml/city:null downstream, same as tixcraft's untracked venues. */
// 2026-09-21 real bug: organizers use at least 3 different labels for this
// field — "地點" (originally the only one handled), "場地" (26_iv0418516:
// "場地：迴響音樂展演空間"), and "場館" (26_iv04186a4: "場館｜迴響音樂展演空間"
// — same venue, different organizer, different label). Every event using
// either of the other two labels had venue_raw come back completely empty,
// city always "未知" — not even the venues.yml fallback got a chance to run
// since there was no venue name text to look up at all.
function parseVenueLine(html) {
  const m = html.match(/(?:地點|場地|場館)[｜:：]\s*(?:<[^>]+>\s*)*([^<\n]{2,60})/);
  return m ? m[1].trim() : null;
}

/**
 * "日期｜2026.09.19 (Sat.) 19:30 open / 20:00 start" -> raw string
 * normalize.mjs's parseIndievoxDate re-parses. Some events have MULTIPLE
 * "日期" labels on the page (e.g. a per-tier order table further down using
 * a year-less "日期：9/19" — found via a real event, 26_iv04172f6) — only
 * accept a match that actually contains a 4-digit year, since a year-less
 * one is useless and the listing page's date_raw (always full "YYYY/MM/DD")
 * is a strictly better fallback than a wrong/partial detail-page match.
 */
function parseDateLine(html) {
  const m = html.match(/日期[｜:：]\s*(?:<[^>]+>\s*)*([^<\n]{2,80})/);
  return m && /\d{4}/.test(m[1]) ? m[1].trim() : null;
}

/**
 * "票價：Shhh! ALL IN｜三場套票 9900元 / ..." -> raw clause, same freeform-info
 * block as the date/venue lines above, normalize.mjs's parsePriceFromText
 * pulls the actual numbers back out. 200 chars (not date/venue's 60-80) since
 * a multi-tier price list runs a lot longer than a venue name.
 */
function parsePriceLine(html) {
  const m = html.match(/票價[｜:：]\s*(?:<[^>]+>\s*)*([^<\n]{2,200})/);
  return m ? m[1].trim() : null;
}

async function fetchEventDetail(item) {
  const html = await fetchHtml(item.url);
  const venue_raw = parseVenueLine(html) ?? "";
  const date_raw = parseDateLine(html) ?? item.date_raw;
  const raw_id = item.url.split("/").filter(Boolean).pop();
  return {
    raw_id,
    url: item.url,
    title_raw: item.title_raw,
    date_raw,
    venue_raw,
    tickets_raw: [],
    price_text_raw: parsePriceLine(html) ?? "",
    source_name: name,
  };
}

export async function fetch(knownRawIds = new Set()) {
  const results = [];
  const seen = new Set();
  let cursor = new Date();
  let skippedKnown = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    await sleep(REQUEST_DELAY_MS);
    logProgress(`fetching indievox listing from ${formatDateParam(cursor)}`);
    let items;
    try {
      items = await fetchListingPage(cursor);
    } catch (err) {
      logProgress(`indievox listing failed at ${formatDateParam(cursor)}: ${err.message}`);
      break;
    }

    let maxDateSeen = null;
    let newCount = 0;
    for (const item of items) {
      const iso = parseListDate(item.date_raw);
      if (iso && (!maxDateSeen || iso > maxDateSeen)) maxDateSeen = iso;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      newCount += 1;

      // 2026-09-18, incremental fetch: an event already recognized last run
      // skips its own detail-page fetch entirely (no delay either, since
      // there's no request to pace) — fetch.mjs reuses its previous
      // normalized data instead (see reuse_previous in runAdapter()).
      const raw_id = item.url.split("/").filter(Boolean).pop();
      if (knownRawIds.has(raw_id)) {
        skippedKnown += 1;
        results.push({ raw_id, url: item.url, title_raw: item.title_raw, source_name: name, reuse_previous: true });
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      try {
        results.push(await fetchEventDetail(item));
      } catch (err) {
        logProgress(`indievox event detail failed for ${item.url}: ${err.message}`);
      }
    }

    logProgress(`indievox round ${round + 1}: ${items.length} card(s), ${newCount} new`);
    if (!maxDateSeen || newCount === 0) break; // reached the end of the listing
    cursor = new Date(maxDateSeen);
    cursor.setDate(cursor.getDate() + 1); // next window starts the day after the latest date seen
  }

  logProgress(`indievox: ${results.length} event(s) fetched (${skippedKnown} already known, detail fetch skipped)`);
  return results;
}
