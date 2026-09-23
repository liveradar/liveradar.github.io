import * as cheerio from "cheerio";
import { logProgress } from "../progress-log.mjs";
import { withPage, withBrowser, newPage } from "../browser.mjs";
import { normalizeTraditionalChars, taiwanTodayDateStr } from "../normalize.mjs";

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
// Lighter delay for register_info checks specifically (see fetchRegisterStatus):
// these are same-page JS fetch() calls against an already-Cloudflare-cleared
// page, not full navigations, so they don't need REQUEST_DELAY_MS's 2s —
// just enough spacing to not look like a hammering script.
const REGISTER_CHECK_DELAY_MS = 400;

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
// offtimemusic/baodaorecords added 2026-09-23 (Max real reports: iri
// 12/6@Legacy TERA and 羊文学 10/24@高雄巨蛋 both missing entirely, plus
// Max's earlier "每個場次的任何資訊都不可以漏掉" pushback). Same pattern as
// kklivetw/atc-twn above — these aren't physical venues either, they're
// promoter accounts that self-host almost all their own shows: OFF TIME
// (offtimemusic, 提外文化) runs Japanese/Thai indie-pop tours (Omoinotake,
// 7co, SCRUBB, iri — 4 upcoming, all previously invisible), 宝島制作委員会
// (baodaorecords) runs a much larger slate of the same genre (AiNA THE END,
// Suchmos, JANNABI, Daoko, Ave Mujica, and — confirmed the actual scale of
// this miss — 羊文学's own 10/24 高雄 show despite 羊文学 already being a
// tracked artist in this file, because the SHOW's promoter account wasn't
// covered even though the ARTIST was; 13 upcoming events, all previously
// invisible). Neither showed up via Strategy 3's category browse either —
// unclear why (indexing lag, ranking, something else), not investigated
// further since ORG_PAGE_VENUES closes the gap directly regardless.
//
// originalive-wwr/jmgroup added 2026-09-23 (Max real reports: The Notwist
// @ SUB 10/2 and 向井太一 Taipei stop @ Legacy Taipei 10/22 both missing).
// Root cause for THIS pair confirmed directly (not just "unclear why" like
// the offtimemusic/baodaorecords note above): checked kktix.com's own
// category-filtered search — https://kktix.com/events?event_tag_ids_in=13
// (the "音樂" tag id Strategy 3 filters on) — and neither event shows up
// under it. The Notwist isn't tagged under 音樂 at all; 向井太一's Taipei
// stop isn't either (only its Hong Kong stop is, which our geo-filter
// correctly excludes anyway). So Strategy 3 can only ever find events the
// *organizer themselves* tagged into KKTIX's own 音樂 category — tagging
// is opt-in per event, not something LiveRadar controls, so any org that
// skips it (even sporadically, like originalive-wwr did for one show but
// not another) needs its own ORG_PAGE_VENUES entry to be reliably covered.
// 本事現場 ORIGINALIVE runs a numbered concert series (本事現場 #27/28/29...)
// almost entirely through this one account; JMG 極星國際娛樂 self-promotes
// its full slate of Japanese-artist Taiwan tour stops the same way.
const ORG_PAGE_VENUES = [
  "thewalllivehouse",
  "kafka",
  "pipelivemusic",
  "emergelivehouse",
  "emergelivehouse2",
  "cohesionmusic",
  "kklivetw",
  "atc-twn",
  "offtimemusic",
  "baodaorecords",
  "originalive-wwr",
  "jmgroup",
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

// 2026-09-22 (Max real reports, 藤井風/高橋洋子 missing entirely because
// kklivetw/atc-twn had never been added to ORG_PAGE_VENUES — Max: "帳號沒被
// 收錄過為什麼就不會出現，之後會有一堆沒收錄過的任何資訊，你都要這樣忽略
// 掉嗎"): a whitelist of known orgs/venues structurally can never be
// complete — it only grows when someone happens to notice a specific miss.
// Strategy 3 below (fetchCategoryBrowsePages) closes that gap directly
// instead of just adding one more name each time: kktix.com's own "音樂"
// category filter is a real, paginated, sitewide listing covering every
// organizer, confirmed by clicking the category chip on kktix.com's explore
// page and reading the resulting query string. 13 is 音樂's tag id.
//
// 2026-09-23 (Max real reports: The Notwist @ SUB, 向井太一 Taipei stop @
// Legacy — both missing despite Strategy 3 running): checked each event's
// own tag chips directly on its detail page (the links under the title
// pointing at kktix.cc/events?event_tag_ids_in=N) and found KKTIX's own
// taxonomy has several overlapping music-adjacent categories that
// organizers use inconsistently — sometimes even the SAME org tags one
// show under 音樂 and another under a different one. The Notwist was tagged
// 演唱會(1)/音樂會(6)/藝文活動(11), never 13. 向井太一's Taipei stop was
// tagged 演唱會(1) only. Scanning only tag 13 structurally can't see events
// an organizer tagged some other way — same "whitelist can never be
// complete" problem as ORG_PAGE_VENUES, just one level up. Added 演唱會(1)
// and 音樂會(6) as well (Max's call: closest in meaning to 音樂, lowest
// noise) — 藝文活動(11) deliberately left out, it's broad enough (arts/
// culture generally, not music specifically) that it would need a lot more
// NOISE_KEYWORDS upkeep for what it adds; revisit if a future miss traces
// back to it. Each additional tag re-walks the same CATEGORY_BROWSE_MAX_PAGES
// pages, so this roughly triples Strategy 3's own runtime — accepted
// trade-off, same reasoning as the original 2min->6-8min one.
const CATEGORY_TAG_IDS = [13, 1, 6]; // 音樂, 演唱會, 音樂會
// Confirmed NOT strictly date-sorted (page 1 mixed an already-ended 9/22
// show among several in October) — a page cap can't guarantee catching
// every event in one run. Accepted trade-off: this is a daily job, and the
// existing known-raw-id skip means anything missed on one run is still
// free to catch on a later one once it resurfaces in the window this cap
// covers, at near-zero marginal cost (skip, not a full re-fetch). Raise
// this if a future gap traces back to a page beyond it.
const CATEGORY_BROWSE_MAX_PAGES = 20;

// Real Taiwanese address data mixes the colloquial (台北/台中) and official
// (臺北/臺中) characters — normalizeTraditionalChars (shared with
// normalize.mjs's city/venue matching, see its own doc comment) collapses
// both to one spelling before matching, instead of each call site
// maintaining its own separate [台臺] regex (that drift is exactly how this
// bug shipped in the first place — normalize.mjs's address matching and this
// file's venue matching were fixed as two unrelated one-off patches).
// Legacy's address checks use includes(), not startsWith(): real addresses
// often lead with a postal code ("100臺北市中正區…", ZAZEN to VOOID,
// 2026-09-23) — the same bug cityFromAddress() already had fixed on 09-21.
export const SEARCH_VENUES = [
  {
    keyword: "Legacy Taipei",
    match: (venue, address) => /^Legacy(\s|$)/.test(venue) && normalizeTraditionalChars(address).includes("台北"),
  },
  {
    keyword: "Legacy Taichung",
    match: (venue, address) => /^Legacy(\s|$)/.test(venue) && normalizeTraditionalChars(address).includes("台中"),
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

/** One page of the sitewide category browse for a given tag id (Strategy 3, see its doc comment above ORG_PAGE_VENUES/SEARCH_VENUES's own and CATEGORY_TAG_IDS). Same Cloudflare-bypass shape as fetchSearchResultUrls. */
async function fetchCategoryBrowsePage(tagId, pageNum) {
  return withPage(async (page) => {
    await page.goto(
      `https://kktix.com/events?end_at=&event_tag_ids_in=${tagId}&max_price=&min_price=&page=${pageNum}&search=&start_at=`,
      { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS },
    );
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

/**
 * 2026-09-22, found while chasing the same class of bug that produced the
 * other two templates above (Max: "那個第三種模板也修一下" — 6 events sat in
 * needs-review with a blank title_raw and date_unparseable): a THIRD KKTIX
 * template, seen on kklivetw/atc-twn (promoter-account, not livehouse-venue)
 * events. No `.header-title h1` at all — the page is a freeform campaign
 * layout (a hero image + rich-text blocks the organizer pastes in
 * themselves), so date/venue only exist as PROSE inside `.description-
 * wrapper .description`, not structured markup — same category of problem
 * iNDIEVOX/tixcraft/FANSI GO's price text already deals with, just for
 * date/venue instead of price. Every organizer phrases it slightly
 * differently (confirmed against 3+ different orgs, label variants:
 * "活動時間｜"/"活動日期："/"演出時間："/"演出日期｜", "活動地點｜"/"演出地點：",
 * "｜" vs "：" as the separator, and even the date's own internal
 * separator varies — "2026年10月4日" vs "2026.09.26" (HANAZAWA KANA,
 * welcome-music.kktix.cc) — regex is deliberately loose on the label,
 * separator, AND the date's internal punctuation, tight on the actual
 * 4-digit-year/month/day SHAPE that has to be there regardless of how it's
 * punctuated.
 * Time extraction is best-effort only: some orgs put a single time right
 * after the date, others list multiple session times (matinee/evening)
 * with no single correct answer — falls back to the first time found near
 * "開演" (show start) when the date line itself has none, and to null
 * (shown as "time not yet known" downstream, an already-established honest
 * gap elsewhere in this app) rather than guessing among several.
 */
function extractCampaignTemplateFields($) {
  const descText = $(".description-wrapper .description").text();

  // [^\d]{0,30} tolerates a short parenthetical note sitting between the
  // label and the actual date (real case, LEE MINHYUK: "活動時間｜（實際演出
  // 時間以現場公告為準） 2026 年 10 月 09 日"), not just plain whitespace.
  const dateMatch = descText.match(
    /(?:活動|演出)(?:時間|日期)[｜:：][^\d]{0,30}(\d{4})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})\s*日?/,
  );
  let date_raw = "";
  if (dateMatch) {
    const [, y, mo, d] = dateMatch;
    date_raw = `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}`;
    const inlineTimeMatch = descText
      .slice(dateMatch.index, dateMatch.index + 60)
      .match(/(\d{1,2}):(\d{2})/);
    const openingTimeMatch = descText.match(/(\d{1,2}):(\d{2})\s*開演/);
    const timeMatch = inlineTimeMatch ?? openingTimeMatch;
    if (timeMatch) date_raw += ` ${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  }

  const venueMatch = descText.match(/(?:活動|演出)地點[｜:：]\s*([^（(\n]+)[（(]([^）)]+)[）)]/);
  const venue_raw = venueMatch
    ? `${venueMatch[1].trim()} / ${venueMatch[2].trim().replace(/^地址[：:]\s*/, "")}`
    : "";

  // Price/ticket-status live behind a separate "活動場次" tab this doesn't
  // follow — KKTIX has no price_text_raw fallback path the way tixcraft/
  // iNDIEVOX/FANSI GO do (it's never needed one before now, ticket tiers
  // normally carry price directly), so tickets_raw stays empty and price
  // is simply unknown for this template, same honest gap as an event whose
  // old/new-template ticket table genuinely isn't published yet.
  return { date_raw, venue_raw, tickets_raw: [] };
}

/**
 * 2026-09-23 real bug (Max: 藤井風 10/31 高雄場票早就賣完了，卻仍顯示可購買):
 * the event page HTML this adapter scrapes for ticket-tier status
 * (extractOldTemplateFields/extractNewTemplateFields's `.status.closed`/
 * `.status.waiting` checks) simply never renders ANY status marker for some
 * large-venue org pages (confirmed: kklivetw/atc-twn) even once every tier
 * is genuinely sold out — the "已售完" badge only ever shows up client-side
 * on the separate /registrations/new sub-page, driven by this JSON endpoint.
 * A ticket row with no status marker at all was (wrongly) treated as "open"
 * by statusFromTickets(), so a fully sold-out show reported on_sale.
 * `register_status` here (IN_STOCK / SOLD_OUT / REGISTRATION_CLOSED /
 * COMING_SOON) is KKTIX's own real-time inventory check, authoritative
 * regardless of what the static ticket table shows or doesn't show —
 * confirmed by cross-checking against the registration page's rendered
 * "已售完" text for this exact event.
 *
 * 2026-09-23 follow-up (first version of this function shipped broken, only
 * caught by actually re-running the fetch and checking real output, not just
 * `npm test`): calling the bare `/g/events/{id}/register_info` JSON endpoint
 * with `fetch()` from an unrelated already-loaded page — even one that had
 * just passed kktix.com's own Cloudflare challenge — still got a 403 "Just a
 * moment..." challenge page every time (confirmed directly: a page that
 * successfully rendered kktix.com's homepage got blocked calling this exact
 * endpoint moments later). This sub-resource endpoint sits behind a
 * stricter/separate Cloudflare rule than the page it's normally fetched
 * from. What actually works (confirmed): a real navigation to the event's
 * own `/registrations/new` page, which triggers this same endpoint as part
 * of ITS OWN legitimate page load — intercept that response instead of
 * calling the endpoint directly. Heavier (a full navigation per check, not
 * a same-page JS fetch) but the only version actually confirmed to get past
 * Cloudflare, which is what matters here.
 */
// 2026-09-23 measurement that prompted tracking this at all: a real run
// logged 275 first-attempt failures out of ~275 checks (the comment below
// assumed ~1 in 3), and a follow-up 5-event experiment got HTTP 403
// (Cloudflare's challenge page) on 9 of 10 attempts after the first one
// succeeded — consistent with per-IP rate limiting on this endpoint, not a
// per-page cookie problem (a shared browser context failed the same way).
// Success was never logged, so the real hit rate was unknowable; these
// counters end up in sources.json via runStats().
let registerStats = null;
function resetRegisterStats() {
  registerStats = { checked: 0, ok_first_try: 0, ok_on_retry: 0, failed: 0, blocked_403: 0, skipped_known: 0 };
}
resetRegisterStats();

export function runStats() {
  return { register_info: { ...registerStats } };
}

/**
 * Whether a KNOWN event's register_info check can change anything.
 * resolveKnownEvent() only acts on SOLD_OUT/REGISTRATION_CLOSED, so:
 * - already sold_out/ended: a repeat SOLD_OUT just re-fetched the detail page
 *   to arrive at the same status, and a revert to IN_STOCK was never acted
 *   on either — skipping loses nothing the old behavior actually did.
 * - announced with an on-sale date still in the future: tickets aren't on
 *   sale yet, so they can't be sold out.
 * Fewer checks is also fewer chances to trip the rate limit above.
 */
export function needsRegisterCheck(previous, todayStr = taiwanTodayDateStr()) {
  if (!previous) return true;
  if (previous.status === "sold_out" || previous.status === "ended") return false;
  if (previous.status === "announced" && previous.on_sale_at && previous.on_sale_at.slice(0, 10) > todayStr) return false;
  return true;
}

async function fetchRegisterStatus(browser, rawId) {
  if (!browser) return null;
  registerStats.checked += 1;
  // 2026-09-23 real bug (found by running this THREE times in a row against
  // the exact same live event: SOLD_OUT, null, SOLD_OUT): Cloudflare's
  // challenge on this endpoint is genuinely flaky per-attempt — roughly 1 in
  // 3 real attempts served the "Just a moment..." HTML challenge page again
  // instead of the real JSON, even from a brand-new page with no prior
  // navigation. A single null here used to silently fall through to the
  // ticket-table's (wrong, for this class of page) "no status marker = open"
  // default — one retry with a fresh page, same one-retry shape fetchHtml()
  // already uses elsewhere in this file for the same kind of transient miss.
  for (let attempt = 0; attempt < 2; attempt++) {
    let page;
    try {
      page = await newPage(browser);
      let captured = null;
      let saw403 = false;
      page.on("response", async (res) => {
        if (captured || !res.url().includes(`/g/events/${rawId}/register_info`)) return;
        if (res.status() === 403) saw403 = true;
        try {
          captured = await res.json();
        } catch {
          // response body already consumed/not JSON (Cloudflare challenge page) — leave captured null, retry below
        }
      });
      await page.goto(`https://kktix.com/events/${rawId}/registrations/new`, {
        waitUntil: "domcontentloaded",
        timeout: REQUEST_TIMEOUT_MS,
      });
      await page.waitForTimeout(2000); // let Cloudflare's challenge + the page's own register_info XHR both finish
      if (saw403) registerStats.blocked_403 += 1;
      if (captured?.register_status) {
        if (attempt === 0) registerStats.ok_first_try += 1;
        else registerStats.ok_on_retry += 1;
        return captured.register_status;
      }
      if (attempt === 0) logProgress(`register_info check for ${rawId} got no usable response, retrying once`);
    } catch (err) {
      logProgress(`register_info check failed for ${rawId} (attempt ${attempt + 1}): ${err.message}`);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
  registerStats.failed += 1;
  return null;
}

/**
 * Scrapes one event's own page — this is the only place price/venue/date are
 * complete.
 *
 * `knownRegisterStatus` (2026-09-23 real bug, found by actually re-running
 * fetch and checking the output rather than trusting the code read right):
 * resolveKnownEvent() below already calls fetchRegisterStatus() once to
 * DECIDE whether a known event needs re-fetching at all — calling it a
 * SECOND time in here (once per re-fetch) to fill in the returned object's
 * own `register_status` field sent two back-to-back real navigations to the
 * same event's Cloudflare-protected registrations page. The second one
 * intermittently came back null (confirmed live: 藤井風 10/31 高雄場 —
 * resolveKnownEvent's own check correctly saw SOLD_OUT and triggered a
 * re-fetch, but the re-fetch's own internal check silently got nothing back,
 * so the re-fetched event ended up on_sale again, the exact bug this file
 * was supposed to have fixed). Pass an already-known status through instead
 * of re-deriving it whenever the caller has one, so this only ever hits the
 * network when nobody's checked yet (a genuinely new event).
 */
async function fetchEventDetail(url, browser, knownRegisterStatus) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const usesNewTemplate = $(".side-inner").length > 0 && $(".event-info").length === 0;
  const usesCampaignTemplate = $(".header-title h1").text().trim() === "" && $(".description-wrapper").length > 0;
  const templateTitle = usesCampaignTemplate ? $("title").first().text().trim() : $(".header-title h1").first().text().trim();
  const templateFields = usesCampaignTemplate
    ? extractCampaignTemplateFields($)
    : usesNewTemplate
      ? extractNewTemplateFields($)
      : extractOldTemplateFields($);

  // 2026-09-23 (Max: "如果有第五種模板 你是不是又抓不到，然後等使用者發現
  // 少場次" — fair: three template-specific extractors already exist and a
  // FOURTH turned up the same day, confirmed live (baodaorecords/some HK
  // organizers: `.event-info` exists so it's misdetected as the old
  // template, but it's a flat `<p>date</p>` + two `.info-desc` spans, not
  // the `ul.info li` list the old-template selector needs — date AND venue
  // both come back empty, and the venue miss means isOutsideTaiwanVenue()
  // never even got a chance to filter an actual Hong Kong show). Chasing
  // template shapes one at a time is exactly the reactive, always-one-step-
  // behind pattern this project has already pushed back on for org
  // whitelists (see ORG_PAGE_VENUES's 2026-09-22 comment) — the real fix is
  // to stop depending on organizer-controlled page markup for these three
  // fields at all. Confirmed live (old template, this 4th template, and a
  // Hong Kong organizer's page all checked): every KKTIX event page embeds
  // a `<script type="application/ld+json">` Schema.org Event block with a
  // real title/startDate/venue — this is KKTIX's own SEO output, generated
  // server-side the same way regardless of which visual template the
  // organizer's page happens to render with, not something an organizer's
  // page design can vary. Used as the PRIMARY source for title/date/venue
  // now, with the template-specific extractors only as a fallback for a
  // page that somehow lacks it — a genuinely future-proof fix for THESE
  // three fields regardless of how many more template shapes KKTIX grows.
  // Ticket price/status (`tickets_raw`) still needs template-specific
  // scraping — the JSON-LD's `offers` array is empty on every page checked,
  // KKTIX doesn't populate it — so a 5th template could still miss price/
  // status, but that fails safe (empty tickets_raw reads as "known event,
  // price/status just not published yet", never as a lost event).
  const jsonLd = extractJsonLdEvent($);
  const title_raw = jsonLd?.name || templateTitle;
  const date_raw = jsonLd?.date_raw || templateFields.date_raw;
  const venue_raw = jsonLd?.venue_raw || templateFields.venue_raw;
  const { tickets_raw } = templateFields;

  const raw_id = url.split("/").filter(Boolean).pop();
  const register_status = knownRegisterStatus !== undefined ? knownRegisterStatus : await fetchRegisterStatus(browser, raw_id);
  return { raw_id, url, title_raw, date_raw, venue_raw, tickets_raw, register_status, source_name: name };
}

/**
 * KKTIX's own server-generated Schema.org Event JSON-LD block — see the doc
 * comment above its call site for why this is preferred over any of the
 * template-specific extractors for title/date/venue. Formats date/venue
 * into the same raw-text shapes parseKktixDate()/parseKktixVenue() already
 * expect from the template extractors (`YYYY/MM/DD HH:MM`, `venue / address`)
 * rather than changing what normalize.mjs accepts — this is a second SOURCE
 * for those strings, not a new format for them to handle.
 */
function extractJsonLdEvent($) {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let parsed;
    try {
      parsed = JSON.parse($(el).text());
    } catch {
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const event = entries.find((e) => e && e["@type"] === "Event");
    if (!event?.startDate) continue;
    const m = event.startDate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const [, y, mo, d, h, mi] = m;
    const venueName = event.location?.name?.trim();
    const venueAddress = event.location?.address?.trim();
    return {
      name: event.name?.trim() || null,
      date_raw: `${y}/${mo}/${d} ${h}:${mi}`,
      venue_raw: venueName ? (venueAddress ? `${venueName} / ${venueAddress}` : venueName) : null,
    };
  }
  return null;
}

/**
 * 2026-09-23 (same real bug as fetchRegisterStatus's doc comment, the
 * staleness half of it): incremental fetch normally skips an already-known
 * event's detail page entirely — cheap, but it also means a status change
 * (most importantly: going sold out) on an event LiveRadar already knows
 * about would never be picked up again, ever, even after fetchEventDetail's
 * fix above stops the bug from happening to newly-discovered events. Check
 * the same lightweight register_info endpoint for known events too before
 * accepting reuse_previous — if it now says sales are over, treat the event
 * as needing a real re-fetch (also picks up a since-updated price) instead
 * of blindly reusing possibly-stale normalized data. Returns either a
 * `reuse_previous` stub (nothing changed) or a full fetchEventDetail()
 * result (status flipped) — `null` only if the forced re-fetch itself failed.
 */
async function resolveKnownEvent(raw_id, url, browser, warnings, previous) {
  if (!needsRegisterCheck(previous)) {
    registerStats.skipped_known += 1;
    return { raw_id, url, title_raw: null, source_name: name, reuse_previous: true };
  }
  await sleep(REGISTER_CHECK_DELAY_MS);
  const registerStatus = await fetchRegisterStatus(browser, raw_id);
  if (registerStatus !== "SOLD_OUT" && registerStatus !== "REGISTRATION_CLOSED") {
    return { raw_id, url, title_raw: null, source_name: name, reuse_previous: true };
  }
  await sleep(REQUEST_DELAY_MS);
  logProgress(`known event ${raw_id} now reports ${registerStatus}, re-fetching detail instead of reusing stale data`);
  try {
    return await fetchEventDetail(url, browser, registerStatus);
  } catch (err) {
    warnings.push(`event detail failed for ${url}: ${err.message}`);
    return null;
  }
}

export async function fetch(knownRawIds = new Map()) {
  resetRegisterStats();
  return withBrowser(async (browser) => fetchWithBrowser(browser, knownRawIds));
}

/**
 * The real body of fetch(), given a browser that's kept open for the whole
 * run — 2026-09-23: needed so every event's register_info sale-status check
 * (see fetchRegisterStatus, which opens and closes its own short-lived page
 * per check against this shared browser) reuses one browser PROCESS instead
 * of paying a fresh-launch cost per event the way fetchSearchResultUrls/
 * fetchCategoryBrowsePage's per-call withPage() does (fine for a handful of
 * listing pages, far too slow for one call per event).
 */
async function fetchWithBrowser(browser, knownRawIds) {
  const results = [];
  const warnings = [];
  let skippedKnown = 0;
  // Tracks every raw_id already added to `results` THIS run, across all
  // three strategies — Strategy 3 (category browse) is a superset of what
  // 1/2 already find, so without this it would re-discover and re-queue the
  // same events a second time, producing duplicate needs-review entries the
  // same way Ticket Plus's missing dedup did (see fetch.mjs's 2026-09-22 fix).
  const seenRawIds = new Set();
  // raw_id -> already-fetched detail for events Strategy 2's venue filter
  // rejected (see the comment where it's filled in).
  const searchRejected = new Map();

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
      seenRawIds.add(raw_id);
      if (knownRawIds.has(raw_id)) {
        skippedKnown += 1;
        const resolved = await resolveKnownEvent(raw_id, url, browser, warnings, knownRawIds.get(raw_id));
        if (resolved) {
          results.push(resolved);
          if (!resolved.reuse_previous) logProgress(`  + ${resolved.title_raw} (sale status changed, re-fetched)`);
        }
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching detail: ${url}`);
      try {
        const detail = await fetchEventDetail(url, browser);
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
      if (seenRawIds.has(raw_id) || searchRejected.has(raw_id)) continue; // same URL can come back from several venue searches
      if (knownRawIds.has(raw_id)) {
        seenRawIds.add(raw_id);
        skippedKnown += 1;
        const resolved = await resolveKnownEvent(raw_id, url, browser, warnings, knownRawIds.get(raw_id));
        if (resolved?.reuse_previous) {
          results.push(resolved);
        } else if (resolved) {
          // Sale status changed and got a real re-fetch — still needs the
          // same venue-match filter the fresh path below applies, since a
          // known raw_id passing that filter last run doesn't exempt a
          // freshly re-scraped venue_raw from being checked again.
          const [venuePart, addressPart = ""] = resolved.venue_raw.split("/").map((s) => s.trim());
          if (match(venuePart, addressPart)) {
            results.push(resolved);
            logProgress(`  + ${resolved.title_raw} (sale status changed, re-fetched)`);
          }
        }
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching detail: ${url}`);
      let detail;
      try {
        detail = await fetchEventDetail(url, browser);
      } catch (err) {
        warnings.push(`event detail failed for ${url}: ${err.message}`);
        continue;
      }
      const [venuePart, addressPart = ""] = detail.venue_raw.split("/").map((s) => s.trim());
      if (match(venuePart, addressPart)) {
        seenRawIds.add(raw_id);
        results.push(detail);
        logProgress(`  + ${detail.title_raw}`);
      } else {
        // Not at THIS search's venue, but not necessarily junk. 2026-09-23 real
        // bug (ZAZEN to VOOID @ Legacy Taipei, missing every run): this used to
        // mark the raw_id seen before the venue check, so a rejected event was
        // also skipped by Strategy 3 below even when it's a real show sitting in
        // the music category. Kept (not marked seen) so Strategy 3 can still
        // accept it, reusing this already-fetched detail instead of a 2nd request.
        searchRejected.set(raw_id, detail);
      }
    }
  }

  // Strategy 3: sitewide category browse across every music-adjacent tag —
  // catches events from ANY organizer, known or not, regardless of which of
  // KKTIX's overlapping music categories they happened to tag it under (see
  // the doc comment above CATEGORY_TAG_IDS).
  let categoryFoundCount = 0;
  for (const tagId of CATEGORY_TAG_IDS) {
    for (let pageNum = 1; pageNum <= CATEGORY_BROWSE_MAX_PAGES; pageNum++) {
      await sleep(REQUEST_DELAY_MS);
      logProgress(`fetching category browse tag=${tagId} page ${pageNum}/${CATEGORY_BROWSE_MAX_PAGES}`);
      let eventUrls = [];
      try {
        eventUrls = await fetchCategoryBrowsePage(tagId, pageNum);
      } catch (err) {
        warnings.push(`category browse tag=${tagId} page ${pageNum} failed: ${err.message}`);
        break; // stop paginating this tag on a real failure rather than silently skipping ahead
      }
      if (eventUrls.length === 0) break; // ran past the last page for this tag

      for (const url of eventUrls) {
        const raw_id = url.split("/").filter(Boolean).pop();
        if (seenRawIds.has(raw_id)) continue; // already found via Strategy 1/2, or an earlier tag/page this run
        seenRawIds.add(raw_id);
        categoryFoundCount += 1;

        if (searchRejected.has(raw_id)) {
          const detail = searchRejected.get(raw_id);
          results.push(detail);
          logProgress(`  + ${detail.title_raw} (rejected by a venue search, recovered via category browse)`);
          continue;
        }

        if (knownRawIds.has(raw_id)) {
          skippedKnown += 1;
          const resolved = await resolveKnownEvent(raw_id, url, browser, warnings, knownRawIds.get(raw_id));
          if (resolved) {
            results.push(resolved);
            if (!resolved.reuse_previous) logProgress(`  + ${resolved.title_raw} (sale status changed, re-fetched)`);
          }
          continue;
        }

        await sleep(REQUEST_DELAY_MS);
        logProgress(`fetching detail: ${url}`);
        try {
          const detail = await fetchEventDetail(url, browser);
          results.push(detail);
          logProgress(`  + ${detail.title_raw}`);
        } catch (err) {
          warnings.push(`event detail failed for ${url}: ${err.message}`);
        }
      }
    }
  }
  logProgress(`category browse: ${categoryFoundCount} event(s) not already found by Strategy 1/2`);

  if (skippedKnown > 0) {
    logProgress(`KKTIX: ${skippedKnown} event(s) already known, skipping detail fetch`);
  }
  if (warnings.length) {
    console.warn(`[kktix] ${warnings.length} sub-request(s) failed:\n` + warnings.join("\n"));
  }

  return results;
}
