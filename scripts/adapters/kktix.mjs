import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";
import { withPage } from "../browser.mjs";
import { normalizeTraditionalChars } from "../normalize.mjs";

/**
 * KKTIX adapter (SPEC §5, §5.1, §5.2). Two fetch strategies, decided during
 * M2's real endpoint testing:
 *
 * - ORG_PAGE_VENUES: venues that self-promote almost all their own shows and
 *   have one dedicated KKTIX organizer account -> scrape that org's listing
 *   page directly.
 * - SEARCH_VENUES: venues that just rent out space; each show is run by a
 *   different promoter's own org account, so there's no single page to
 *   scrape. Use KKTIX's site-wide search instead and filter results by the
 *   venue field on each event's own detail page (the search itself can
 *   false-positive on unrelated events).
 *
 * Every venue-specific choice here (which orgs, which regexes) is a decision
 * about the *current* real world, not a stable API contract — expect this
 * file to need periodic upkeep as venues start/stop self-promoting.
 */

export const name = "KKTIX";
export const priority = 1;

const UA = "LiveRadar/1.0 (personal use, non-commercial; github.com/<you>/liveradar)";
const REQUEST_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000; // SPEC §4.3 — every adapter request needs a hard timeout so one slow page can't hang the whole pipeline.

// cohesionmusic added 2026-09-17 (M12 coverage follow-up): confirmed via
// browser research that 凝聚力展演空間/Cohesion Space runs its own org account
// with regular monthly shows — the SEARCH_VENUES-style candidates checked in
// the same pass (Zepp, Blue Note, SUB LIVE, 野地方 Wild Lab) all turned out to
// be rented multi-promoter venues instead (different org per show), which
// SEARCH_VENUES can't currently reach anyway (see the Cloudflare note below).
//
// kklivetw/atc-twn added 2026-09-22 (Max real reports: 藤井風 @ 高雄國家體育場
// on 10/31, 高橋洋子 @ Legacy TERA both missing entirely). These two aren't
// physical venues at all — despite the "VENUES" name, this list works for
// any single KKTIX org account that self-hosts most of its own shows,
// whether that's a livehouse or (this case) a promoter/media company running
// events across many different venues (KKLIVE Taiwan: 滅火器/洪佩瑜/藤井風 at
// Zepp/stadiums/Legacy; ATC Taiwan: a Japan-idol-focused promoter running
// shows mostly at Clapper Studio/Legacy TERA). Confirmed both org pages use
// the same `li.clearfix h2 a[href*='/events/']` listing structure
// fetchOrgListing() already expects — kklivetw had 7 upcoming events, atc-twn
// 16, all previously invisible to LiveRadar (neither org page nor any venue
// name they use was covered by ORG_PAGE_VENUES or SEARCH_VENUES before this).
const ORG_PAGE_VENUES = [
  "thewalllivehouse",
  "kafka",
  "pipelivemusic",
  "emergelivehouse",
  "emergelivehouse2",
  "cohesionmusic",
  "kklivetw",
  "atc-twn",
];

// 2026-09-17: kktix.com/events?search=... returns a genuine Cloudflare JS
// challenge (403, <title>Just a moment...</title>) to plain HTTP clients —
// confirmed from both GitHub Actions AND a residential IP with a real browser
// UA, so this was NOT the IP-reputation issue tixcraft has, it's a hard block
// on this endpoint for any non-browser request. Fixed the same day by routing
// just this one endpoint through Playwright (see fetchSearchResultUrls below
// and scripts/browser.mjs) — a real browser executes the challenge script and
// gets through. Event detail pages found via search are NOT behind this
// challenge and still use plain fetch. See LIVERADAR-SPEC.md §5.1.

// Real Taiwanese address data mixes the colloquial (台北/台中) and official
// (臺北/臺中) characters — normalizeTraditionalChars (shared with
// normalize.mjs's city/venue matching, see its own doc comment) collapses
// both to one spelling before matching, instead of each call site
// maintaining its own separate [台臺] regex (that drift is exactly how this
// bug shipped in the first place — normalize.mjs's address matching and this
// file's venue matching were fixed as two unrelated one-off patches).
const SEARCH_VENUES = [
  {
    keyword: "Legacy Taipei",
    match: (venue, address) => /^Legacy(\s|$)/.test(venue) && normalizeTraditionalChars(address).startsWith("台北"),
  },
  {
    keyword: "Legacy Taichung",
    match: (venue, address) => /^Legacy(\s|$)/.test(venue) && normalizeTraditionalChars(address).startsWith("台中"),
  },
  { keyword: "Revolver", match: (venue) => /^Revolver/i.test(venue) },
  { keyword: "Clapper Studio", match: (venue) => /^Clapper/i.test(venue) },
  // Added 2026-09-21: real missed event found by Max (Age Factory @ SUB LIVE,
  // youngteam.kktix.cc/events/agefactory26) — SUB LIVE was already flagged as
  // a rented multi-promoter venue back in the 2026-09-17 M12 pass (see the
  // comment above ORG_PAGE_VENUES) but never actually got added here, so it
  // fell through both strategies entirely.
  { keyword: "SUB LIVE", match: (venue) => /^SUB LIVE/i.test(venue) },
  // The other 3 venues flagged in the same 2026-09-17 M12 pass as SUB LIVE
  // (see comment above ORG_PAGE_VENUES) — checked again 2026-09-21 while
  // fixing SUB LIVE, since it's the same bug: flagged as needing this, never
  // actually added.
  // Zepp New Taipei: confirmed a real currently-missed show (Jony J 2026
  // 「本命」TOUR, spaceport.kktix.cc/events/jonyj-2).
  { keyword: "Zepp New Taipei", match: (venue) => /^Zepp New Taipei/i.test(venue) },
  // 野地方 Wild Lab: confirmed 2 real currently-missed shows (eldon, Shye).
  // One organizer's own listing renders the venue name with U+2F45 (⽅, the
  // Kangxi radical) instead of the normal U+65B9 (方) character — looks
  // identical but doesn't string-match — so the regex only requires the
  // distinctive 2-char "野地" prefix rather than the full name.
  { keyword: "野地方", match: (venue) => /^野地/.test(venue) },
  // Blue Note: no currently-missed show found (all "Blue Note" search hits
  // were false positives — Legacy Taipei, MOONDOG, Corner House, etc., see
  // 2026-09-21 investigation) — added anyway since it's the last of the 4
  // flagged venues and costs nothing but one daily search request.
  { keyword: "Blue Note", match: (venue) => /^Blue Note/i.test(venue) },
  // 2026-09-21, second real missed event Max found the same day (MONO NO
  // AWARE PASSION TOUR 2027, romanticoffice.kktix.cc/events/mononoaware2027):
  // The Wall Live House is in ORG_PAGE_VENUES on the assumption it
  // self-promotes "almost all" its own shows — true most of the time, but
  // this one was booked entirely through an outside promoter's own KKTIX
  // account and never appeared on thewalllivehouse.kktix.cc's own listing at
  // all (confirmed: not in its ~250 listed events). ORG_PAGE_VENUES coverage
  // for The Wall stays as-is (it still catches the majority correctly and
  // faster than a search), this just adds a search-based safety net to catch
  // the ones that slip through an outside promoter. Keyword is "The Wall"
  // (not "The Wall Live House") — the longer phrase returned 0 results from
  // KKTIX's own search, apparently not indexed as one unit.
  { keyword: "The Wall", match: (venue) => /^The Wall/i.test(venue) },
  // 2026-09-21, Max asked for a proactive audit of the other 4 ORG_PAGE_VENUES
  // entries for the same "self-promotes almost all, but not literally all"
  // leak The Wall had. Searched each org's own venue name and checked every
  // result NOT already on that org's own subdomain; kafka and pipelivemusic
  // both turned up a real, currently-on-sale, wrongly-uncovered show this
  // way (emergelivehouse2/cohesionmusic came back clean — 0 real leaks).
  //
  // 海邊的卡夫卡 (kafka org): the "kafka" account only covers its Taipei
  // location. A real show at its Kaohsiung branch ("海邊的卡夫卡-高流店",
  // 黃莑茗《哎呀！跌個狗吃屎！Mini Tour》) was booked under a different
  // promoter's own account and invisible to the org-page strategy entirely.
  // Prefix match covers both this branch and the main Taipei location.
  { keyword: "海邊的卡夫卡", match: (venue) => /^海邊的卡夫卡/.test(venue) },
  // PIPE Live Music (pipelivemusic org): real show (曾艾佳《失序塵編》巡迴演唱會・
  // 台北站) booked entirely through an outside promoter's own KKTIX account,
  // exactly the same shape as The Wall's leak.
  { keyword: "PIPE Live Music", match: (venue) => /^PIPE Live Music/i.test(venue) },
  // 2026-09-21, same audit widened past the existing ORG_PAGE_VENUES list to
  // the highest-frequency venues in the OTHER 4 sources' own data that had
  // zero KKTIX coverage at all — these aren't "leaks" from an assumed org
  // page, KKTIX just never had any entry for them. All 4 below turned up at
  // least one real, currently-on-sale, previously invisible show.
  //
  // 女巫店 (Witch House): 20+ events already come from Ticket Plus alone —
  // a real KKTIX-sold show there (黃莑茗 Taipei date) had zero coverage.
  { keyword: "女巫店", match: (venue) => venue.startsWith("女巫店") },
  // LIVE WAREHOUSE (Kaohsiung, 大庫/小庫 rooms): real shows for 羊文学, 普通隊長,
  // 椅子樂團, DSPS all found. No `^` anchor — one organizer's own listing
  // writes the city first ("高雄 LIVE WAREHOUSE 小庫"), which a prefix match
  // would miss entirely.
  { keyword: "LIVE WAREHOUSE", match: (venue) => /live warehouse/i.test(venue) },
  // 百樂門酒館 (Paramount Bar): real show found (Schizophragm 台灣巡迴), but its
  // own listing writes venue as a combined dual-venue string ("Paramount Bar
  // [百樂門酒館] & Revolver Taipei [左輪酒吧]") that doesn't start with either
  // name — .includes() instead of a prefix match to still catch it.
  { keyword: "百樂門酒館", match: (venue) => venue.includes("百樂門酒館") },
  // 迴響音樂展演空間 SOUND LIVE HOUSE (Taichung): found via the same Eüreka
  // tour that surfaced the LIVE WAREHOUSE gap above (one tour, 3 cities, 3
  // different previously-uncovered venues).
  { keyword: "迴響音樂展演空間", match: (venue) => venue.startsWith("迴響音樂展演空間") },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // globalThis.fetch, NOT bare fetch(): this module exports its own `fetch`
    // (the adapter interface, SPEC §5), which shadows the global Fetch API
    // everywhere in this file. Calling bare fetch(url, ...) here silently
    // recurses into our own zero-arg adapter fetch() instead of hitting the
    // network — cost a long debugging session to find, don't reintroduce it.
    const res = await globalThis.fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with one retry on timeout/network error (SPEC §4.3). */
async function fetchHtml(url) {
  try {
    return await fetchOnce(url);
  } catch (err) {
    logProgress(`retry: ${url} - ${err.message}`);
    return await fetchOnce(url);
  }
}

async function fetchOrgListing(org) {
  const html = await fetchHtml(`https://${org}.kktix.cc/`);
  const $ = cheerio.load(html);
  const urls = [];
  // Not every org page uses the same template: some wrap the upcoming-events
  // <ul> in id="event-list" (thewalllivehouse), others use class="event-list"
  // instead with a different ancestor (cohesionmusic) — found while adding
  // cohesionmusic (M12 follow-up, 2026-09-17) when the original
  // ".current-events #event-list li.clearfix h2 a" matched 0 events there.
  // "li.clearfix h2 a" is the one structural pattern verified stable across
  // every org page checked, AND doesn't match the "曾舉辦的活動" (past events)
  // section, which uses different markup — no [href*="/events/"] filter needed
  // beyond that, but kept for clarity against unrelated links elsewhere on the page.
  $("li.clearfix h2 a[href*='/events/']").each((_, el) => {
    const href = $(el).attr("href");
    // Strip query strings like the search path already does (line ~86) — an
    // unstripped tracking param here pollutes raw_id, since fetchEventDetail
    // derives raw_id from the URL's last path segment.
    if (href) urls.push(href.split("?")[0]);
  });
  return urls;
}

/**
 * Needs a real browser (Playwright), not plain fetch — see the long comment
 * near the top of this file. Detail pages found this way are still plain
 * `fetchEventDetail()` below; only this one listing endpoint is protected.
 */
async function fetchSearchResultUrls(keyword) {
  return withPage(async (page) => {
    await page.goto(`https://kktix.com/events?search=${encodeURIComponent(keyword)}`, {
      waitUntil: "domcontentloaded",
      timeout: REQUEST_TIMEOUT_MS,
    });
    await page.waitForTimeout(1500); // let Cloudflare's challenge script finish running
    const hrefs = await page.$$eval("a[href*='/events/']", (els) => els.map((a) => a.href));
    const urls = new Set();
    for (const href of hrefs) {
      if (href && !href.includes("kktix.com/dashboard") && !href.endsWith(".ics")) {
        urls.add(href.split("?")[0]);
      }
    }
    return Array.from(urls);
  });
}

/**
 * 2026-09-22 real bug (陳如山 @ 海邊的卡夫卡, kafka.kktix.cc/events/sparkkafka
 * sat in needs-review.json as "date_unparseable" even though the page has a
 * perfectly normal date on it): KKTIX serves at least two different event
 * detail page templates. Most orgs (e.g. thewall.kktix.cc) use the older
 * `.event-info ul.info li` layout this adapter was written against, but
 * some orgs get a newer `.side-inner .section` layout with completely
 * different markup for date/venue/tickets — same underlying data, different
 * HTML. Silently missing this returned empty strings, which
 * parseKktixDate() correctly refused to guess at rather than inventing a
 * wrong date, but it meant a genuine event just sat in the review queue
 * forever with no path back out. Detect which template loaded and use the
 * matching selectors for each.
 */
function extractNewTemplateFields($) {
  const sections = $(".side-inner .section");
  const sectionByLabel = (label) =>
    sections.filter((_, el) => $(el).find(".info-title").text().includes(label)).first();

  const date_raw = sectionByLabel("活動時間").find(".timezoneSuffix").first().text().trim();

  const venueP = sectionByLabel("活動地點").find("p").first().clone();
  const addressText = venueP.find(".address").text().trim().replace(/^\(|\)$/g, "");
  venueP.find(".address").remove();
  const venueName = venueP.text().trim();
  const venue_raw = addressText ? `${venueName} / ${addressText}` : venueName;

  const tickets_raw = [];
  $(".ticket-price > li").each((_, li) => {
    const nameSpan = $(li).find(".name").first().clone();
    nameSpan.find(".sell-time, .use-kkpoints-buy-tickets-info").remove();
    const name = nameSpan.text().trim();
    const priceText = $(li).find(".currency-value").first().text().trim();
    const price = priceText ? Number(priceText.replace(/,/g, "")) : null;
    const statusEl = $(li).find(".status").first();
    const closed = statusEl.hasClass("closed");
    // ⚠️ inferred, not confirmed live: no "尚未開賣" example seen yet on this
    // template, assuming it shares the old template's `.waiting` class name
    // since both are KKTIX's own ticket-status vocabulary, just re-skinned.
    const waiting = statusEl.hasClass("waiting");
    const on_sale_at_raw = waiting ? $(li).find(".sell-time .timezoneSuffix").first().text().trim() : null;
    if (name) tickets_raw.push({ name, price, closed, waiting, on_sale_at_raw });
  });

  return { date_raw, venue_raw, tickets_raw };
}

// 2026-09-22 (EIR AOI 尚未開賣 fix, see below): the OLD template's three real
// ticket-status states, unchanged from before the new-template branch above
// was added.
function extractOldTemplateFields($) {
  const infoLis = $(".event-info ul.info li");
  const date_raw = $(infoLis.get(0)).find(".timezoneSuffix").first().text().trim();
  const venue_raw = $(infoLis.get(1)).find(".info-desc").first().text().trim();

  const tickets_raw = [];
  // 2026-09-22 real bug (Max, EIR AOI: "他在票券這邊寫尚未開賣...那不就代表
  // 他尚未開賣嗎"): a ticket row's `.status` span has THREE real states on
  // KKTIX, not two — `.status.closed` ("結束販售", sale over), `.status
  // .waiting` ("尚未開賣", sale hasn't started), or no `.status` span at all
  // (currently open/on sale). This adapter only ever checked for `.closed`,
  // so a "waiting" row (not closed, but also very much not open) counted as
  // "not closed" and got treated as open — reporting the whole event as
  // on_sale when every tier still said "尚未開賣" on KKTIX's own page. The
  // `td.period` cell that carries the status also carries the tier's real
  // sale-start time (`.period-time .time` — first one is the start, second
  // is the end), which is exactly what normalize.mjs needs to show a real
  // countdown instead of an empty "尚未開賣" badge.
  $("table tbody tr").each((_, tr) => {
    const nameCell = $(tr).find("td.name").first().clone();
    nameCell.children().remove();
    const name = nameCell.text().trim();
    const priceText = $(tr).find("td.price .currency-value").first().text().trim();
    const price = priceText ? Number(priceText.replace(/,/g, "")) : null;
    const closed = $(tr).find(".status.closed").length > 0;
    const waiting = $(tr).find(".status.waiting").length > 0;
    const on_sale_at_raw = waiting
      ? $(tr).find(".period-time .time .timezoneSuffix").first().text().trim()
      : null;
    if (name) tickets_raw.push({ name, price, closed, waiting, on_sale_at_raw });
  });

  return { date_raw, venue_raw, tickets_raw };
}

/** Scrapes one event's own page — this is the only place price/venue/date are complete. */
async function fetchEventDetail(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title_raw = $(".header-title h1").first().text().trim();
  const usesNewTemplate = $(".side-inner").length > 0 && $(".event-info").length === 0;
  const { date_raw, venue_raw, tickets_raw } = usesNewTemplate ? extractNewTemplateFields($) : extractOldTemplateFields($);

  const raw_id = url.split("/").filter(Boolean).pop();
  return { raw_id, url, title_raw, date_raw, venue_raw, tickets_raw, source_name: name };
}

export async function fetch(knownRawIds = new Set()) {
  const results = [];
  const warnings = [];
  let skippedKnown = 0;

  // Strategy 1: self-promoting venues, one listing page each.
  for (const org of ORG_PAGE_VENUES) {
    await sleep(REQUEST_DELAY_MS);
    logProgress(`fetching org listing: ${org}`);
    let eventUrls = [];
    try {
      eventUrls = await fetchOrgListing(org);
    } catch (err) {
      warnings.push(`org listing failed for ${org}: ${err.message}`);
      continue;
    }
    logProgress(`org ${org}: ${eventUrls.length} upcoming event(s) listed`);
    for (const url of eventUrls) {
      // 2026-09-18, incremental fetch: KKTIX has no lightweight listing at
      // all — date/venue/price only ever exist on the detail page — so an
      // already-known event skips straight past fetchEventDetail entirely,
      // no delay either since there's no request being made. fetch.mjs
      // reuses its previous normalized data (see reuse_previous).
      const raw_id = url.split("/").filter(Boolean).pop();
      if (knownRawIds.has(raw_id)) {
        skippedKnown += 1;
        results.push({ raw_id, url, title_raw: null, source_name: name, reuse_previous: true });
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching detail: ${url}`);
      try {
        const detail = await fetchEventDetail(url);
        results.push(detail);
        logProgress(`  + ${detail.title_raw}`);
      } catch (err) {
        warnings.push(`event detail failed for ${url}: ${err.message}`);
      }
    }
  }

  // Strategy 2: multi-promoter venues, site-wide search + per-event venue filter.
  for (const { keyword, match } of SEARCH_VENUES) {
    await sleep(REQUEST_DELAY_MS);
    logProgress(`fetching search: ${keyword}`);
    let eventUrls = [];
    try {
      eventUrls = await fetchSearchResultUrls(keyword);
    } catch (err) {
      warnings.push(`search failed for "${keyword}": ${err.message}`);
      continue;
    }
    logProgress(`search "${keyword}": ${eventUrls.length} result(s) to check`);
    for (const url of eventUrls) {
      // Same skip as Strategy 1 — an already-known result already passed the
      // venue-match filter below on a previous run (a venue doesn't change),
      // so re-verifying it here would just burn a request for the same answer.
      const raw_id = url.split("/").filter(Boolean).pop();
      if (knownRawIds.has(raw_id)) {
        skippedKnown += 1;
        results.push({ raw_id, url, title_raw: null, source_name: name, reuse_previous: true });
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching detail: ${url}`);
      let detail;
      try {
        detail = await fetchEventDetail(url);
      } catch (err) {
        warnings.push(`event detail failed for ${url}: ${err.message}`);
        continue;
      }
      const [venuePart, addressPart = ""] = detail.venue_raw.split("/").map((s) => s.trim());
      if (match(venuePart, addressPart)) {
        results.push(detail);
        logProgress(`  + ${detail.title_raw}`);
      }
      // else: search false-positive (venue name mentioned but not actually the venue) — drop silently.
    }
  }

  if (skippedKnown > 0) {
    logProgress(`KKTIX: ${skippedKnown} event(s) already known, skipping detail fetch`);
  }
  if (warnings.length) {
    console.warn(`[kktix] ${warnings.length} sub-request(s) failed:\n` + warnings.join("\n"));
  }

  return results;
}
