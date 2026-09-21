import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTISTS_PATH = path.join(__dirname, "..", "data", "artists.yml");
const VENUES_PATH = path.join(__dirname, "..", "data", "venues.yml");

// 台北/台中/台南/台東 have an official traditional-character variant
// (臺北/臺中/臺南/臺東) that real address/venue-name data actually uses —
// found via Ticket Plus, whose address field is consistently "臺北市"/
// "臺中市"/"臺南市", not "台北市"/"台中市"/"台南市". Normalizing 臺→台 once,
// up front, closes this off everywhere instead of special-casing each
// affected city — the first version of this fix (2026-09-17) instead
// enumerated 4 hardcoded regex alternations, which still left every OTHER
// place in the codebase doing the same 台/臺 comparison (venues.yml's plain
// substring match, kktix.mjs's SEARCH_VENUES) unfixed. Exported so those
// other call sites can share this instead of re-deriving it.
export function normalizeTraditionalChars(text) {
  return text.replace(/臺/g, "台");
}

const CITY_NAMES = [
  "台北", "新北", "桃園", "新竹", "苗栗", "台中", "彰化", "南投",
  "雲林", "嘉義", "台南", "高雄", "屏東", "宜蘭", "花蓮", "台東",
  "澎湖", "金門", "連江",
];

// 2026-09-21 real bug: switched from .startsWith() to .includes() — some
// organizers' addresses have a postal code AND the country name before the
// city ("116台灣臺北市文山區...", "403台灣臺中市西區...", confirmed on real
// KKTIX/iNDIEVOX event pages), which .startsWith() rejects outright even
// after stripping the postal code, since "台灣" is still in the way. Rather
// than keep enumerating every prefix format someone might type (postal code,
// country name, building name, whatever comes next), just search for the
// city name anywhere in the address — real Taiwan addresses always contain
// the city name as its own token, never as a false-positive substring of
// something else, so this is strictly more robust with no new risk.
function cityFromAddress(address) {
  const normalized = normalizeTraditionalChars(address);
  return CITY_NAMES.find((c) => normalized.includes(c)) ?? null;
}

// 2026-09-18: found via a real event ("爛泥發芽10週年" tagged 專場 instead of
// 音樂祭) that this list had two gaps, both worth fixing at the root instead
// of one-off patching each title: (1) "音樂節" is a real, commonly-used
// synonym for "festival" that only "音樂祭" was covering — 臺北爵士音樂節 was
// silently missing it; (2) some real festivals are branded/named events
// whose own title never spells out "音樂祭"/"音樂節" at all (爛泥發芽, 拓元's
// RUSH BALL, FNC Entertainment's multi-band FNC BAND KINGDOM showcase) — for
// these, matching the brand name itself is the only way to catch them. All
// three were previously in data/artists.yml as if they were solo-performer
// canonicals, which is what fed them into the headliners[0]-based "專場"
// fallback in the first place.
const TYPE_KEYWORDS = [
  ["音樂祭", "音樂祭"],
  ["音樂節", "音樂祭"],
  ["Music Festival", "音樂祭"], // English equivalent of 音樂節/音樂祭, same gap this session found (Kaohsiung Park Music Festival)
  ["爛泥發芽", "音樂祭"],
  ["RUSH BALL", "音樂祭"],
  ["FNC BAND KINGDOM", "音樂祭"],
  ["ASIA METAL FESTIVAL", "音樂祭"],
  ["火球祭", "音樂祭"],
  ["秋夜爵醒祭", "音樂祭"],
  ["FRIENDS MEETING", "音樂祭"], // self-describes as "一場音樂節" in its own copy but the title itself never spells out 音樂祭/音樂節
  ["見面會", "見面會"],
  ["FANDAY", "見面會"], // English equivalent (GMMTV FANDAY)
  ["簽唱會", "簽唱會"],
  ["音樂劇", "音樂劇"],
  ["巡迴", "巡迴"],
  ["Tour", "巡迴"],
  ["拼盤", "拼盤"],
  ["電音派對", "拼盤"], // general synonym: an "electronic music party" title implies multiple acts/DJs, same shape as 拼盤
  ["重型宇宙派對", "拼盤"],
  ["Punk Strike", "拼盤"],
  ["PHANTASMAGORIA", "拼盤"],
  ["西部地區懸賞公告", "拼盤"], // themed multi-band bill brand, title never spells out band names or 拼盤
  ["河馬玖狂", "拼盤"], // same shape: "四團共演" bill, brand name only in the title
  ["交個朋友吧", "拼盤"],
  ["古典", "古典"],
];

export function loadArtists() {
  const raw = readFileSync(ARTISTS_PATH, "utf-8");
  return loadYaml(raw) ?? [];
}

export function loadVenues() {
  const raw = readFileSync(VENUES_PATH, "utf-8");
  return loadYaml(raw) ?? [];
}

const ASCII_WORD = /^[A-Za-z0-9]+$/;
// Broader than ASCII_WORD: also true for a multi-word/punctuated Latin phrase
// like "Punk Strike" or "RUSH BALL" (which ASCII_WORD rejects outright since
// it contains a space) — anything in this class still gets case-insensitive
// matching below, just not the word-boundary check (a several-word phrase is
// already specific enough not to need one).
const ASCII_ONLY = /^[\x00-\x7F]+$/;
function isAsciiWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/**
 * Finds `name` inside `titleRaw`, returning its index or null.
 *
 * A pure-ASCII/Latin name (e.g. "FLOW", "IVE", "ASCA") requires a word
 * boundary on both sides — three real, unrelated bugs this session were all
 * the same shape: a short Latin canonical silently matching as a substring of
 * an unrelated English word ("IVE" inside "LIVE", "ASCA" inside a
 * "...Brasca" alias, "FLOW" inside LE SSERAFIM's "PUREFLOW" tour name).
 * Renaming each offending canonical one at a time doesn't scale once
 * artists.yml has ~230 entries — this is the general fix. A CJK/mixed name
 * keeps plain substring matching: Chinese text has no spaces to define a
 * "word boundary" against, and an artist name embedded in a longer title
 * string is the normal, correct case there (see the ⚠️ short/common-word
 * comments already in artists.yml for known residual risk in that case).
 */
export function findNameIndex(titleRaw, name) {
  if (!ASCII_ONLY.test(name)) {
    // CJK/mixed name: plain, case-sensitive substring match (unchanged).
    const idx = titleRaw.indexOf(name);
    return idx === -1 ? null : idx;
  }
  // ASCII names match case-insensitively — real data has the same brand
  // titlecased in one listing and all-caps in another (indieVOX's "Punk
  // Strike Warm-Up Party #6" vs "PUNK STRIKE：NEXT GENERATION", both the same
  // event series). toLowerCase() doesn't change string length for ASCII, so
  // indices found on the lowercased strings still index correctly into the
  // original titleRaw for the word-boundary check below.
  const lowerTitle = titleRaw.toLowerCase();
  const lowerName = name.toLowerCase();
  if (!ASCII_WORD.test(name)) {
    // A multi-word/punctuated phrase ("Punk Strike", "RUSH BALL") is already
    // specific enough that it doesn't need the word-boundary check below.
    const idx = lowerTitle.indexOf(lowerName);
    return idx === -1 ? null : idx;
  }
  let fromIndex = 0;
  while (true) {
    const idx = lowerTitle.indexOf(lowerName, fromIndex);
    if (idx === -1) return null;
    if (!isAsciiWordChar(titleRaw[idx - 1]) && !isAsciiWordChar(titleRaw[idx + name.length])) {
      return idx;
    }
    fromIndex = idx + 1;
  }
}

/**
 * Find every known artist whose alias/canonical name appears in the raw title.
 *
 * Order matters: headliners[0] is treated elsewhere as "the main act" (the
 * exclude-menu's displayed artist, the block-artist target, the tags_origin
 * pick before the fix below). Sorting by each match's first character
 * position IN THE TITLE — not by artists.yml's file order — is what makes
 * that "main act" the one actually billed first in the text, instead of
 * whichever artist happens to sit earliest in the data file. This only
 * mattered rarely with a 2-entry file; with ~230 entries, multi-headliner
 * bills are common enough that file-order was producing an effectively
 * arbitrary "main act" (found in review, 2026-09-17).
 */
export function matchArtists(titleRaw, artistsYml) {
  const matches = [];
  for (const entry of artistsYml) {
    const names = [entry.canonical, ...(entry.aliases ?? [])];
    let best = null; // { index, length }
    for (const n of names) {
      const idx = findNameIndex(titleRaw, n);
      if (idx !== null && (best === null || idx < best.index || (idx === best.index && n.length > best.length))) {
        best = { index: idx, length: n.length };
      }
    }
    if (best !== null) {
      matches.push({ canonical: entry.canonical, position: best.index, length: best.length });
    }
  }
  // 2026-09-21 real bug: "MONO" and "MONO NO AWARE" are two distinct, real
  // bands where one's name is an exact word-prefix of the other's ("MONO NO
  // AWARE PASSION TOUR 2027" was matching canonical "MONO", added the same
  // day for an unrelated MONO show). Both are legitimate matches in
  // isolation, so this isn't the IVE/LIVE-style "one is bogus" collision the
  // artists.yml test guards against — it only becomes wrong when they tie on
  // the exact same starting position in the SAME title, since a title can't
  // simultaneously BE both artists at that word span. When that happens, the
  // longer/more specific match wins and the shorter one is dropped.
  const byPosition = new Map();
  for (const m of matches) {
    const existing = byPosition.get(m.position);
    if (!existing || m.length > existing.length) byPosition.set(m.position, m);
  }
  return Array.from(byPosition.values())
    .sort((a, b) => a.position - b.position)
    .map((m) => m.canonical);
}

/** "2026/09/16(周三) 20:00(+0800)" or "2026/09/16 20:00(+0800)" -> { date, time } */
export function parseKktixDate(dateRaw) {
  const m = dateRaw.match(/(\d{4})\/(\d{2})\/(\d{2})(?:\([^)]*\))?\s*(\d{2}:\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, time] = m;
  return { date: `${y}-${mo}-${d}`, time: time ?? null };
}

/**
 * "The Wall Live House / 台北市文山區羅斯福路四段200號B1" -> { venue, city }
 *
 * 2026-09-21 real bug: some organizers don't fill in a real address at all —
 * found live ("The Wall Live House / The Wall Live House", the venue name
 * repeated as its own "address") — cityFromAddress() correctly finds nothing
 * there, but the venue name itself is often a known one. Falls back to the
 * same venues.yml lookup tixcraft/FANSI GO already use for exactly this
 * reason (their listings never have an address at all), instead of settling
 * for "未知" when a perfectly identifiable venue name is right there.
 */
export function parseKktixVenue(venueRaw, venuesYml = []) {
  const [venuePart, addressPart = ""] = venueRaw.split("/").map((s) => s.trim());
  const city = cityFromAddress(addressPart) ?? parseTixcraftVenue(venuePart, venuesYml).city;
  return { venue: venuePart, city };
}

/** "2027/05/01 (六)  ~ 2027/05/02 (日) " or "2026/12/10 (四)" -> { date, time: null } */
export function parseTixcraftDate(dateRaw) {
  const m = dateRaw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return { date: `${y}-${mo}-${d}`, time: null };
}

/** No address on tixcraft's listing page — look the venue name up in venues.yml instead. */
export function parseTixcraftVenue(venueRaw, venuesYml) {
  // Normalize both sides so a venues.yml entry only needs one spelling —
  // "台北小巨蛋" now also matches a source that renders it "臺北小巨蛋"
  // without needing a second, parallel entry (see normalizeTraditionalChars).
  // 2026-09-21: also lowercase both sides — real data has the same venue in
  // at least 3 different cases ("The Wall Live House", "THE WALL LIVE
  // HOUSE", "THE WALL表演廳外L形走廊"), which a case-sensitive match would
  // need a separate venues.yml entry per variant to catch. toLowerCase() is
  // a no-op on CJK characters, so this is safe for the mixed-script entries.
  const normalizedVenue = normalizeTraditionalChars(venueRaw).toLowerCase();
  const entry = venuesYml.find((v) => normalizedVenue.includes(normalizeTraditionalChars(v.match).toLowerCase()));
  return { venue: venueRaw, city: entry?.city ?? null };
}

/**
 * "2026.09.19 (Sat.) 19:30 open / 20:00 start" -> { date, time: "20:00" }
 * (prefer the show's actual start time over doors-open); falls back to the
 * listing page's dateless "2026/09/18 (五)" -> { date, time: null } when the
 * detail page's freeform info block didn't have a date line at all.
 */
export function parseIndievoxDate(dateRaw) {
  // Organizer-authored freeform text uses at least three different date
  // formats in the wild: "2026.09.19", "2026 / 10 / 2" (spaced slashes), and
  // "2026年10月3日" (Chinese units, no punctuation) — all three found across
  // real events. Try Chinese-unit form first since its digits aren't
  // separated by "." or "/" at all and won't match the other pattern.
  const m =
    dateRaw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/) ??
    dateRaw.match(/(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const startMatch = dateRaw.match(/(\d{1,2}:\d{2})\s*start/i);
  const anyTimeMatch = dateRaw.match(/(\d{1,2}:\d{2})/);
  const time = (startMatch ?? anyTimeMatch)?.[1] ?? null;
  return { date, time };
}

/**
 * "WESTAR（台北市萬華區西門里漢中街116號8樓）" -> { venue: "WESTAR", city: "台北" }.
 * Organizer-authored freeform text: many events give a bare venue name with
 * no address at all (e.g. "野地方 Wildlab") — venues.yml (same table
 * tixcraft's untracked venues use) is the fallback for those.
 */
export function parseIndievoxVenue(venueRaw, venuesYml) {
  const m = venueRaw.match(/^(.*?)[（(]([^）)]+)[）)]/);
  if (m) {
    const [, venue, address] = m;
    // Same 2026-09-21 fallback as parseKktixVenue: the parenthesized part
    // isn't always a real address (an organizer can write anything in there)
    // — if it doesn't yield a city, try the venue name itself against
    // venues.yml rather than settling for "未知".
    const city = cityFromAddress(address) ?? parseTixcraftVenue(venue.trim(), venuesYml).city;
    return { venue: venue.trim(), city };
  }
  // 2026-09-21: a 4th real freeform format found ("Bullet Burger 子彈漢堡
  // 403台灣臺中市西區...") — no parens at all, just venue-name-then-address
  // space-separated in one run-on string. cityFromAddress() now searches
  // anywhere in the text (see its own comment) rather than requiring the
  // city name at a specific offset, so trying it on the whole raw string
  // before falling back to a venues.yml name lookup catches this too.
  return { venue: venueRaw, city: cityFromAddress(venueRaw) ?? parseTixcraftVenue(venueRaw, venuesYml).city };
}

/**
 * "2027-01-09 ~ 2027-01-09 18:00 ~ 18:00" -> { date: "2027-01-09", time: "18:00" }.
 * Ticket Plus's sessions.json gives `date`/`time` as separate, already-clean
 * fields (dash-separated start~end ranges) — the adapter concatenates them
 * into one string since RawEvent only has a single date_raw slot, this just
 * pulls the start date/time back out. No freeform-text ambiguity to handle
 * here, unlike iNDIEVOX/FANSI GO — this is the one source with a real
 * structured API instead of scraped HTML.
 */
export function parseTicketPlusDate(dateRaw) {
  const dateMatch = dateRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const [, y, mo, d] = dateMatch;
  const timeMatch = dateRaw.match(/(\d{2}:\d{2})/);
  return { date: `${y}-${mo}-${d}`, time: timeMatch?.[1] ?? null };
}

export function guessTagsType(titleRaw, headlinerCount) {
  // Case-insensitive for the same reason as findNameIndex above — an
  // all-caps "PERSONA LIVE TOUR" title otherwise silently misses the
  // ["Tour", "巡迴"] entry that a titlecased "...Tour..." would hit.
  const lowerTitle = titleRaw.toLowerCase();
  for (const [kw, tag] of TYPE_KEYWORDS) {
    if (lowerTitle.includes(kw.toLowerCase())) return [tag];
  }
  return headlinerCount > 1 ? ["拼盤"] : ["專場"];
}

function priceFromTickets(ticketsRaw) {
  // Prefer tiers that are actually purchasable — a closed early-bird tier's
  // price shouldn't be shown as the current price_min. Only fall back to
  // closed tiers (for reference) when EVERY tier is closed, i.e. the event
  // is already sold out and there's no "current" price to speak of anyway.
  const openTickets = ticketsRaw.filter((t) => !t.closed);
  const relevant = openTickets.length > 0 ? openTickets : ticketsRaw;
  const prices = relevant.map((t) => t.price).filter((p) => typeof p === "number");
  if (prices.length === 0) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// FANSI GO's decorative event pages write prices as fullwidth Unicode
// ("ＮＴ＄５００") — \d and $ only match halfwidth characters, so this has to
// run before any of the money regexes below. The fullwidth ASCII block
// (！-～, U+FF01-FF5E) is a fixed +0xFEE0 shift from real ASCII for every
// character in it (digits, letters, and punctuation like $ alike), so one
// shift normalizes all of them at once.
function normalizeFullwidthAscii(text) {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// Turns a raw HTML blob into newline-separated plain text WITHOUT breaking a
// sentence mid-way — block-level tags (<br>/<p>/<div>/<li>) become line
// breaks, everything else (<span>, <strong>, inline style wrappers) is just
// stripped. This distinction matters here specifically: tixcraft's and
// Ticket Plus's rich-text-authored price lines wrap individual numbers in
// their own <span> ("<span>NT$ 3,380</span>起至 NT$ 7,980") — naively turning
// EVERY tag into a newline would shatter "票價：" onto its own empty line,
// separated from the numbers that are supposed to follow it on the same line.
function htmlToLines(html) {
  return html
    .replace(/<(?:br|p|div|li)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

const PRICE_LABEL_RE = /(?:票價|門票)[：｜:]\s*([^\n]{1,200})/;
const CURRENCY_NUMBER_RE = /(?:NT\$|\$)\s*([\d,]+)|([\d,]+)\s*元/g;
// Looser fallback for pages with no overall "票價"/"門票" heading at all
// (FANSI GO) — still requires a price-shaped word immediately next to the
// number, not just any digit on the page. 身障/愛心席 deliberately NOT
// included here (see stripDiscountTierText below) — same reasoning.
const PRICE_KEYWORD_RE = /(?:預售|現場|單人|雙人|套票|adv|door)[^\d]{0,8}(\d[\d,]*)/gi;
// 2026-09-21 real bug (Max): 身障票/愛心席/陪同票 are restricted-eligibility
// discount tiers, not a price a general visitor can actually get — but they
// were being extracted like any other tier, and since they're usually the
// cheapest, frequently became the displayed "NT$X up" price (real case:
// "身障票 600 元" showing as the headline price on an event whose real
// general-admission price starts at NT$1,200). Strip a discount-tagged
// clause AND any shared-prefix number list immediately following it (e.g.
// "身障優惠票(陪同票)NT$2,990/2,690/2,490") before either extraction path
// runs, so these numbers are never candidates for min/max at all.
const DISCOUNT_TIER_RE = /(?:身障|愛心|陪同)[^\d]{0,20}[\d,]+(?:\s*[/、,，]\s*[\d,]+)*\s*元?/g;
function stripDiscountTierText(text) {
  return text.replace(DISCOUNT_TIER_RE, "");
}

function priceRangeFromNumbers(numbers) {
  // Sanity floor/ceiling, not a source of truth: catches a stray one- or
  // two-digit match (a footnote number, a percentage) without needing to
  // second-guess genuinely expensive VIP tiers.
  const plausible = numbers.filter((n) => n >= 50 && n <= 100000);
  if (plausible.length === 0) return { min: null, max: null };
  return { min: Math.min(...plausible), max: Math.max(...plausible) };
}

/**
 * Extracts a {min, max} ticket price range out of freeform "節目介紹"/"活動
 * 簡介" marketing text — every source except KKTIX puts price in prose, not
 * a structured ticket table (real pages checked 2026-09-18: tixcraft's "🎫
 * 票價：NT$3,380起至NT$7,980"，iNDIEVOX's "票價：...9900元／...3500元"，
 * Ticket Plus's "演出門票｜預售單人$1,000/..."，FANSI GO's fullwidth-decorated
 * "ＡＤＶ．ＮＴ＄５００／ＤＯＯＲ．ＮＴ＄６００" with no label at all).
 *
 * Two tiers, both deliberately conservative — same "don't fabricate a value"
 * spirit as D15's artist matching, so a page with no clean match returns
 * {null,null} rather than guessing:
 *  1. Find a "票價"/"門票" labeled line and pull every $-marked or 元-suffixed
 *     number OUT OF THAT LINE ONLY. Scoping to just the labeled line (not the
 *     whole page) is what keeps an unrelated later line like tixcraft's
 *     "系統服務費200元" from leaking into the result.
 *  2. If no such label exists at all, fall back to keyword-anchored numbers
 *     anywhere in the text (預售/現場/單人/雙人/ADV/DOOR immediately followed
 *     by a number) — looser, but still requires a price-shaped word right
 *     next to the digits, not just any number on the page.
 * A shared-prefix list ("NT$2,990 / 2,690 / 2,490") only catches the one
 * number that actually carries its own $ sign — an accepted under-extraction
 * (price_min may end up a little higher than the true cheapest tier) rather
 * than risking a wrong one.
 */
export function parsePriceFromText(html) {
  if (!html) return { min: null, max: null };
  const plain = normalizeFullwidthAscii(htmlToLines(html));

  const labelMatch = plain.match(PRICE_LABEL_RE);
  if (labelMatch) {
    const numbers = [...stripDiscountTierText(labelMatch[1]).matchAll(CURRENCY_NUMBER_RE)].map((m) =>
      Number((m[1] ?? m[2]).replace(/,/g, ""))
    );
    const fromLabel = priceRangeFromNumbers(numbers);
    if (fromLabel.min != null) return fromLabel;
  }

  const keywordNumbers = [...stripDiscountTierText(plain).matchAll(PRICE_KEYWORD_RE)].map((m) =>
    Number(m[1].replace(/,/g, ""))
  );
  return priceRangeFromNumbers(keywordNumbers);
}

/**
 * "YYYY-MM-DD" for the current date in Taiwan time (UTC+8, no DST) — never
 * compare event dates via `new Date(dateStr) > new Date()`: the pipeline runs
 * in UTC (GitHub Actions, cron "0 0 * * *" = 08:00 Taiwan per D1), so a bare
 * date string parsed as UTC midnight sits ~8h behind the real Taiwan "today",
 * misclassifying every today-dated, sold-out show as already "ended" on
 * every single run. String comparison of two YYYY-MM-DD values is safe and
 * sidesteps timezone math entirely.
 */
function taiwanTodayDateStr() {
  const taiwanNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return taiwanNow.toISOString().slice(0, 10);
}

function statusFromTickets(ticketsRaw, eventDate) {
  const anyOpen = ticketsRaw.some((t) => !t.closed);
  if (anyOpen) return { status: "on_sale", on_sale_at: null };
  if (ticketsRaw.length === 0) return { status: "announced", on_sale_at: null };
  // All tiers closed. Can't distinguish "sold out" from "moved to door sales only" —
  // documented limitation, see SPEC §5.2.
  return { status: eventDate >= taiwanTodayDateStr() ? "sold_out" : "ended", on_sale_at: null };
}

// 拓元/Ticket Plus sell whatever their organizers list, not just music —
// 2026-09-18 review of the real needs-review queue found sports tickets
// (棒球/籃球例行賽), a wrestling promotion, paid courses, a character-brand
// exhibition, an unofficial shuttle-bus "ticket", and even a mooncake
// pre-order sitting there right alongside real gigs. None of these will ever
// gain a matching artists.yml entry (they're not artists), so left alone they
// sit in needs-review forever — Max asked for these to not enter the data at
// all, not just be hidden per-browser via the "忽略" button. Checked BEFORE
// date parsing / artist matching so a malformed date on a noise item never
// even reaches those checks. Curated by hand off observed real titles, same
// style as TYPE_KEYWORDS/CITY_NAMES — expand this list as new noise shapes
// turn up, don't try to make it "smart".
const NOISE_KEYWORDS = [
  // spectator sports (tixcraft/Ticket Plus sell season/single-game tickets)
  "例行賽", "季後", "錦標賽", "主場賽事", "季票",
  "摔角", // wrestling
  "紋身藝術節", // tattoo art festival, not music
  "返鄉專車", // unofficial fan shuttle-bus service riding on a real concert's name
  "蛋黃酥", // a pastry pre-order
  "筋膜刀", "專業技術課程", "詞曲創作教室", // paid courses/workshops, not performances
  "chiikawa", // character-brand exhibition
  "des bishop", // stand-up comedy, not music
  "podcast", // podcast anniversary live shows — spoken word, not music
];

function isNonMusicNoise(titleRaw) {
  const lower = titleRaw.toLowerCase();
  return NOISE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// A handful of FANSI GO raw events come through with a bare "https://" as
// their title — some organizer left the title field empty and the scraper
// picked up a stray link instead. Not fixable data, not worth a "待整理"
// slot either.
function isJunkTitle(titleRaw) {
  return /^https?:\/\/?\s*$/i.test(titleRaw.trim());
}

/**
 * @param {object} rawEvent - shape returned by an adapter's fetch()
 * @param {object[]} artistsYml - loadArtists() result
 * @param {object[]} venuesYml - loadVenues() result (only used for sources
 *   whose listing has no address to derive city from, e.g. tixcraft)
 * @returns {{ event: object }|{ needsReview: object }|{ excluded: object }}
 */
// FANSI GO's date_raw ("2026/09/19", no time) and venue_raw (bare name, no
// address — every event needs the venues.yml fallback) are shaped exactly
// like tixcraft's, so it reuses those parsers rather than duplicating them.
// Ticket Plus's venue_raw ("location / address") is shaped exactly like
// KKTIX's, so it reuses parseKktixVenue via the same default fallback below
// rather than needing its own entry — parseKktixVenue is also the map's
// fallback for any future source_name not listed here.
const DATE_PARSERS = {
  "拓元": parseTixcraftDate,
  "iNDIEVOX": parseIndievoxDate,
  "FANSI GO": parseTixcraftDate,
  "Ticket Plus": parseTicketPlusDate,
};
// 2026-09-21: FANSI GO used to map here too (bare venue name, no address —
// same shape as tixcraft's untracked venues). That assumption was wrong: its
// own detail page (already visited for price) has a real "venue name /
// address" block, so its venue_raw is now KKTIX-shaped and uses the default
// parseKktixVenue fallback below instead — see fansi.mjs's fetchDetail().
const VENUE_PARSERS = { "拓元": parseTixcraftVenue, "iNDIEVOX": parseIndievoxVenue };

export function normalize(rawEvent, artistsYml, venuesYml = []) {
  if (isJunkTitle(rawEvent.title_raw)) {
    return { excluded: { raw_id: rawEvent.raw_id, title_raw: rawEvent.title_raw, reason: "junk_title" } };
  }
  if (isNonMusicNoise(rawEvent.title_raw)) {
    return { excluded: { raw_id: rawEvent.raw_id, title_raw: rawEvent.title_raw, reason: "non_music_noise" } };
  }

  const parseDate = DATE_PARSERS[rawEvent.source_name] ?? parseKktixDate;
  const parseVenue = VENUE_PARSERS[rawEvent.source_name] ?? parseKktixVenue;
  const dateParsed = parseDate(rawEvent.date_raw);
  if (!dateParsed) {
    return {
      needsReview: {
        raw_id: rawEvent.raw_id,
        title_raw: rawEvent.title_raw,
        url: rawEvent.url,
        source: rawEvent.source_name,
        reason: "date_unparseable",
        detail: rawEvent.date_raw,
      },
    };
  }

  // 2026-09-21 (D15 reversal): an unrecognized artist used to block the
  // whole event from events.json — Max pushed back hard on this (an
  // aggregator whose entire point is surfacing shows you don't already know
  // about, requiring you to already know the artist before it'll show up,
  // is backwards). headliners=[] now just means "no per-artist enrichment
  // yet" (blank tags_origin, generic 專場/拼盤 guess below) rather than
  // "invisible" — fetch.mjs still logs it to needs-review.json so it can be
  // looked up and added to artists.yml later, but that's an enrichment
  // backlog now, not a publish gate. See LIVERADAR-SPEC.md §3.2.
  const headliners = matchArtists(rawEvent.title_raw, artistsYml);

  const parsedVenue = parseVenue(rawEvent.venue_raw ?? "", venuesYml);
  const { venue } = parsedVenue;
  // 2026-09-21: last-resort fallback when there's no venue text to work with
  // at all (confirmed real cases: some iNDIEVOX organizers skip the venue
  // field entirely) — the title itself often names the city directly
  // ("EmptyORio ALL THE BEAST 高雄場", "...歐亞巡迴台中場", "...台北聯合演出"),
  // a common convention for disambiguating which city-leg of a tour a given
  // ticket page is for. Only tried when venue_raw is blank (zero other
  // signal to lose by guessing) — never overrides a real venue-derived
  // result, so it can't turn a correctly-resolved city into a wrong one.
  //
  // Second half of the fallback (added same day, X-Formosa 2026 彩虹音樂節):
  // the title doesn't always name a city directly either — sometimes it's a
  // known recurring festival/brand name whose venue is fixed and already in
  // venues.yml (confirmed via the event's own official site, not guessed),
  // so also try matching the title against venues.yml the same way a bare
  // venue name would be.
  const city =
    parsedVenue.city ??
    (rawEvent.venue_raw?.trim()
      ? null
      : (cityFromAddress(rawEvent.title_raw) ?? parseTixcraftVenue(rawEvent.title_raw, venuesYml).city));
  // KKTIX is the only source with a real structured ticket-tier table
  // (tickets_raw); everyone else's price lives in freeform description text
  // (price_text_raw) — see parsePriceFromText's doc comment for the real
  // examples that shaped this. Only fall through to the text parser when
  // there's no ticket table at all, never both.
  const { min, max } = (rawEvent.tickets_raw ?? []).length
    ? priceFromTickets(rawEvent.tickets_raw)
    : parsePriceFromText(rawEvent.price_text_raw ?? "");
  const { status, on_sale_at } = statusFromTickets(rawEvent.tickets_raw ?? [], dateParsed.date);
  // Union across ALL recognized headliners, not just headliners[0] — a
  // multi-artist bill (common now that artists.yml has ~230 entries) can mix
  // origins, and picking only the first-billed act's origin silently dropped
  // the others (found in review, 2026-09-17).
  const originTags = [
    ...new Set(
      headliners
        .map((h) => artistsYml.find((a) => a.canonical === h)?.tags_origin_default)
        .filter(Boolean),
    ),
  ];

  return {
    event: {
      title_raw: rawEvent.title_raw,
      headliners,
      lineup: headliners, // Phase 1: no co-performer parsing beyond alias matches found in the title
      is_festival: rawEvent.title_raw.includes("音樂祭"),
      venue,
      city: city ?? "未知",
      date: dateParsed.date,
      time: dateParsed.time,
      on_sale_at,
      price_min: min,
      price_max: max,
      status,
      tags_type: guessTagsType(rawEvent.title_raw, headliners.length),
      tags_origin: originTags,
      ticket_url: rawEvent.url,
      sources: [{ name: rawEvent.source_name, url: rawEvent.url, raw_id: rawEvent.raw_id }],
      first_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
