import { withBrowser, newPage } from "../browser.mjs";
import { logProgress } from "../progress-log.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * FANSI GO (go.fansi.me) adapter. Added 2026-09-17. Needs a real browser
 * (Playwright), not plain fetch — this is a client-rendered Next.js app with
 * zero event data in the initial server-rendered HTML (confirmed: a plain
 * fetch of /allevents returns 200 with no "Just a moment" Cloudflare
 * challenge, but also no event links at all — the events only exist after
 * JS runs).
 *
 * /allevents lists every currently-selling event on one page, no pagination
 * (confirmed by scrolling to the bottom and re-counting: same 26 cards).
 *
 * 2026-09-21 correction: the claim below that there's "no structured venue
 * field anywhere" was wrong — Max pushed back after seeing too many "未知"
 * cities ("can't you tell the city from the venue?"), and actually opening a
 * few detail pages with a real venue-address block sitting in plain sight:
 * every event page has one, right next to the price block this adapter
 * already visits — `div.w-full.mt-2.mb-6 div.w-full > p` (2 children: venue
 * name, then address), confirmed stable across every event checked. Original
 * (wrong) reasoning kept below for context since the listing card's
 * "organizer" field is still used as a same-page fallback when the detail
 * fetch is skipped (an already-known event) or the selector doesn't match:
 * it's often the actual venue (e.g. "百樂門酒館", "PIPE Live Music") but
 * sometimes a label/promoter name instead (e.g. "Wrong Game Records") — the
 * "good enough for coverage, not always precise" tradeoff tixcraft's
 * untracked venues also make, same city fallback via data/venues.yml.
 *
 * Price DOES live on each event's detail page, though — always inside a
 * `.prose` div (confirmed stable across every event checked 2026-09-18),
 * just as decoratively formatted as everything else on this site (fullwidth
 * digits/currency signs, no consistent label). normalize.mjs's
 * parsePriceFromText handles the fullwidth normalization and keyword-based
 * fallback extraction this needs. Getting it means one extra Playwright page
 * navigation per event on top of the single listing-page load this adapter
 * used to need — real added time, see HANDOFF.md.
 */

export const name = "FANSI GO";
export const priority = 4;

const LIST_URL = "https://go.fansi.me/allevents";

/** "2026/09/19" -> unchanged; normalize.mjs's parseFansiDate expects exactly this shape. No time — the detail page has one, but only as unreliable decorative text, so it's skipped (same tradeoff tixcraft made for price, D16). */
async function fetchCards(page) {
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  try {
    await page.waitForSelector("a[href^='/events/'] h3", { timeout: 15000 });
  } catch {
    return []; // page loaded but no events rendered in time — treat as 0 results, not a crash
  }
  await page.waitForTimeout(1500); // let the rest of the React tree settle

  return page.$$eval("a[href^='/events/']", (els) =>
    els
      .map((a) => {
        const h3 = a.querySelector("h3");
        if (!h3) return null;
        const statusEl = a.querySelector("header p");
        const orgEl = a.querySelector(".card-body p");
        const timeEl = a.querySelector("time");
        return {
          url: a.href,
          title: h3.textContent.trim(),
          organizer: orgEl ? orgEl.textContent.trim() : "",
          status: statusEl ? statusEl.textContent.trim() : "",
          date_raw: timeEl ? (timeEl.getAttribute("datetime") ?? timeEl.textContent.trim()) : "",
        };
      })
      .filter(Boolean)
  );
}

const PRICE_REQUEST_DELAY_MS = 800; // see tixcraft.mjs's identical constant — same rationale
const PRICE_NAV_TIMEOUT_MS = 20000;

export async function fetch(knownRawIds = new Set()) {
  logProgress("fetching FANSI GO /allevents");
  let results;
  try {
    results = await withBrowser(async (browser) => {
      const listPage = await newPage(browser);
      const cards = await fetchCards(listPage);
      await listPage.close();

      const events = cards
        .filter((c) => c.status !== "周邊販售" && c.date_raw) // merch-only listings (if any) aren't real performances
        .map((c) => ({
          raw_id: c.url.split("/").filter(Boolean).pop(),
          url: c.url,
          title_raw: c.title,
          date_raw: c.date_raw,
          venue_raw: c.organizer,
          tickets_raw: [],
          price_text_raw: "",
          source_name: name,
        }));

      // 2026-09-18, incremental fetch: skip the per-event Playwright detail
      // visit for events already recognized last run (see tixcraft.mjs's
      // identical comment — same fetch.mjs-level reuse_previous mechanism).
      const toFetch = [];
      for (const event of events) {
        if (knownRawIds.has(event.raw_id)) {
          event.reuse_previous = true;
        } else {
          toFetch.push(event);
        }
      }
      if (toFetch.length < events.length) {
        logProgress(`FANSI GO: ${events.length - toFetch.length} event(s) already known, skipping detail/price fetch`);
      }

      let priceFailures = 0;
      let venueFailures = 0;
      for (const event of toFetch) {
        await sleep(PRICE_REQUEST_DELAY_MS);
        const page = await newPage(browser);
        try {
          await page.goto(event.url, { waitUntil: "domcontentloaded", timeout: PRICE_NAV_TIMEOUT_MS });
          // .prose renders client-side a beat after domcontentloaded, same
          // as tixcraft's #intro — an unguarded $eval right after goto()
          // failed for every single event when this went untested against
          // the real site (see tixcraft.mjs's identical fix for the story).
          await page.waitForSelector(".prose", { timeout: PRICE_NAV_TIMEOUT_MS });
          event.price_text_raw = await page.$eval(".prose", (el) => el.innerHTML);
        } catch (err) {
          priceFailures += 1;
          logProgress(`FANSI GO price fetch failed for ${event.url}: ${err.message}`);
        }
        // Same page load, no extra navigation — see the 2026-09-21 doc
        // comment above. Falls back to the listing card's organizer field
        // (already in event.venue_raw) when this doesn't match, e.g. a
        // layout variant this hasn't been checked against yet.
        try {
          const parts = await page.$$eval("div.w-full.mt-2.mb-6 div.w-full > p", (els) =>
            els.map((el) => el.textContent.trim())
          );
          if (parts.length >= 2 && parts[0]) {
            event.venue_raw = `${parts[0]} / ${parts[1]}`;
          }
        } catch (err) {
          venueFailures += 1;
          logProgress(`FANSI GO venue fetch failed for ${event.url}: ${err.message}`);
        } finally {
          await page.close();
        }
      }
      if (venueFailures > 0) {
        logProgress(`FANSI GO: venue detail fetch failed for ${venueFailures}/${toFetch.length} event(s), falling back to organizer field`);
      }
      if (priceFailures > 0) {
        logProgress(`FANSI GO: price detail fetch failed for ${priceFailures}/${toFetch.length} event(s)`);
      }

      return events;
    });
  } catch (err) {
    logProgress(`FANSI GO fetch failed: ${err.stack}`);
    throw err;
  }

  logProgress(`FANSI GO: ${results.length} event(s) fetched`);
  return results;
}
