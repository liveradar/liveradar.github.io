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
 *
 * 2026-09-23 real bug (NELL's own Taipei show, title styled as
 * "<𝗢𝗡𝗟𝗬 𝗢𝗡𝗘> 𝗡𝗘𝗟𝗟 𝗟𝗜𝗩𝗘 𝗜𝗡 𝗧𝗔𝗜𝗣𝗘𝗜" — a "fancy text generator" style
 * organizers paste into KKTIX titles for visual flair): those look like
 * plain Latin letters but are actually distinct Unicode Mathematical
 * Alphanumeric Symbols codepoints (U+1D400 block, Sans-Serif Bold in this
 * case), so a literal string search for canonical "NELL" against the raw
 * title never matched at all — the artist WAS registered, this wasn't a
 * missing-artist gap. `.normalize("NFKC")` is the general fix (not a
 * one-off alias for this one title): Unicode defines these styled
 * codepoints as compatibility equivalents of the plain ASCII letters
 * specifically so normalization can fold them back, and it's
 * length-preserving here (confirmed: same character count in and out), so
 * every position/word-boundary check below still lines up correctly against
 * the normalized string.
 */
export function matchArtists(titleRaw, artistsYml) {
  titleRaw = titleRaw.normalize("NFKC");
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
// 2026-09-25 real bug (Max 回報, 找 city:未知 清單時發現: TECHNO BUS 的
// venue_raw 是純地址「台中市南屯區五權西路三段1巷59-1號」，完全沒有用
// "/" 隔開場地名跟地址): 沒有 "/" 時整串文字會被當成 venuePart，
// addressPart 預設是空字串——cityFromAddress("") 一定找不到城市，而
// venuePart（其實是地址本身）從來沒被拿去檢查過，直接卡在 venues.yml
// 查表這個對「地址文字」不會有結果的分支，city 永遠是 null。加一個
// fallback：addressPart 找不到城市時，再試著把 venuePart 本身當地址檢查
// 一次（它有可能就是地址），venues.yml 查表留在最後，維持「地址文字比
// 對優先於場地名稱查表」的既有順序。
export function parseKktixVenue(venueRaw, venuesYml = []) {
  const [venuePart, addressPart = ""] = venueRaw.split("/").map((s) => s.trim());
  const city = cityFromAddress(addressPart) ?? cityFromAddress(venuePart) ?? parseTixcraftVenue(venuePart, venuesYml).city;
  return { venue: venuePart, city };
}

/**
 * "2027/05/01 (六)  ~ 2027/05/02 (日) " or "2026/12/10 (四)" -> { date, time: null }
 *
 * 2026-09-21 real bug (Max: "很多時間或票價沒有上"): the listing page's date
 * field never has a time at all — confirmed genuinely absent there, not a
 * parsing miss — but tixcraft.mjs's detail page (already visited for price)
 * has the real show time in a "📅 時間：YYYY/MM/DD(day) HH:MM" line, which
 * nothing was ever extracting. tixcraft.mjs appends that time to date_raw as
 * " HH:MM" when found (see its own comment), so this just needs to look for
 * an optional trailing time here — kept optional/appended rather than baked
 * into the adapter's own date_raw shape change, so a raw string with no time
 * found still parses exactly as before.
 */
export function parseTixcraftDate(dateRaw) {
  const m = dateRaw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const timeMatch = dateRaw.match(/(\d{1,2}:\d{2})\s*$/);
  return { date: `${y}-${mo}-${d}`, time: timeMatch ? timeMatch[1].padStart(5, "0") : null };
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
  // 2026-09-22 real bug: some organizers write the time with a fullwidth
  // colon ("晚上19：00") — same family of bug as PRICE_LABEL_RE's fullwidth-
  // pipe miss (2026-09-21 above), a halfwidth-only regex silently drops it.
  const startMatch = dateRaw.match(/(\d{1,2})[:：](\d{2})\s*start/i);
  const anyTimeMatch = dateRaw.match(/(\d{1,2})[:：](\d{2})/);
  const timeMatch = startMatch ?? anyTimeMatch;
  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : null;
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

// 2026-09-22 real bug (Max, FANSI GO 950003: "票價｜預售單人$𝟱𝟬𝟬"): a
// DIFFERENT decorative digit style than fullwidth — Unicode "Mathematical
// Alphanumeric Symbols" (bold/double-struck/sans-serif/sans-serif-bold/
// monospace digits, U+1D7CE-U+1D7FF), a separate block from the fullwidth
// ASCII one above and not covered by that shift. All five digit styles in
// this block are laid out as five consecutive runs of 0-9, so one shared
// formula (offset mod 10) covers all of them without needing to know which
// style is in use.
function normalizeMathDigits(text) {
  return text.replace(/[\u{1D7CE}-\u{1D7FF}]/gu, (ch) => String((ch.codePointAt(0) - 0x1d7ce) % 10));
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

// 2026-09-21 real bug, found chasing a *different* report (Max: "很多票價沒
// 上"): normalizeFullwidthAscii() runs on `plain` BEFORE this regex ever sees
// it, and converts "｜" (fullwidth pipe, U+FF5C — the separator basically
// every source uses: "票價｜"/"門票｜"/"地點｜"/"日期｜") into a plain "|" —
// but this character class only listed the fullwidth form, so it silently
// matched nothing whenever the label-scoped path was the only route to the
// price (no 預售/現場/單人/雙人/etc. keyword for PRICE_KEYWORD_RE's fallback
// to catch by accident instead). Existing tests using "｜" happened to still
// pass because their price text ALSO had a fallback keyword sitting right
// next to the numbers — the label match itself was silently broken the whole
// time, just invisibly, until a bare unmarked list ("Ticket Plus's
// 票價｜8,500/8,000/…" test) had nothing else to fall back on.
// 2026-09-22 real bug: an iNDIEVOX organizer (26_iv04219b4) pads the label
// with fullwidth spaces for visual alignment — "票　　價｜" — \s in a JS regex
// already matches U+3000 (ideographic space), so "票\s*價" is enough, no new
// character class needed.
// 2026-09-22 real bug (Max, FANSI GO 690007): "票務：優先入場1500元...一般入場
// 700元" — a genuinely different label word, not a typo/spacing variant of
// 票價/門票.
// 2026-09-22 real bug (Ticket Plus, 風間俊介 KAZAMA SHUNSUKE event): "【票價
// 資訊】全區座位｜NTD 3,680" — filler text ("資訊") between the label and the
// actual separator, same shape as iNDIEVOX's "票價資訊 Ticket Price：" gap fix
// (scripts/adapters/indievox.mjs) but this one lives in the SHARED parser, so
// every source benefits from widening it once here instead of per-adapter.
const PRICE_LABEL_RE = /(?:票\s*價|門\s*票|票務)[^\n｜:：]{0,10}[：｜|:]\s*([^\n]{1,200})/;
// 2026-09-21 real bug (Max): Ticket Plus writes currency as "TWD 4,280" or
// "NT4,000" (no $ sign at all) about as often as "NT$"/"$" — neither matched
// this regex, silently losing the price on every such event. Added both as
// alternative prefixes.
const CURRENCY_NUMBER_RE = /(?:NT\$|NT|TWD|\$)\s*([\d,]+)|([\d,]+)\s*元/g;
// 2026-09-21 real bug (Max, same investigation): some Ticket Plus events list
// a bare, unmarked number list after the label with no currency symbol on
// ANY tier at all ("票價｜8,500 / 8,000 / ... / 1,500") — CURRENCY_NUMBER_RE
// requires at least one marker per number and finds nothing here. Only used
// as a fallback within an already-confirmed "票價/門票" labeled line (never
// on the whole page), so trusting bare numbers here doesn't risk picking up
// an unrelated number the way it would in PRICE_KEYWORD_RE's page-wide scan.
const BARE_NUMBER_LIST_RE = /[\d,]{2,}/g;
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
// 2026-09-22 real bug (Ticket Plus, 風間俊介 KAZAMA SHUNSUKE event): the price
// label sometimes sits ALONE on its own line as a bracketed section header
// ("【票價資訊】", nothing after it) with the actual tiers on SEPARATE
// following lines that don't contain "票價"/"門票" themselves at all
// ("全區座位｜NTD 3,680" / "身障區｜NTD 1,840") — PRICE_LABEL_RE's same-line
// capture group comes back empty. Same shape as iNDIEVOX's "票價 :" own-line
// case (scripts/adapters/indievox.mjs's extractLabeledField), generalized
// here so every source gets it, not just iNDIEVOX's own adapter code.
function labelBlockText(plain) {
  const labelMatch = plain.match(PRICE_LABEL_RE);
  if (labelMatch && labelMatch[1].trim()) return labelMatch[1];

  const lines = plain.split("\n");
  const headerRe = /(?:票\s*價|門\s*票|票務)/;
  for (let i = 0; i < lines.length; i++) {
    if (!headerRe.test(lines[i])) continue;
    const rest = lines
      .slice(i + 1, i + 6)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (rest) return rest;
  }
  return null;
}

export function parsePriceFromText(html) {
  if (!html) return { min: null, max: null };
  const plain = normalizeMathDigits(normalizeFullwidthAscii(htmlToLines(html)));

  const labelText = labelBlockText(plain);
  if (labelText) {
    const stripped = stripDiscountTierText(labelText);
    const numbers = [...stripped.matchAll(CURRENCY_NUMBER_RE)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, "")));
    const fromLabel = priceRangeFromNumbers(numbers);
    if (fromLabel.min != null) return fromLabel;

    // No currency-marked number found anywhere in the labeled line — some
    // Ticket Plus events list a bare "8,500 / 8,000 / ... / 1,500" with no
    // currency symbol on ANY tier. Safe to trust bare numbers here (unlike
    // PRICE_KEYWORD_RE's whole-page scan) since this text is already scoped
    // to a confirmed "票價/門票" label, not just any digits on the page.
    const bareNumbers = [...stripped.matchAll(BARE_NUMBER_LIST_RE)].map((m) => Number(m[0].replace(/,/g, "")));
    const fromBare = priceRangeFromNumbers(bareNumbers);
    if (fromBare.min != null) return fromBare;
  }

  const keywordNumbers = [...stripDiscountTierText(plain).matchAll(PRICE_KEYWORD_RE)].map((m) =>
    Number(m[1].replace(/,/g, ""))
  );
  const fromKeyword = priceRangeFromNumbers(keywordNumbers);
  if (fromKeyword.min != null) return fromKeyword;

  // 2026-09-22 real bug (Max, FANSI GO: "沒有什麼ampm 你讀html的文字" — a real
  // page, go.fansi.me/events/140015, defeated BOTH tiers above at once):
  // tier names ("ᴀᴅᴠ"/"ᴅᴏᴏʀ"/"ꜱɪɴɢʟᴇ ᴛɪᴄᴋᴇᴛ") are typed in Unicode small-caps
  // styling (U+1D00 range, "Phonetic Extensions"), not the plain ASCII
  // letters /adv|door/i matches — PRICE_KEYWORD_RE's keywords never fire.
  // The tier NAME and its NT$ price also sit several characters or even a
  // whole line apart ("NTD $1100" trails "・單人票 ꜱɪɴɢʟᴇ ᴛɪᴄᴋᴇᴛ　　　　"), past
  // PRICE_KEYWORD_RE's 8-char proximity window even where the keyword text
  // does match. Last-resort tier: trust any bare $-marked number anywhere in
  // the page when NEITHER a label NOR a proximity keyword matched anything —
  // requiring the $ sign itself (not just any digit) keeps this conservative,
  // same reasoning BARE_NUMBER_LIST_RE uses within an already-confirmed label.
  const dollarNumbers = [...stripDiscountTierText(plain).matchAll(/\$\s*([\d,]+)/g)].map((m) =>
    Number(m[1].replace(/,/g, ""))
  );
  return priceRangeFromNumbers(dollarNumbers);
}

// 2026-09-22 (Max: "有一些表演目前是尚未開賣，可以加售票時間"): the same
// freeform description block already fetched for price almost always also
// states when tickets go on sale — real examples seen today: iNDIEVOX
// "售票時間：2026/08/22（六）12:00 開始販售", "開賣時間：2026 年 09 月 15 日
// （二）16:00"; tixcraft "開放售票：7月22日（三）中午12點"; Ticket Plus
// "起售時間｜2026年10月10日 13:00". No new fetch needed — every non-KKTIX
// source already passes this whole block as price_text_raw (see the D15-era
// comment above statusFromTickets's call site).
// Caught myself almost reintroducing the 2026-09-21 fullwidth-pipe bug here:
// normalizeFullwidthAscii() runs before this ever matches and converts "｜"
// to halfwidth "|" — the separator class needs BOTH, same as PRICE_LABEL_RE.
const ON_SALE_LABEL_RE = /(?:開賣|起售|開放售票|售票)[^｜:：|\n]{0,10}[｜:：|]\s*([^\n]{1,60})/;

export function parseOnSaleAt(html) {
  if (!html) return null;
  const plain = normalizeMathDigits(normalizeFullwidthAscii(htmlToLines(html)));
  const m = plain.match(ON_SALE_LABEL_RE);
  if (!m) return null;
  const raw = m[1];

  // Only the full "YYYY/MM/DD" or "YYYY年MM月DD日" forms are trusted — a
  // no-year "7月22日" is genuinely ambiguous (which year?) and, in practice,
  // only shows up for a sale that already started (organizers writing a
  // FUTURE on-sale date always include the year, since ambiguity there would
  // actually confuse buyers) — exactly the case the caller doesn't need a
  // date for anyway, since formatOnSaleCountdown() only renders something
  // when the date is still ahead of today.
  const dateMatch =
    raw.match(/(\d{4})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{1,2})/) ??
    raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!dateMatch) return null;
  const [, y, mo, d] = dateMatch;
  const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;

  const timeMatch = raw.match(/(\d{1,2})[:：](\d{2})/);
  const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "00:00";

  return `${date}T${time}:00+08:00`;
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
export function taiwanTodayDateStr() {
  const taiwanNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return taiwanNow.toISOString().slice(0, 10);
}

// "2026/11/13 12:00(+0800)" (KKTIX's own `.timezoneSuffix` text) -> ISO with
// the Taiwan offset, same shape parseOnSaleAt() produces from freeform text.
function parseKktixTimestamp(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:00+08:00`;
}

function statusFromTickets(ticketsRaw, eventDate, registerStatus) {
  // 2026-09-23 real bug (Max: 藤井風 10/31 高雄場已售完卻仍顯示 on_sale) —
  // some KKTIX event pages (confirmed: kklivetw/atc-twn large-venue org
  // pages) never render ANY `.status` marker in the ticket table's static
  // HTML, even once every tier is genuinely sold out; the table's rows all
  // come through with `closed: false, waiting: false`, which the check
  // below reads as "open". `registerStatus` is kktix.mjs's own real-time
  // inventory check (register_info endpoint) — authoritative over whatever
  // the ticket table does or doesn't show, checked first and short-circuits
  // the table-based inference entirely when it says sales are over.
  if (registerStatus === "SOLD_OUT" || registerStatus === "REGISTRATION_CLOSED") {
    return { status: eventDate >= taiwanTodayDateStr() ? "sold_out" : "ended", on_sale_at: null };
  }
  // 2026-09-24: a KKTIX group page (see kktix.mjs resolveFromChildEvents) has
  // no ticket table of its own, so the table-based inference below would call
  // it "announced" even when its child events are selling right now.
  if (registerStatus === "IN_STOCK") return { status: "on_sale", on_sale_at: null };
  // 2026-09-22 real bug (Max, EIR AOI): a ticket row can be "waiting" (尚未
  // 開賣, sale hasn't started) — that's neither "closed" (sale over) nor
  // truly "open" (buyable right now). The old `!t.closed` check treated
  // "waiting" as open. See kktix.mjs's fetchEventDetail for where `waiting`/
  // `on_sale_at_raw` come from.
  const anyOpen = ticketsRaw.some((t) => !t.closed && !t.waiting);
  if (anyOpen) return { status: "on_sale", on_sale_at: null };
  const waitingTickets = ticketsRaw.filter((t) => t.waiting);
  if (waitingTickets.length > 0) {
    // Earliest sale-start across tiers (a VIP tier often opens later than
    // general admission) — the soonest date is what a countdown should show.
    const onSaleDates = waitingTickets.map((t) => parseKktixTimestamp(t.on_sale_at_raw)).filter(Boolean).sort();
    return { status: "announced", on_sale_at: onSaleDates[0] ?? null };
  }
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
  "紙博", // "紙博 in 台北" — Japanese paper-goods/stationery fair, not a concert (2026-09-22, verified via ticketplus.com.tw event page)
  // 2026-09-22, KKTIX's sitewide category-browse turned up a batch of these —
  // one-on-one lessons/consultations and lecture-style "sit and learn about
  // jazz" salons, not performances (all verified via their own KKTIX pages):
  "音創學院", "歌唱體驗課", "音樂診療室", "音樂解密沙龍", "一杯咖啡聽我彈爵士吉他",
  "秋冬系列講座", // a baroque-music lecture series, not a concert
  "音響大展", // a hi-fi/audio-equipment trade show
  "流行音樂互動展", // an exhibition/interactive display, not a live performance
  // 2026-09-23, KKTIX category-browse expanded to 演唱會(1)/音樂會(6) tags
  // turned up a new batch — verified each via its own KKTIX page:
  "教育補助券", // a government subsidy-coupon giveaway page, not an event
  "場地租借", // venue-rental listing ads (KKTIX doubles as a booking/CRM tool for meeting spaces), not performances
  "歌唱選秀大賞", // a singing-competition/talent-contest show, not a specific artist's gig
  "校園音樂藝術交流晚會", // a student-association campus variety night (anti-drug/anti-bullying awareness programming, unnamed performers) — not a touring artist's show. NOISE_KEYWORDS is a plain substring match (see isNonMusicNoise below), not a regex — this must be the literal phrase, not a wildcard pattern
  "洛基恐怖秀", // Rocky Horror Picture Show fan-run screenings with live shadowcast actors — a movie-screening/cosplay event, not a music concert, despite the source material being a "rock musical"
  "百靈果", // 百靈果 News is a podcast brand; this is a live podcast blind-dating show, spoken word not music (same category as the existing "podcast" keyword, kept separate because this title doesn't contain the English word)
  "康康SHOW", // 康康's stand-up comedy show, same category as "des bishop" above
  // 2026-09-24 batch (手動補跑排程當天發現，見 HANDOFF）：
  "投資心法", // a financial-professor investment seminar (FANSI GO), not a performance
  "尾牙同樂會", // a corporate year-end banquet listing (Ticket Plus), not a public concert
  // 2026-09-25, KKTIX Strategy 4 (untagged/其他 sitewide listing, added to
  // catch events like iri's own show that carry no category tag at all):
  // the same untagged bucket also surfaces SEO/content-marketing spam
  // accounts abusing KKTIX's free event-page creation for search indexing —
  // confirmed real examples: "Affordable SEO Services for Small Businesses:
  // A Complete Guide to Growing Locally and Online", "Invisalign Parramatta"
  // (a dental clinic's own landing page, not an event). These aren't a
  // curated, closed list the way the phrases above are — expect to keep
  // adding to this as new ones turn up, same as every other NOISE_KEYWORDS
  // batch. Kept lowercase since isNonMusicNoise() already lowercases both
  // sides for the comparison.
  "seo services", "seo company", "generative engine optimization", "invisalign",
  "dental clinic", "car recovery", "auto repair", "numerologist",
];

function isNonMusicNoise(titleRaw) {
  const lower = titleRaw.toLowerCase();
  return NOISE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// 2026-09-22 (KKTIX's new sitewide category-browse strategy, see kktix.mjs's
// Strategy 3): once discovery isn't scoped to a known-Taiwan org/venue list
// anymore, a real fraction of what turns up is the SAME artist's Hong Kong/
// Macau/Shenzhen tour date, not a Taipei one — many orgs run both cities'
// listings off one KKTIX account. Checked via `venue_raw` specifically (the
// listing's own structured venue/address field), not the title or
// description — a title can legitimately mention "世界巡迴" and other cities
// in passing without this listing itself being one of them, but venue_raw is
// exactly where THIS listing's own location lives, so matching there is safe
// the same way sale_status_text's narrow scope makes SOLD_OUT_TEXT_RE safe.
// This is a structural, geography-based filter, not a per-artist exclude —
// keeps working for artists never seen before, unlike naming each one.
// 九龍/新界: Hong Kong addresses commonly name the district (Kowloon/New
// Territories) without ever spelling out "香港"/"Hong Kong" in full — real
// case: a PORTAL (The Burrow) venue_raw said only "九龍新蒲崗彩虹道...".
// Whampoa/MacPherson/West Kowloon: specific HK venue names seen repeatedly
// across the batch that found this whole problem (TIDES, 麥花臣場館, AXA
// WONDERLAND WestK) — their addresses don't name a country OR a district
// keyword above at all, just a street name, so there's no way to generalize
// further than listing the ones actually observed; expect to keep adding to
// this list as new HK venues turn up the same way, same spirit as
// NOISE_KEYWORDS above.
// 2026-09-23: 西九/AXA WONDERLAND/AXA安盛創夢館 added — found via the JSON-LD
// switch (see kktix.mjs's extractJsonLdEvent), which finally surfaced real
// venue text for events that used to fail date/venue extraction entirely
// (Simple Plan/my little airport/U-KNOW's Hong Kong dates) — "WestK" alone
// doesn't spell out "Kowloon" so the existing West?Kowloon pattern missed
// it, and 西九 (the common Chinese abbreviation for 西九龍/West Kowloon) is
// a separate written form from 九龍 itself.
// 2026-09-23 (KKTIX category-browse batch surfaced 讚美之泉敬拜讚美節慶's own
// Tokyo dates — venue_raw was the literal English address "...Shinjuku City,
// Tokyo 169-0074, Japan"): this whole regex had never covered Japan at all,
// only HK/Macau/Shenzhen/Malaysia — a real coverage gap, not just a missing
// venue name. Added Tokyo/Japan/日本/東京 plus 大阪/Osaka and 名古屋/Nagoya
// (both already seen in real cross-border tour announcements this session,
// e.g. Atarayo's own tour — same reasoning as adding a city the moment it's
// confirmed real, not waiting for every possible Japanese city to surface
// on its own first).
// 2026-09-25 real bug (Max 回報，found while chasing an unrelated city:未知
// investigation): 麥花臣場館/AsiaWorld-Expo were only ever named in THIS
// comment block's own history notes above, never actually added to the
// regex itself — Yuki Kajiura's and YUURI's Hong Kong shows were genuinely
// live on the production site with city:未知, not caught by anything.
const OUTSIDE_TAIWAN_VENUE_RE =
  /香港|Hong ?Kong|九龍|西九|新界|澳門|Macau|深圳|Shenzhen|馬來西亞|Malaysia|檳城|Penang|Whampoa|MacPherson|West ?Kowloon|WestK|The Burrow|Choi Hung|AXA ?WONDERLAND|安盛創夢館|AXA ?Dreamland|麥花臣|MacPherson ?Stadium|亞洲國際博覽館|AsiaWorld[- ]?Expo|日本|東京|Tokyo|大阪|Osaka|名古屋|Nagoya|Japan|首爾|Seoul|KDB ?生命/i; // 首爾/KDB 生命塔 added 2026-09-24: 黃致列簽名會 was sold in TWD to Taiwan fans but held in Seoul

function isOutsideTaiwanVenue(venueRaw) {
  return OUTSIDE_TAIWAN_VENUE_RE.test(venueRaw ?? "");
}

// A handful of FANSI GO raw events come through with a bare "https://" as
// their title — some organizer left the title field empty and the scraper
// picked up a stray link instead. Not fixable data, not worth a "待整理"
// slot either.
function isJunkTitle(titleRaw) {
  return /^https?:\/\/?\s*$/i.test(titleRaw.trim());
}

// 2026-09-23 (KKTIX category-browse batch surfaced two entries with a blank
// title_raw: kktix.kktix.cc/events/virtualevent and .../virtualvenue-copy-1
// — confirmed by opening both that they're KKTIX's OWN demo/showcase pages
// for their "virtual event" product feature, hosted under the platform's
// own "kktix" org account, not real user-submitted events). Checking the
// org subdomain specifically (not just "title is blank") is deliberate: a
// genuinely real event with a blank title would be a real scraping bug
// worth seeing, not something to silently swallow under a generic
// "empty title = junk" rule.
const KKTIX_OWN_DEMO_ORG_RE = /^https?:\/\/kktix\.kktix\.cc\//i;
function isPlatformOwnDemoEvent(url) {
  return KKTIX_OWN_DEMO_ORG_RE.test(url ?? "");
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
  // Billboard Live's date_raw is built the same "YYYY-MM-DD HH:MM" shape as
  // Ticket Plus's (see billboard.mjs's toTaiwanDateTimeDash), so it reuses
  // the same parser rather than needing its own.
  "Billboard Live": parseTicketPlusDate,
};
// 2026-09-21: FANSI GO used to map here too (bare venue name, no address —
// same shape as tixcraft's untracked venues). That assumption was wrong: its
// own detail page (already visited for price) has a real "venue name /
// address" block, so its venue_raw is now KKTIX-shaped and uses the default
// parseKktixVenue fallback below instead — see fansi.mjs's fetchDetail().
const VENUE_PARSERS = { "拓元": parseTixcraftVenue, "iNDIEVOX": parseIndievoxVenue };

// 2026-09-22 real bug (Max, 音田雅則: "需登記抽選這個 有些是全部票券都要抽選
// 有些是一般買票不用登記抽選 是VIP PASS 加購才要登記抽選 這種特殊就不用管
// 了 需登記抽選的標籤只適用於全部票券都要抽選的"): dedup.mjs's original
// is_lottery — "true if ANY merged Ticket Plus listing's title mentions
// 登記抽選/VIP PASS" — over-flagged. Real case: 音田雅則 has 4 merged Ticket
// Plus listings; the plain one (correctly chosen as the card's own
// title/link) explicitly offers unconditional general sale ("一般票券開售｜
// 2026/07/08"), and its ONLY "登記抽選" mentions are scoped to a separate VIP
// PASS addon ("VIP PASS 加購登記抽選"). A sibling listing happens to also
// exist for the VIP-only lottery — merging that in and flagging the whole
// card was wrong, since clicking through goes to the plain listing where no
// lottery is needed. Contrast with MAHIRU (the original report this feature
// was built for): its own plain listing's sale-time section lists "登記抽選"
// as the FIRST phase for the regular ticket price itself, with general sale
// only "視情況" (conditionally) happening after — genuinely no guaranteed
// non-lottery path. The real distinguishing signal was never "does ANY
// listing mention 登記抽選" — it's "does the listing that ACTUALLY WINS as
// this card's title/link require it". Scoped to that one listing's own
// title + price text; "VIP" anywhere close to a 登記抽選 mention means that
// specific mention is addon-scoped, not about the base ticket.
// Two separate patterns, not one shared `/g` regex reused across both a
// `.test()` call and an `.exec()` loop — a global regex's `.lastIndex` is
// stateful across calls on the SAME object, and this one is module-scoped
// (reused on every invocation). Caught this the hard way: a title-only test
// case failed depending on which OTHER test happened to run immediately
// before it in the same process, because an earlier call's `.test()` had
// left `.lastIndex` pointing partway through the string.
const GENERAL_LOTTERY_TITLE_RE = /登記抽選|抽選登記/;
// 2026-09-22 real bug, found immediately after shipping a first attempt at
// this that checked "is 登記抽選 near the word VIP": a real 音田雅則 page has a
// LATER, unrelated section — entry-verification instructions for overseas
// participants — that happens to say "...核對與登記抽選資料相同之護照..."
// with no "VIP"/"加購" anywhere near it, even though it's still clearly
// talking about the same VIP-only lottery discussed earlier. Proximity to
// one specific mention isn't reliable prose parsing. More robust: look for
// an UNCONDITIONAL general-sale statement instead — "一般票券開售｜.../一般
// 販售：..." with no hedge ("視...情況"/"可能不實施"/etc) nearby. If the text
// confirms regular tickets go on sale on a firm date, nothing else on the
// page (VIP addon lottery, ID-check footnotes mentioning it in passing)
// changes that a buyer never HAS to enter a lottery. MAHIRU's real text is
// the contrasting case: "一般販售：2026年5月27日...※視主辦單位票券販售情況，
// 將有不實施一般販售之可能" — explicitly hedged, so no confirmed non-lottery
// path exists.
const GENERAL_SALE_RE = /一般(?:票券)?(?:開售|發售|開賣|販售|售票)/;
const GENERAL_SALE_HEDGE_RE = /視.{0,10}情況|視.{0,10}而定|可能不|不(?:一定|保證)?實施|恐不開放|視售況/;
export function isGeneralTicketLottery(titleRaw, priceTextRaw) {
  if (/VIP/i.test(titleRaw)) return false; // this listing IS the VIP-scoped variant
  if (GENERAL_LOTTERY_TITLE_RE.test(titleRaw)) return true; // e.g. "...登記抽選" with no VIP qualifier in the title itself
  const plain = (priceTextRaw ?? "").replace(/<[^>]+>/g, "");
  const generalSaleIdx = plain.search(GENERAL_SALE_RE);
  if (generalSaleIdx !== -1 && !GENERAL_SALE_HEDGE_RE.test(plain.slice(generalSaleIdx, generalSaleIdx + 150))) {
    return false; // confirmed unconditional general sale — no lottery required
  }
  let match;
  const bodyRe = /登記抽選|抽選登記/g;
  while ((match = bodyRe.exec(plain))) {
    const contextBefore = plain.slice(Math.max(0, match.index - 20), match.index);
    if (!/VIP|加購/i.test(contextBefore)) return true;
  }
  return false;
}

export function normalize(rawEvent, artistsYml, venuesYml = []) {
  if (isJunkTitle(rawEvent.title_raw)) {
    return { excluded: { raw_id: rawEvent.raw_id, title_raw: rawEvent.title_raw, reason: "junk_title" } };
  }
  if (isNonMusicNoise(rawEvent.title_raw)) {
    return { excluded: { raw_id: rawEvent.raw_id, title_raw: rawEvent.title_raw, reason: "non_music_noise" } };
  }
  if (isPlatformOwnDemoEvent(rawEvent.url)) {
    return { excluded: { raw_id: rawEvent.raw_id, title_raw: rawEvent.title_raw, reason: "platform_demo_content" } };
  }
  if (isOutsideTaiwanVenue(rawEvent.venue_raw)) {
    return { excluded: { raw_id: rawEvent.raw_id, title_raw: rawEvent.title_raw, reason: "outside_taiwan" } };
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
  let { status, on_sale_at } = statusFromTickets(rawEvent.tickets_raw ?? [], dateParsed.date, rawEvent.register_status);
  // 2026-09-22 real bug (Max: "尚未開賣標籤你是不是亂給啊 明明有超多早就已經
  // 開賣了"): statusFromTickets()'s "announced" branch fires whenever
  // tickets_raw is empty — but only KKTIX ever populates tickets_raw at all
  // (FANSI GO/iNDIEVOX/tixcraft/Ticket Plus all pass `[]` unconditionally,
  // they have no structured open/closed ticket-tier data to scrape). That
  // made EVERY event from those four sources report "announced" regardless
  // of whether it's actually on sale — a real gap that sat silent (the only
  // visible effect used to be a subtle CTA-label difference) until today's
  // new 尚未開賣 badge made it loudly, visibly wrong on nearly every card.
  // Fix: for these sources, only trust "announced" when there's POSITIVE
  // evidence — a parsed on_sale_at date that's genuinely still ahead of
  // today. No such evidence just means "we don't know the ticket-tier
  // state", and a listed event with a working ticket link is overwhelmingly
  // more likely to already be on sale than not — default to that instead.
  // Scoped to non-KKTIX sources specifically (rather than "any empty
  // tickets_raw"): a real KKTIX event CAN legitimately have an empty
  // tickets_raw because its ticket table genuinely isn't published yet, and
  // that IS trustworthy "announced" evidence for KKTIX — it just isn't for a
  // source that never had ticket-tier data to begin with.
  //
  // 2026-09-25: Billboard Live is a second exception, but the opposite
  // shape — it DOES have real structured tickets_raw (see billboard.mjs),
  // so an "announced" it correctly derived from a waiting/COMING_SOON ticket
  // tier must not be blindly overridden the way an evidence-free non-KKTIX
  // "announced" should be. The actual condition this whole block exists for
  // is "no structured ticket-tier data to trust", not "not KKTIX" — checking
  // tickets_raw.length directly says that correctly for any current or
  // future source, Billboard Live included.
  if (status === "announced" && rawEvent.source_name !== "KKTIX" && (rawEvent.tickets_raw ?? []).length === 0) {
    // 2026-09-22 (Max: "這點在其他平台也都要確認...如果沒有api或是結構化資料
    // 可以確定狀態，那可以從文字內容確認吧"): Ticket Plus's own event page
    // (client-rendered, not in its JSON API at all) shows "銷售一空"/"售完"/
    // "完售"/"售罄" for a sold-out session and "登記截止" when a lottery-
    // signup listing's registration window has closed — see ticketplus.mjs's
    // fetchSaleStatusMap. Checked BEFORE the on_sale_at/default-to-on_sale
    // logic below: a sold-out or registration-closed session is neither
    // "announced" nor genuinely "on_sale", it's over.
    // tixcraft's own real purchase page (checked after Max caught that
    // "沒有可用訊號" was wrong — see fetchTicketStatusText's doc comment)
    // uses "選購一空" instead of "銷售一空" for the same idea.
    // 2026-09-22 real bug (Max, real report: 岡崎體育10週年巡演 shown as
    // on_sale when the artist announced an indefinite hiatus and the show
    // was fully cancelled): Ticket Plus showed "銷售截止" ("sales closed"),
    // a status string this regex didn't have in its exact-phrase list — a
    // cancelled show's page collapses to a single row whose name is the
    // event's own title rather than a per-session label, but the row and
    // its status text ARE still scraped correctly by fetchSaleStatusMap;
    // the regex here just never recognized what it found.
    //
    // 2026-09-22, same day, Max's follow-up pushback after that fix landed
    // ("不要因為沒把「銷售截止」列進已知的六種同義詞就忽略，你可以自己判斷
    // 詞彙意思吧，我覺得這個不能當藉口"): fair — an exact-phrase whitelist
    // just moves the same failure to the next unseen phrase a platform
    // happens to word slightly differently, and "add one more literal
    // string when someone notices" isn't a real fix. Rewritten as a
    // structural pattern instead: any of 銷售/選購/販售/售票/登記 (the verbs
    // this project has actually seen platforms use for "buying/signing up")
    // followed by 一空/截止/結束 (endings that all mean the window is
    // closed, however it's phrased), plus the handful of standalone
    // sold-out compounds (售完/完售/售罄/停售) that don't fit that
    // verb+ending shape. This is still string matching, not real language
    // understanding — sale_status_text is scraped from a narrow, dedicated
    // status UI element (not free-form prose), which is what makes a
    // broader pattern safe here without needing to read surrounding
    // context to avoid false positives.
    const SOLD_OUT_TEXT_RE = /(?:銷售|選購|販售|售票|登記)(?:一空|截止|結束)|售完|完售|售罄|停售|截止/; // bare 截止 added 2026-09-24: a tixcraft row's own text is "YYYY/MM/DD HH:MM 截止", see sale-signal.mjs
    if (SOLD_OUT_TEXT_RE.test(rawEvent.sale_status_text ?? "")) {
      status = dateParsed.date >= taiwanTodayDateStr() ? "sold_out" : "ended";
    } else {
      const parsedOnSaleAt = parseOnSaleAt(rawEvent.price_text_raw ?? "");
      if (parsedOnSaleAt && parsedOnSaleAt.slice(0, 10) > taiwanTodayDateStr()) {
        on_sale_at = parsedOnSaleAt;
      } else {
        status = "on_sale";
      }
    }
  }
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
      // 2026-09-26 (PLAN-1-theater-runs.md): a source that already classified
      // this listing as 音樂劇/舞台劇 (OPENTIX's own category, 寬宏/年代's own
      // category id, ...) wins outright — guessTagsType()'s keyword guessing
      // (e.g. a title containing "巡演" landing on 巡迴) is a fallback for
      // sources with no real category of their own, not something that
      // should second-guess a source's explicit classification.
      tags_type: rawEvent.category ? [rawEvent.category] : guessTagsType(rawEvent.title_raw, headliners.length),
      tags_origin: originTags,
      is_lottery: isGeneralTicketLottery(rawEvent.title_raw, rawEvent.price_text_raw ?? ""),
      ticket_url: rawEvent.url,
      sources: [{ name: rawEvent.source_name, url: rawEvent.url, raw_id: rawEvent.raw_id }],
      first_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Only present for a theater/musical listing — see scripts/runs.mjs's
      // groupRuns(), which merges every event sharing the same run_key
      // (same production, same venue) into one many-sessions card instead of
      // one card per performance.
      ...(rawEvent.category ? { category: rawEvent.category } : {}),
      ...(rawEvent.run_key ? { run_key: rawEvent.run_key } : {}),
    },
  };
}
