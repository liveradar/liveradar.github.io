import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";
import { withBrowser, newPage } from "../browser.mjs";

/**
 * 拓元 tixcraft adapter (SPEC §5.3).
 *
 * Listing page: plain fetch works fine (WAF only needs a real browser UA
 * string, see UA below). Detail pages (where price lives, as prose in the
 * "節目介紹" tab) sit behind a real JS-challenge anti-bot wall that a plain
 * fetch() can't pass at all — confirmed 2026-09-18, a plain fetch with the
 * same UA/headers gets 401 {"response":"identify"}.
 *
 * D16 (2026-09-15) originally decided to skip detail pages entirely rather
 * than pay Playwright's cost on every GitHub Actions run. That constraint is
 * gone since S5 (2026-09-17) made fetching manual/local-only — Playwright
 * was already added as a dependency for FANSI GO/KKTIX's search anyway — so
 * this now fetches each event's detail page for price text too. Real cost:
 * one Playwright page navigation per event (~80-140 events some runs), which
 * meaningfully lengthens the manual "重新抓取" button's run time — see
 * HANDOFF.md for the measured before/after.
 */

export const name = "拓元";
export const priority = 2;

// tixcraft's WAF blocks requests without a convincing browser User-Agent —
// bare curl/node fetch UAs get an instant {"response":"block"} 403.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 30000;
// Shorter than the plain-fetch retry delay above — a full Playwright page
// navigation already takes real wall-clock time on its own, so this is on
// top of that, not instead of it. Still real spacing between requests
// (NFR-04), just not doubling up on top of navigation latency.
const DETAIL_REQUEST_DELAY_MS = 800;
const DETAIL_NAV_TIMEOUT_MS = 20000;
// 2026-09-21 real bug (Max): the listing page's date field genuinely never
// has a time — confirmed on real pages, not a parsing gap — but the detail
// page (#intro, already fetched for price) has the real show time in a
// "📅 時間：YYYY/MM/DD(day) HH:MM" line. The SAME page also has several
// unrelated "時間：" lines further down for presale windows ("時間：
// 2026/07/20(一) 10:00 ~ 2026/07/21(二) 10:00") — anchoring specifically to
// the 📅 emoji prefix (confirmed present and first on every real page
// checked) avoids accidentally picking up one of those instead.
// (?:<[^>]+>\s*)* tolerates HTML tags between the label and the date/time —
// the real markup wraps parts of the date in <span> ("📅 時間：<span>2027/
// 05/01(</span>六<span>) 18:45</span>"), so a naive "\s*\d{4}" right after
// the colon matched nothing at all until this was added.
const SHOW_TIME_RE = /📅\s*時間[：:]\s*(?:<[^>]+>\s*)*\d{4}\/\d{2}\/\d{2}\([^)]*\)\s*(\d{1,2}:\d{2})/;
// 2026-09-22 real bug (Max: "拓元的同樣也是在節目介紹的文字內...你自己想辦法
// 找" — SHOW_TIME_RE alone wasn't enough): not every organizer uses the
// 📅-emoji convention at all. Confirmed on a real page (26_slowdive, via
// browser — no 📅 anywhere on it): "演出時間：2026-12-10（四）" carries only the
// date, with the actual start time in a SEPARATE "演出開始：8pm" line, written
// in English am/pm instead of 24-hour HH:MM.
const SHOW_START_AMPM_RE = /演出開始[：:]\s*(?:<[^>]+>\s*)*(\d{1,2})\s*(am|pm)/i;

function amPmTo24Hour(hour, meridiem) {
  let h = Number(hour) % 12;
  if (meridiem.toLowerCase() === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:00`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // globalThis.fetch, not bare fetch — see the identical warning in kktix.mjs;
    // this file's own exported `fetch` shadows the global one the same way.
    const res = await globalThis.fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "zh-TW,zh;q=0.9",
        Referer: referer,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url, referer) {
  try {
    return await fetchOnce(url, referer);
  } catch (err) {
    logProgress(`tixcraft retry: ${url} - ${err.message}`);
    return await fetchOnce(url, referer);
  }
}

export async function fetch(knownRawIds = new Set()) {
  logProgress("fetching tixcraft activity listing");
  const html = await fetchHtml("https://tixcraft.com/activity", "https://tixcraft.com/");
  const $ = cheerio.load(html);

  const seen = new Set();
  const results = [];

  $("#all .eventbl .row.align-items-center").each((_, el) => {
    const row = $(el);
    if (row.find(".date").length === 0) return;

    const link = row.find(".text-bold a").first();
    const href = link.attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);

    const title_raw = link.text().trim();
    const date_raw = row.find(".date").first().text().trim();
    const venue_raw = row.find(".text-small.text-med-light").first().text().trim();
    const url = href.startsWith("http") ? href : `https://tixcraft.com${href}`;
    const raw_id = href.split("/").filter(Boolean).pop();

    results.push({ raw_id, url, title_raw, date_raw, venue_raw, tickets_raw: [], price_text_raw: "", source_name: name });
  });

  logProgress(`tixcraft: ${results.length} unique upcoming event(s) listed`);

  // 2026-09-18, incremental fetch: skip the expensive per-event Playwright
  // visit entirely for events already recognized last run — fetch.mjs reuses
  // their previous normalized data instead (see reuse_previous in
  // fetch.mjs's runAdapter()). This is what took tixcraft's own detail-fetch
  // phase from several minutes down to roughly "however many genuinely new
  // events showed up today", which is normally a handful.
  const toFetch = [];
  for (const event of results) {
    if (knownRawIds.has(event.raw_id)) {
      event.reuse_previous = true;
    } else {
      toFetch.push(event);
    }
  }
  if (toFetch.length < results.length) {
    logProgress(`tixcraft: ${results.length - toFetch.length} event(s) already known, skipping detail/price fetch`);
  }

  let priceFailures = 0;
  await withBrowser(async (browser) => {
    for (const event of toFetch) {
      await sleep(DETAIL_REQUEST_DELAY_MS);
      const page = await newPage(browser);
      const startedAt = Date.now();
      try {
        await page.goto(event.url, { waitUntil: "domcontentloaded", timeout: DETAIL_NAV_TIMEOUT_MS });
        const gotoMs = Date.now() - startedAt;
        // #intro isn't in the DOM yet at domcontentloaded — this page renders
        // it client-side a beat later. Found by testing: an unguarded $eval
        // right after goto() failed for every single event (100% silent
        // miss, not a partial/expected gap) since $eval doesn't wait for an
        // element that doesn't exist yet, unlike waitForSelector.
        await page.waitForSelector("#intro", { timeout: DETAIL_NAV_TIMEOUT_MS });
        event.price_text_raw = await page.$eval("#intro", (el) => el.innerHTML);
        const timeMatch = event.price_text_raw.match(SHOW_TIME_RE);
        if (timeMatch) {
          event.date_raw = `${event.date_raw} ${timeMatch[1]}`;
        } else {
          const ampmMatch = event.price_text_raw.match(SHOW_START_AMPM_RE);
          if (ampmMatch) event.date_raw = `${event.date_raw} ${amPmTo24Hour(ampmMatch[1], ampmMatch[2])}`;
        }
        const totalMs = Date.now() - startedAt;
        // 2026-09-18: diagnosing unexplained run-to-run slowness in this loop
        // (measured 2min+ for just 20 events some runs, expected under 1min)
        // — logging goto vs. total time per event to see whether it's spread
        // evenly (real per-page slowness) or concentrated in a few outliers
        // (near-timeout waitForSelector calls), instead of guessing.
        if (totalMs > 5000) {
          logProgress(`tixcraft: slow detail fetch for ${event.url} — goto ${gotoMs}ms, total ${totalMs}ms`);
        }
      } catch (err) {
        priceFailures += 1;
        logProgress(`tixcraft price fetch failed for ${event.url}: ${err.message} (after ${Date.now() - startedAt}ms)`);
      } finally {
        await page.close();
      }
    }
  });
  if (priceFailures > 0) {
    logProgress(`tixcraft: price detail fetch failed for ${priceFailures}/${toFetch.length} event(s)`);
  }

  return results;
}
