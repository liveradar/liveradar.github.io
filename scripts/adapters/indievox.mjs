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

// 2026-09-22 real bug (Max: "還有很多, 我沒有時間一個一個抓" — this was
// clearly not a one-off, so fixed the extraction mechanism instead of one
// event): the old approach only tolerated tags BEFORE the value started
// (`(?:<[^>]+>\s*)*` prefix, then `[^<\n]{2,N}` demanding unbroken plain text
// after that). Real organizer text often has tags scattered THROUGHOUT the
// value too — e.g. EmptyORio's price line (26_iv041598a) is Outlook-paste
// debris: `票價：<span data-olk-copy-source="MessageBody">家己擔單人</span>
// <span>預售</span><span>票</span>&nbsp;1000 元 / ...` — every organizer-authored
// field on this platform is one un-sanitized paste away from this. The old
// regex's capture group stopped dead at the first `<`, returning just "家己擔
// 單人" and silently losing every number.
//
// First fix attempt (capture up to the next `<br`) was ALSO wrong — audited
// every one of the 70 known iNDIEVOX events against it and found 3 new
// regressions: some organizers close each field with `</p><p>` instead of
// `<br` (26_iv0411494 — no `<br` for paragraphs, capture ran unbounded into
// the NEXT field and beyond), which produced garbled multi-field blobs, worse
// than the original bug. Block-level tags (`<p>`/`<div>`/`<li>`, not just
// `<br>`) are what actually separates one field from the next on this
// platform — reusing normalize.mjs's htmlToLines() strategy (turn block tags
// into real line breaks, strip inline tags, keep each field on its own
// logical line) sidesteps the "how far do I capture" guess entirely.
//
// One more real shape found during that same audit (26_iv041871d): a label
// sometimes sits alone on its own line with nothing after the separator
// ("票價 :" as its own `<div>`), and the actual values are itemized on the
// following lines ("預售票 : 450元", "現場票 : 500元") — collect forward until
// a blank line or another recognized label starts, instead of giving up.
function htmlToFieldLines(html) {
  return html
    .replace(/<(?:br|p|div|li)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const FIELD_LABEL_RE = /^(?:地點|場地|場館|日期|票價|門票|演出者|售票時間|售票平台)/;

function extractLabeledField(html, keywordPattern, maxLen) {
  const lines = htmlToFieldLines(html);
  // 20 chars, not 10 — real case (26_iv0421681): "票價資訊 Ticket Price：" has
  // 13 characters of bilingual filler between the keyword and the actual
  // separator. Safe to be generous here since this now runs per-line (each
  // line already block-tag-bounded to one field), not across the whole page.
  const labelRe = new RegExp(`${keywordPattern}[^｜:：]{0,20}[｜:：]\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    let value = m[1].trim();
    if (!value) {
      const extra = [];
      for (let j = i + 1; j < lines.length && extra.length < 6; j++) {
        if (FIELD_LABEL_RE.test(lines[j])) break;
        extra.push(lines[j]);
      }
      value = extra.join(" / ");
    }
    value = value.slice(0, maxLen).trim();
    if (value) return value;
  }
  return null;
}

/** Best-effort: pulls "地點｜X" / "地點：X" (fullwidth or ASCII separator) out of the detail page's freeform info block. Organizer-authored text, not a strict field — absence just means this event falls back to venues.yml/city:null downstream, same as tixcraft's untracked venues. */
// 2026-09-21 real bug: organizers use at least 3 different labels for this
// field — "地點" (originally the only one handled), "場地" (26_iv0418516:
// "場地：迴響音樂展演空間"), and "場館" (26_iv04186a4: "場館｜迴響音樂展演空間"
// — same venue, different organizer, different label). Every event using
// either of the other two labels had venue_raw come back completely empty,
// city always "未知" — not even the venues.yml fallback got a chance to run
// since there was no venue name text to look up at all.
function parseVenueLine(html) {
  // 2026-09-21 real bug (found during a full re-normalize sweep, not a
  // one-off report): "活動地點 ｜CLAPPER STUDIO..." — a space between the
  // label and the separator (｜:：), which required-adjacent regex rejected
  // outright, same as parseDateLine's "日期及時間" fix below — allow a short
  // flexible run of characters (prefix text, whitespace, whatever) between
  // the keyword and the actual separator instead of requiring them adjacent.
  return extractLabeledField(html, "(?:地點|場地|場館)", 200);
}

/**
 * "日期｜2026.09.19 (Sat.) 19:30 open / 20:00 start" -> raw string
 * normalize.mjs's parseIndievoxDate re-parses. Some events have MULTIPLE
 * "日期" labels on the page (e.g. a per-tier order table further down using
 * a year-less "日期：9/19" — found via a real event, 26_iv04172f6) — only
 * accept a match that actually contains a 4-digit year, since a year-less
 * one is useless and the listing page's date_raw (always full "YYYY/MM/DD")
 * is a strictly better fallback than a wrong/partial detail-page match.
 *
 * 2026-09-21 real bug: one organizer labels this "日期及時間" instead of a
 * bare "日期" — the old regex required the separator (｜:：) immediately
 * after "日期", so "日期及時間：2026/09/23 (三) 20:00" matched nothing at all,
 * silently falling back to the listing page's date-only string and losing
 * the real 20:00 start time (Max caught this: the detail page clearly shows
 * a time, the app showed "時間未公布"). Same shape of bug as the 地點/場地/
 * 場館 venue-label fix above — allow a short run of extra characters between
 * the keyword and the separator instead of requiring them adjacent.
 */
function parseDateLine(html) {
  const value = extractLabeledField(html, "日期", 200);
  return value && /\d{4}/.test(value) ? value : null;
}

// 2026-09-22 real bug (Max: Quanzo + O.Dkizzya, 26_iv0411695): some
// organizers skip "日期" entirely and only ever write a bare "時間：9/25
// （五）19:00" — no year at all, so parseDateLine's 4-digit-year guard
// (there specifically to reject a stray per-tier order-table date, see its
// own comment) correctly rejects it as a full date, but that guard was also
// throwing out the one thing this field DOES reliably carry: the real start
// time. `(?<!售票)` excludes "售票時間：2026/08/22（六）12:00 開始販售" (the
// separate ticket-sale-open time, a real field on the same page) from
// matching — without it this would grab the wrong time entirely.
function parseTimeOnlyLine(html) {
  const value = extractLabeledField(html, "(?<!售票)時間", 200);
  // Fullwidth colon ("晚上19：00") shows up here as often as halfwidth —
  // same family of bug as PRICE_LABEL_RE's fullwidth-pipe miss (normalize.mjs,
  // 2026-09-21): don't assume organizers only ever type halfwidth punctuation.
  const m = value?.match(/(\d{1,2})[:：](\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// 2026-09-22 real bug (Max: "拓元的同樣也是...甚至演出資訊這邊都有 你自己想
// 辦法找" — pushed to audit every remaining gap instead of one at a time):
// narrowing to just a "票價" line, like parseVenueLine/parseDateLine do,
// throws away every event whose organizer never writes that literal label at
// all — found real events using "線上預售票：NT$1,200 / 現場衝動票：NT$1,800"
// (26_iv0418478, no "票價" anywhere) and "🎫 ADV. NT$650 / DOOR NT$800"
// (26_iv041795d, English convention, same as FANSI GO). tixcraft/FANSI GO
// already solved this correctly by handing normalize.mjs's
// parsePriceFromText() the WHOLE "節目介紹" block instead of a pre-narrowed
// line — it already does its own label-scoped extraction FIRST and only
// falls back to PRICE_KEYWORD_RE (預售/現場/adv/door/...) across the full
// text when no label is found, so there's no reason iNDIEVOX should
// re-implement a narrower, less capable version of the same thing. Same
// #intro tab container tixcraft uses exists here too.
function extractIntroHtml($) {
  const el = $("#intro");
  return el.length ? el.html() ?? "" : "";
}

// 2026-09-22 (Max, Stray Kids on tixcraft: "他們不是沒有可用訊號 完售的會寫
// 在這邊" — after that real miss, checked iNDIEVOX's own purchase page too,
// not just its marketing/detail page): iNDIEVOX shares the exact same
// underlying ticketing platform as tixcraft — `/activity/game/{raw_id}` has
// the identical server-rendered `<table>` (演出時間/場次名稱/場地/購買狀態),
// last `<td>` holding either a live "立即訂購" button or "選購一空"/"...截止"
// next to/instead of it. Unlike tixcraft this page has NO anti-bot wall at
// all — confirmed with a plain fetch, 200 OK, full table in the raw HTML —
// so no Playwright needed here, just one more cheap GET.
const TICKET_TERMINAL_TEXT_RE = /選購一空|銷售一空|完售|售罄|截止/;

async function fetchTicketStatusText(rawId) {
  const html = await fetchHtml(`https://www.indievox.com/activity/game/${rawId}`);
  const $ = cheerio.load(html);
  const rowTexts = $("table tbody tr td:last-child")
    .map((_, td) => $(td).text().trim())
    .get();
  if (rowTexts.length === 0 || !rowTexts.every((t) => TICKET_TERMINAL_TEXT_RE.test(t))) return "";
  return rowTexts[0];
}

async function fetchEventDetail(item) {
  const html = await fetchHtml(item.url);
  const $ = cheerio.load(html);
  const venue_raw = parseVenueLine(html) ?? "";
  let date_raw = parseDateLine(html) ?? item.date_raw;
  // Listing-page date_raw never has a time; splice one on from the bare
  // "時間：" field when parseDateLine itself didn't already carry one.
  if (!/\d{1,2}:\d{2}/.test(date_raw)) {
    const timeOnly = parseTimeOnlyLine(html);
    if (timeOnly) date_raw = `${date_raw} ${timeOnly}`;
  }
  const raw_id = item.url.split("/").filter(Boolean).pop();
  let sale_status_text = "";
  try {
    sale_status_text = await fetchTicketStatusText(raw_id);
  } catch (err) {
    logProgress(`indievox ticket-status fetch failed for ${raw_id}: ${err.message}`);
  }
  return {
    raw_id,
    url: item.url,
    title_raw: item.title_raw,
    date_raw,
    venue_raw,
    tickets_raw: [],
    price_text_raw: extractIntroHtml($),
    sale_status_text,
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
