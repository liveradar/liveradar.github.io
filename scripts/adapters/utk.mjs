import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";

/**
 * Shared adapter for 寬宏 (kham.com.tw) and 年代 (ticket.com.tw) — the same
 * "UTK" ticketing system (identical URL structure, `UTK0101_06.aspx` /
 * `UTK0201_00.aspx`) under two different HTML templates. Added 2026-09-26
 * (PLAN-4-kham-era.md). No robots.txt on either host, plain HTTP works.
 *
 * Only 演唱會/音樂劇/戲劇 categories, per Max's 2026-09-25 scope decision —
 * NOT 音樂 (32 real 年代 items checked, almost entirely classical/choir/
 * community concerts, out of scope for this project).
 *
 * Two-step scrape, both server-rendered HTML (cheerio, already a project
 * dependency):
 *  1. UTK0101_06.aspx?CATEGORY={code} — one page per category lists every
 *     product's id (PRODUCT_ID=... in the markup). 寬宏/年代 use DIFFERENT
 *     category codes for the same concept (see HOST_CONFIG below); 寬宏 has
 *     no dedicated 音樂劇 code — its 80 IS the musical category, 年代 has
 *     none at all.
 *  2. UTK0201_00.aspx?PRODUCT_ID={id} — the product's own session table.
 *     Real 2026-09-25/26 behavior that shaped this parser:
 *       - A single real performance is often split across SEVERAL table
 *         rows (different price tiers as separate PERFORMANCE_IDs, or a
 *         "【輪椅場】"/"【身障輪椅場】" row) — merged here by (date+time,
 *         venue name).
 *       - The "立即訂購" button text NEVER changes even when every tier is
 *         sold out — the ONLY sold-out signal is every price in a row being
 *         struck through (<s> on 寬宏, <del> on 年代).
 *       - Wheelchair/accessibility rows are excluded from the merged price
 *         range and sold-out check UNLESS a session has nothing else at all.
 *       - A product that hasn't gone on sale yet has an EMPTY session table
 *         (its `UTK0201_00.aspx` even redirects to a different template
 *         page entirely, confirmed 2026-09-26) — skipped outright; the next
 *         day's scheduled run picks it up once it's actually on sale. So
 *         there is no "announced" status from this source, only on_sale/
 *         sold_out.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const LIST_DELAY_MS = 500;
const PRODUCT_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Category codes differ per host (2026-09-25 real measurement) — 寬宏 has a
// dedicated 音樂劇 code (80), 年代 has none at all (its 演唱會/戲劇 codes
// happen to be numerically identical to 寬宏's, but that's a coincidence of
// this shared platform, not something to rely on).
export const HOST_CONFIG = {
  "kham.com.tw": { concert: 205, musical: 80, drama: 116, kids: 129 },
  "ticket.com.tw": { concert: 205, musical: null, drama: 116, kids: 129 },
};

export function isWheelchairNote(note) {
  return /輪椅|身障/.test(note ?? "");
}

// Marks each <s>/<del>-wrapped number (whatever's nested inside, e.g. 寬宏's
// <s><font>2880</font></s>) as struck via a sentinel character, strips every
// remaining tag, then splits on the 、/,/， separators every real page uses
// between tiers. Regex-based rather than a DOM walk specifically so the
// SAME code handles 寬宏's <s> and 年代's <del> without caring which one a
// given page uses.
const STRUCK_TAG_RE = /<(s|del)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const STRUCK_MARK = "\u0000";

export function parsePriceCell(cellHtml) {
  if (!cellHtml) return [];
  const marked = cellHtml.replace(STRUCK_TAG_RE, (_, _tag, inner) => {
    const num = inner.replace(/<[^>]+>/g, "").match(/[\d,]+/);
    return num ? `${STRUCK_MARK}${num[0]}${STRUCK_MARK}` : "";
  });
  const plain = marked.replace(/<[^>]+>/g, " ");
  return plain
    .split(/[、,，]/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => {
      const closed = tok.includes(STRUCK_MARK);
      const num = tok.replace(new RegExp(STRUCK_MARK, "g"), "").match(/[\d,]+/);
      return num ? { price: Number(num[0].replace(/,/g, "")), closed } : null;
    })
    .filter(Boolean);
}

// "2026/11/21(六)15:00" (寬宏, plain text) or a multi-day range
// "2026/11/07(六)13:00 ~ 2026/11/08(日)13:00" (only the START date/time is
// used, same convention as every other adapter's date-range handling).
// 年代 instead renders a <time datetime="2026-11-28"> element with the time
// text in a nested <span class="time">, checked first since it's already
// machine-readable when present.
export function parseDateCell($cell, $) {
  const timeEl = $cell.find("time[datetime]").first();
  if (timeEl.length > 0) {
    const date = timeEl.attr("datetime");
    const time = timeEl.find("span.time").first().text().trim();
    if (date && time) return { date, time };
  }
  const text = $cell.text().replace(/\s+/g, " ").trim();
  const m = text.match(/(\d{4})\/(\d{2})\/(\d{2})\([^)]*\)(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { date: `${y}-${mo}-${d}`, time: `${h.padStart(2, "0")}:${mi}` };
}

// venue name + Google Maps address + any note text sitting after them in
// the SAME cell (e.g. "【輪椅場】...", "【VIP門票】...") — both hosts use
// the identical id-suffix convention (PLACE_NAME/PLACE_ADDRESS), 年代 just
// prefixes it with its own ASP.NET control path, hence the [id$=] suffix match.
export function parseVenueCell($cell) {
  const venueName = $cell.find('[id$="PLACE_NAME"]').first().text().trim();
  const href = $cell.find('[id$="PLACE_ADDRESS"]').first().attr("href") ?? "";
  const qMatch = href.match(/[?&]q=([^&]+)/);
  let address = "";
  if (qMatch) {
    try {
      address = decodeURIComponent(qMatch[1]);
    } catch {
      address = "";
    }
  }
  const $note = $cell.clone();
  $note.find('[id$="PLACE_NAME"], [id$="PLACE_ADDRESS"], img').remove();
  const note = $note.text().replace(/\s+/g, " ").trim();
  return { venueName, address, note };
}

/**
 * Parses one product's session table into a flat list of ticket ROWS (not
 * yet merged into sessions — see combineRowsIntoSessions). Tries
 * `table.eventTABLE` (寬宏) then `table.itable` (年代); an empty result
 * (no matching table, or a table with no data rows — a product not yet on
 * sale) is a valid, expected outcome, not an error.
 */
export function parseProductPage(html) {
  const $ = cheerio.load(html);
  const title = $(".eventTitle").first().text().trim() || $("#ctl00_ContentPlaceHolder1_NAME").first().text().trim();

  const rows = [];
  const $table = $("table.eventTABLE, table.itable").first();
  $table.find("tr").each((_, el) => {
    const $row = $(el);
    const $cells = $row.find("td");
    if ($cells.length < 4) return; // header row (<th>) or malformed
    const dateCell = parseDateCell($cells.eq(0), $);
    if (!dateCell) return;
    const { venueName, address, note } = parseVenueCell($cells.eq(1));
    if (!venueName) return;
    const prices = parsePriceCell($cells.eq(2).html());
    rows.push({ ...dateCell, venueName, address, note, prices });
  });

  return { title, rows };
}

/**
 * Merges rows sharing the same (date+time, venue) — the several
 * PERFORMANCE_ID/price-tier/wheelchair-seat rows a single real performance
 * is often split into — into one session. Wheelchair/accessibility rows
 * (isWheelchairNote) are excluded from the combined price list UNLESS a
 * session has nothing else at all (a real show that's ONLY accessible
 * seating, however unlikely). Same price appearing both open and struck
 * across rows keeps the OPEN state — a buyable tier existing anywhere
 * means the session isn't sold out at that price.
 */
export function combineRowsIntoSessions(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.date}T${row.time}::${row.venueName}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const sessions = [];
  for (const group of byKey.values()) {
    const plain = group.filter((r) => !isWheelchairNote(r.note));
    const relevant = plain.length > 0 ? plain : group;

    const priceByValue = new Map();
    for (const row of relevant) {
      for (const t of row.prices) {
        const existingClosed = priceByValue.get(t.price);
        if (existingClosed === undefined || (existingClosed && !t.closed)) {
          priceByValue.set(t.price, t.closed);
        }
      }
    }
    const tickets = [...priceByValue.entries()].map(([price, closed]) => ({ price, closed }));
    const allStruck = tickets.length > 0 && tickets.every((t) => t.closed);

    sessions.push({ date: group[0].date, time: group[0].time, venueName: group[0].venueName, address: group[0].address, tickets, allStruck });
  }
  return sessions;
}

export function sessionToRawEvent(session, { productId, productTitle, host, sourceName, category }) {
  const compactDate = session.date.replace(/-/g, "");
  const compactTime = session.time.replace(":", "");
  return {
    raw_id: `${productId}_${compactDate}${compactTime}`,
    url: `https://${host}/application/UTK02/UTK0201_00.aspx?PRODUCT_ID=${productId}`,
    title_raw: productTitle,
    venue_raw: `${session.venueName} / ${session.address}`,
    date_raw: `${session.date} ${session.time}`,
    tickets_raw: session.tickets.map((t) => ({
      name: String(t.price),
      price: t.price,
      closed: t.closed,
      waiting: false,
      on_sale_at_raw: null,
    })),
    register_status: session.allStruck ? "SOLD_OUT" : "IN_STOCK",
    price_text_raw: "",
    sale_status_text: "",
    source_name: sourceName,
    ...(category ? { category, run_key: `${sourceName}:${productId}:${session.venueName}` } : {}),
  };
}

async function getHtmlOnce(url) {
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

// List-page failures propagate after one retry (aborts the whole host's
// run, fetch.mjs falls back to last known data) — a missing category page
// means the whole catalog for that category is unknown, not just one item.
async function fetchListHtml(url, sourceName) {
  try {
    return await getHtmlOnce(url);
  } catch (err) {
    logProgress(`${sourceName} retry: ${url} - ${err.message}`);
    return await getHtmlOnce(url);
  }
}

// Product-page failures only cost ONE product, not the whole run — caught
// here, logged, and skipped rather than propagated.
async function fetchProductHtml(url, sourceName) {
  try {
    return await getHtmlOnce(url);
  } catch (err) {
    logProgress(`${sourceName}: product page fetch failed (1st try): ${url} - ${err.message}`);
    try {
      return await getHtmlOnce(url);
    } catch (err2) {
      logProgress(`${sourceName}: product page fetch failed, giving up: ${url} - ${err2.message}`);
      return null;
    }
  }
}

async function fetchCategoryIds(host, categoryCode, sourceName) {
  const html = await fetchListHtml(`https://${host}/application/UTK01/UTK0101_06.aspx?TYPE=1&CATEGORY=${categoryCode}`, sourceName);
  return new Set([...html.matchAll(/PRODUCT_ID=([A-Z0-9]+)/g)].map((m) => m[1]));
}

/**
 * A product can legitimately be listed under more than one category page —
 * 80 (音樂劇) wins outright over 116 (舞台劇) over 205 (plain concert, no
 * category at all), a simple predictable rule rather than guessing per
 * product which category "really" describes it.
 */
export function classifyProduct(idsByCategory, productId) {
  if (idsByCategory.musical?.has(productId)) return "音樂劇";
  if (idsByCategory.drama?.has(productId)) return "舞台劇";
  return undefined;
}

export function collectEligibleIds(idsByCategory) {
  const kidsIds = idsByCategory.kids ?? new Set();
  const all = new Set([...(idsByCategory.concert ?? []), ...(idsByCategory.musical ?? []), ...(idsByCategory.drama ?? [])]);
  return [...all].filter((id) => !kidsIds.has(id)); // dual-tagged with 親子 — excluded structurally, not by title keyword
}

/** @returns {{ name: string, priority: number, fetch: () => Promise<object[]> }} */
export function createUtkAdapter({ name, priority, host }) {
  const config = HOST_CONFIG[host];
  if (!config) throw new Error(`utk.mjs: no HOST_CONFIG for ${host}`);

  async function fetch() {
    const idsByCategory = {};
    for (const key of ["concert", "musical", "drama", "kids"]) {
      const code = config[key];
      if (code == null) continue;
      await sleep(LIST_DELAY_MS);
      idsByCategory[key] = await fetchCategoryIds(host, code, name);
      logProgress(`${name}: category ${key} (${code}) - ${idsByCategory[key].size} product(s)`);
    }

    const eligibleIds = collectEligibleIds(idsByCategory);

    const results = [];
    let skippedNotOnSale = 0;
    for (const productId of eligibleIds) {
      const category = classifyProduct(idsByCategory, productId);

      await sleep(PRODUCT_DELAY_MS);
      const html = await fetchProductHtml(`https://${host}/application/UTK02/UTK0201_00.aspx?PRODUCT_ID=${productId}`, name);
      if (!html) continue;

      const { title, rows } = parseProductPage(html);
      if (!title || rows.length === 0) {
        skippedNotOnSale += 1;
        continue; // not yet on sale (empty session table) — next run picks it up once it is
      }

      const sessions = combineRowsIntoSessions(rows);
      for (const session of sessions) {
        results.push(sessionToRawEvent(session, { productId, productTitle: title, host, sourceName: name, category }));
      }
    }

    logProgress(`${name}: ${eligibleIds.length} product(s), ${skippedNotOnSale} not yet on sale, ${results.length} session(s) total`);
    return results;
  }

  return { name, priority, fetch };
}
