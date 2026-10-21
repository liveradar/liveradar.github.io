import { eventDates } from "./runs.js";

/**
 * The single implementation of the visibility decision tree (SPEC §6 / SRS §6.3).
 * Every page imports this instead of re-deriving visibility itself — that's what
 * keeps FR-33 (favorites always win) and FR-44 (exclude rules persist) correct
 * everywhere at once.
 *
 * Order matters and must not be reordered:
 * ended -> favorited (short-circuits the exclude rules below, but NOT the view
 * filters — see the 2026-09-21 note) -> single-event exclude -> artist -> type
 * -> keyword -> view filters (city/month/price).
 *
 * 2026-09-21 real bug (Max): FR-33's original decision tree (SRS §6.3) had the
 * favorited short-circuit skip the view-filter check too, so a favorited 台北
 * show still appeared while the city chip was set to 新北 — confusing, since
 * the whole point of picking a city chip is to see only that city. FR-33's own
 * wording only ever promised favorites win over "排除規則" (the PERMANENT
 * exclude rules: blocked artist/type/keyword/single-event), never over the
 * TEMPORARY view filters (city/month/type/origin/price chips) — those are a
 * different mechanism (`viewFilters`, not `prefs.excluded_*`). Favorites still
 * unconditionally win over every exclude rule below; they just also have to
 * pass the view filters like anything else now.
 */

/**
 * @param {object} event - normalized Event (SPEC §3.1)
 * @param {object} prefs - UserPrefs (SPEC §3.3)
 * @param {object} [viewFilters] - { city?: string, month?: string, favoritesOnly?: boolean, priceMax?: number }
 * @returns {{ bucket: "ended"|"show"|"hidden"|"filtered", pinned?: boolean, reason?: string }}
 */
export function resolveVisibility(event, prefs, viewFilters = {}) {
  if (isPast(event.date)) {
    return { bucket: "ended" };
  }

  if (prefs.favorites.includes(event.id)) {
    return passesViewFilters(event, viewFilters) ? { bucket: "show", pinned: true } : { bucket: "filtered" };
  }

  if (prefs.excluded_events.includes(event.id)) {
    return { bucket: "hidden", reason: "event" };
  }

  if (event.headliners.some((a) => prefs.excluded_artists.includes(a))) {
    return { bucket: "hidden", reason: "artist" };
  }

  if (event.tags_type.some((t) => prefs.excluded_types.includes(t))) {
    return { bucket: "hidden", reason: "type" };
  }

  if (!passesViewFilters(event, viewFilters)) {
    return { bucket: "filtered" };
  }

  return { bucket: "show" };
}

/** Exported so state.js's hidden-rule counters can apply the same "future only" rule. */
// 2026-10-16 (Max: 音樂表演和舞台劇分開成不同頁面): every event belongs to
// exactly one top-level tab. 喜劇 wins over 劇場 so a comedy show that also
// got tagged 舞台劇 lands where comedy fans look; everything not stage or
// comedy (專場/拼盤/音樂祭/見面會/古典/untagged) is music.
export const SECTIONS = [
  { id: "music", label: "音樂" },
  { id: "theater", label: "劇場" },
  { id: "comedy", label: "喜劇" },
];

export function sectionOf(event) {
  const types = event.tags_type ?? [];
  if (types.includes("喜劇")) return "comedy";
  if (types.includes("舞台劇") || types.includes("音樂劇")) return "theater";
  return "music";
}

export function isPast(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // "T00:00:00" forces local-time parsing, matching format.js's splitDate/daysUntil —
  // a bare "YYYY-MM-DD" parses as UTC midnight instead, which for viewers at or
  // behind UTC can make a same-day event compare as already past.
  return new Date(dateStr + "T00:00:00") < today;
}

// 2026-09-26 (Max: "地區：台北新北放在一起改叫雙北"): 台北/新北 are shown and
// filtered as one combined "雙北" bucket — the two cities are functionally
// one commute area for a gig-goer, and were previously two separate chip
// options a user had to pick between even though most venues near the
// border serve both. cityMatches() below is the one place that needs to
// know about this grouping; event.city itself is left as the raw scraped
// city (台北/新北), nothing about storage or rendering changes.
export const DOUBLE_BEI_CITIES = new Set(["台北", "新北"]);

export function cityBucket(city) {
  return DOUBLE_BEI_CITIES.has(city) ? "雙北" : city;
}

// 2026-10-15 (Max: 想用場館篩選，如大巨蛋、小巨蛋): the same venue is scraped
// under several spellings ("台北小巨蛋" / "臺北小巨蛋" / "台北小巨蛋 Taipei
// Arena", "The Wall Live House" / "THE WALL LIVE HOUSE"). venueKey() folds the
// harmless differences (台/臺, case, spaces, a trailing English name after a
// Chinese one) so the venue filter shows each place once; event.venue itself
// is left as scraped.
// Same-venue spellings the generic folding below can't catch (a Chinese
// suffix, a city prefix). Only add pairs that are certainly one place.
const VENUE_ALIASES = {
  "legacytaipei傳音樂展演空": "legacytaipei",
  "legacytaipei音樂展演空間": "legacytaipei",
  "legacytaichung傳音樂展演空間": "legacytaichung",
  "legacytaichung音樂展演空間": "legacytaichung",
  "legacytera音樂展演空間": "legacytera",
  "moondogtaipei": "moondog",
  "westartaipei": "westar",
  "台北westar": "westar",
  "西門westar": "westar",
  // 2026-10-15: same-place spellings found by scanning events.json for keys
  // that are a prefix of another. Separate halls of one building (LIVE
  // WAREHOUSE 大庫/小庫, 西門紅樓二樓劇場, 台北國際會議中心大會堂, 群島藝術園區
  // 大劇院…) are deliberately NOT folded — they're different rooms.
  "高雄livewarehouse": "livewarehouse",
  "高雄livewarehouse小庫": "livewarehouse小庫",
  "clapperstudio展演廳(三創生活)": "clapperstudio",
  "迴響音樂展演空間soundlivehouse": "迴響音樂展演空間",
  "百樂門": "百樂門酒館",
  "sub": "sublive",
  "台北國際會議中心ticc": "台北國際會議中心",
  "台北國際會議中心(ticc)": "台北國際會議中心",
  "ticc台北國際會議中心": "台北國際會議中心",
  "台北國際會議中心大會堂(ticc)": "台北國際會議中心大會堂",
  "ticc台北國際會議中心大會堂": "台北國際會議中心大會堂",
  "高雄國家體育場(世運主場館)": "高雄國家體育場",
  "cornerhouse角落文創展演空間": "cornerhouse",
  "pipelivemusic派譜音樂空間": "pipelivemusic",
  "杰克音樂jackstudio": "杰克音樂",
  "cornermax大角落多功能展演館": "cornermax",
  "國立體育大學綜合體育館(林口體育館)": "國立體育大學綜合體育館",
  "nuzone展演空間": "nuzone",
  "典空間codespace": "典空間",
  "revolver左輪手槍": "revolver", // Revolver / REVOLVER / Revolver 左輪手槍
  "左輪酒吧": "revolver", // "Revolver Taipei [左輪酒吧]" in a venue-crawl listing
  "thewallnostage": "thewalllivehouse",
  "thewallnostage,no_____": "thewalllivehouse", // "No Stage, No_____" is Rhythm Rebels' series name at The Wall, not a separate venue
  "西門紅樓theredhouse二樓劇場": "西門紅樓二樓劇場",
  // "三創生活園區 Clapper Studio": the trailing-English rule strips it to just "三創生活園區".
  "三創生活園區": "clapperstudio",
  "台北三創生活園區": "clapperstudio",
  "三創clapperstudio": "clapperstudio",
  "高雄百樂門酒館": "百樂門酒館",
  "twothreecomedyclub23喜劇俱樂部": "二三喜劇",
};

export function venueKey(venue) {
  // NFKC: full-width ＋／Ａ／（ → + / A / ( ("Comedy Plus 卡米地＋" vs "COMEDY PLUS 卡米地+").
  const v = (venue ?? "").normalize("NFKC").replace(/[・·‧•]/g, "").replace(/臺/g, "台").toLowerCase().trim();
  // A bare city prefix ("台北 The Wall Live House") is not the venue name — stripping the Latin part would leave just "台北".
  const cjkThenLatin = v.match(/^(.*[\u4e00-\u9fff])\s+[a-z0-9 .'&-]+$/);
  if (cjkThenLatin && /^(台北|新北|桃園|新竹|台中|台南|高雄|基隆)$/.test(cjkThenLatin[1])) return venueKey(v.slice(cjkThenLatin[1].length));
  const key = (cjkThenLatin ? cjkThenLatin[1] : v).replace(/\s+/g, "");
  return VENUE_ALIASES[key] ?? key;
}

/**
 * 2026-10-21 (Max: 場館篩選出現「THE WALL LIVE HOUSE、PIPE LIVE MUSIC」這種選項):
 * one listing can name several venues in one field — a two-venue festival
 * ("A、B") or a venue crawl ("A & B"). Treated as ONE venue it became its own
 * filter option and matched neither real venue. Split on 、 / " & " / ＆ so the
 * event is found under each venue it is actually at. "Name [中文名]" keys on
 * the bracketed name (the one the other spellings use). A single-venue string
 * returns just [venueKey(venue)].
 */
export function venueKeys(venue) {
  const parts = String(venue ?? "").split(/\s*[、＆]\s*|\s+&\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [venueKey(venue)];
  return [...new Set(parts.map((p) => venueKey(p.match(/\[([^\]]+)\]/)?.[1] ?? p)))];
}

/** Display names for venueKeys(): one name per key, in the same order (multi-venue strings give each part's own text). */
export function venueNames(venue) {
  const parts = String(venue ?? "").split(/\s*[、＆]\s*|\s+&\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [String(venue ?? "")];
  const byKey = new Map();
  for (const p of parts) byKey.set(venueKey(p.match(/\[([^\]]+)\]/)?.[1] ?? p), p);
  return [...byKey.values()];
}

function cityMatches(eventCity, filterValue) {
  return filterValue === "雙北" ? DOUBLE_BEI_CITIES.has(eventCity) : eventCity === filterValue;
}

// 2026-09-26 (Max: "每個篩選器可以多選"): every view filter accepts either a
// single value (old shape, kept working so already-saved localStorage state
// and the single-select call sites below don't need a migration) or an
// array of values — an event passes a given filter if it matches ANY value
// in the array (OR within one filter; the different filters — city vs.
// month vs. type — still AND together, unchanged).
function toValues(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function passesViewFilters(event, viewFilters) {
  const cities = toValues(viewFilters.city);
  if (cities.length > 0 && !cities.some((c) => cityMatches(event.city, c))) return false;
  // A theater run (PLAN-1-theater-runs.md) spans several months of sessions —
  // event.date alone is only the NEXT upcoming one, so picking October must
  // still surface a run whose next show is in September but has an October
  // date too. eventDates() is just [event.date] for a non-run event.
  const months = toValues(viewFilters.month);
  if (months.length > 0 && !months.some((m) => eventDates(event).some((d) => d.startsWith(m)))) return false;
  const venues = toValues(viewFilters.venue);
  if (venues.length > 0 && !venueKeys(event.venue).some((k) => venues.includes(k))) return false;
  const types = toValues(viewFilters.type);
  if (types.length > 0 && !types.some((t) => event.tags_type.includes(t))) return false;
  const origins = toValues(viewFilters.origin);
  if (origins.length > 0 && !origins.some((o) => event.tags_origin.includes(o))) return false;
  if (viewFilters.favoritesOnly) return false; // handled by caller pre-filtering favorites list
  const priceMaxes = toValues(viewFilters.priceMax);
  if (priceMaxes.length > 0 && event.price_min != null && !priceMaxes.some((p) => event.price_min <= p)) {
    return false;
  }
  return true;
}

/**
 * Partition a list of events into what should render vs. what's hidden,
 * plus a count of how many are hidden by rules (for the footer bar, FR-47).
 * "filtered" (view filters) is intentionally excluded from the hidden count
 * per SRS §6.3 — only rule-based hiding counts there.
 */
export function partitionEvents(events, prefs, viewFilters = {}) {
  const visible = [];
  const ended = [];
  let hiddenByRules = 0;

  for (const event of events) {
    const result = resolveVisibility(event, prefs, viewFilters);
    if (result.bucket === "show") {
      visible.push({ event, pinned: !!result.pinned });
    } else if (result.bucket === "ended") {
      ended.push(event);
    } else if (result.bucket === "hidden") {
      hiddenByRules += 1;
    }
    // "filtered" -> not shown, not counted
  }

  return { visible, ended, hiddenByRules };
}
