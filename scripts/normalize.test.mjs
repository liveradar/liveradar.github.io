import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseIndievoxDate, parseIndievoxVenue, parseTicketPlusDate, parseTixcraftDate, parseKktixVenue, parseTixcraftVenue, loadArtists, matchArtists, parsePriceFromText, guessTagsType, findNameIndex } from "./normalize.mjs";

const artistsYml = [{ canonical: "深海系樂團", aliases: [], tags_origin_default: "本地" }];

function makeRaw(overrides = {}) {
  return {
    raw_id: "a",
    title_raw: "深海系樂團 Live",
    url: "https://example.com/a",
    date_raw: "2026/10/15(周四) 19:30(+0800)",
    venue_raw: "Legacy Taipei / 台北市中正區",
    tickets_raw: [],
    source_name: "KKTIX",
    ...overrides,
  };
}

test("priceFromTickets fix: a closed early-bird tier must not set price_min once a pricier open tier exists", () => {
  const raw = makeRaw({
    tickets_raw: [
      { name: "早鳥", price: 800, closed: true },
      { name: "一般", price: 1200, closed: false },
    ],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.price_min, 1200, "closed tier's lower price must not leak into price_min");
  assert.equal(event.price_max, 1200);
});

test("priceFromTickets: once EVERY tier is closed, fall back to their prices for reference", () => {
  const raw = makeRaw({
    tickets_raw: [
      { name: "早鳥", price: 800, closed: true },
      { name: "一般", price: 1200, closed: true },
    ],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.price_min, 800);
  assert.equal(event.price_max, 1200);
});

test("statusFromTickets fix: a same-day show with all tiers closed is 'sold_out', not 'ended'", () => {
  // Reproduces the exact daily-cron condition: event dated "today" (Taiwan
  // calendar), all tiers closed. Before the fix, new Date(eventDate) parsed
  // as UTC midnight compared as already past.
  const taiwanNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayTaiwan = taiwanNow.toISOString().slice(0, 10);
  const [y, m, d] = todayTaiwan.split("-");

  const raw = makeRaw({
    date_raw: `${y}/${m}/${d}(週日) 20:00(+0800)`,
    tickets_raw: [{ name: "一般", price: 800, closed: true }],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.status, "sold_out");
});

test("statusFromTickets: a clearly past date with closed tiers is 'ended'", () => {
  const raw = makeRaw({
    date_raw: "2020/01/01(週三) 20:00(+0800)",
    tickets_raw: [{ name: "一般", price: 800, closed: true }],
  });
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.status, "ended");
});

test("parseIndievoxDate: prefers the 'start' time over the earlier 'open' (doors) time", () => {
  const result = parseIndievoxDate("2026.09.19 (Sat.) 19:30 open / 20:00 start");
  assert.deepEqual(result, { date: "2026-09-19", time: "20:00" });
});

test("parseIndievoxDate: falls back to whatever single time is present when there's no open/start pair", () => {
  const result = parseIndievoxDate("2026.10.05 (Mon.) 21:00");
  assert.deepEqual(result, { date: "2026-10-05", time: "21:00" });
});

test("parseIndievoxDate: falls back to the listing page's dateless format with time: null", () => {
  const result = parseIndievoxDate("2026/09/18 (五)");
  assert.deepEqual(result, { date: "2026-09-18", time: null });
});

test("parseIndievoxDate: handles spaced slashes ('2026 / 10 / 2')", () => {
  const result = parseIndievoxDate("2026 / 10 / 2（五）");
  assert.equal(result.date, "2026-10-02");
});

test("parseIndievoxDate: handles Chinese-unit dates ('2026年10月3日')", () => {
  const result = parseIndievoxDate("2026年10月3日 (Sat/六)");
  assert.equal(result.date, "2026-10-03");
});

test("parseIndievoxVenue: splits 'VENUE（address）' and derives city from the address", () => {
  const result = parseIndievoxVenue("WESTAR（台北市萬華區西門里漢中街116號8樓）", []);
  assert.deepEqual(result, { venue: "WESTAR", city: "台北" });
});

test("parseIndievoxVenue: a bare venue name with no address falls back to venues.yml", () => {
  const venuesYml = [{ match: "野地方", city: "台北" }];
  const result = parseIndievoxVenue("野地方 Wildlab", venuesYml);
  assert.deepEqual(result, { venue: "野地方 Wildlab", city: "台北" });
});

test("parseIndievoxVenue: an unmapped bare venue name gets city: null, not a thrown error", () => {
  const result = parseIndievoxVenue("某個沒收錄過的展演空間", []);
  assert.deepEqual(result, { venue: "某個沒收錄過的展演空間", city: null });
});

test("parseKktixVenue: recognizes the traditional-character city variants (臺北/臺中/臺南/臺東), not just the common form", () => {
  // Found via a real Ticket Plus run: its address field consistently uses
  // "臺北市"/"臺中市"/"臺南市", not "台北市" — a plain CITY_NAMES.find(startsWith)
  // silently produced city: null for ~40% of promoted events until this was
  // caught. Must still output the common form so the rest of the app only
  // ever sees one spelling.
  assert.equal(parseKktixVenue("臺北大巨蛋 / 臺北市信義區忠孝東路四段515號").city, "台北");
  assert.equal(parseKktixVenue("Legacy Taichung / 臺中市西屯區安和路117號").city, "台中");
  assert.equal(parseKktixVenue("大臺南會展中心 / 臺南市歸仁區歸仁十二路3號").city, "台南");
  assert.equal(parseKktixVenue("The Wall / 台北市文山區羅斯福路四段200號").city, "台北", "common form must still work");
});

test("parseKktixVenue: an address with a postal code AND the country name before the city still resolves (real bug: '116台灣臺北市文山區...' gave city: null)", () => {
  assert.equal(parseKktixVenue("The Wall Live House / 116台灣臺北市文山區萬年里羅斯福路四段200號").city, "台北");
});

test("parseKktixVenue: falls back to venues.yml by venue name when the 'address' has no city at all (real bug: one organizer wrote 'The Wall Live House / The Wall Live House', repeating the venue name as its own address)", () => {
  const venuesYml = [{ match: "The Wall", city: "台北" }];
  const result = parseKktixVenue("The Wall Live House / The Wall Live House", venuesYml);
  assert.deepEqual(result, { venue: "The Wall Live House", city: "台北" });
});

test("parseIndievoxVenue: a 4th real freeform format — venue and address run together with no parentheses at all (real bug: 'Bullet Burger 子彈漢堡 403台灣臺中市西區...' gave city: null)", () => {
  const result = parseIndievoxVenue("Bullet Burger 子彈漢堡 403台灣臺中市西區美村路一段164巷17號1樓", []);
  assert.equal(result.city, "台中");
});

test("parseTixcraftVenue: matches case-insensitively (real bug: the same venue rendered 'The Wall Live House' by one organizer and 'THE WALL表演廳外L形走廊' by another — only a lowercase match catches both against one venues.yml entry)", () => {
  const venuesYml = [{ match: "The Wall", city: "台北" }];
  assert.equal(parseTixcraftVenue("THE WALL表演廳外L形走廊", venuesYml).city, "台北");
  assert.equal(parseTixcraftVenue("the wall live house", venuesYml).city, "台北");
});

test("parseTicketPlusDate: extracts the start date/time from concatenated range strings", () => {
  const result = parseTicketPlusDate("2027-01-09 ~ 2027-01-09 18:00 ~ 18:00");
  assert.deepEqual(result, { date: "2027-01-09", time: "18:00" });
});

test("parseTixcraftDate: no trailing time appended means time: null, same as always (the listing page genuinely never has a time)", () => {
  assert.deepEqual(parseTixcraftDate("2027/05/01 (六)  ~ 2027/05/02 (日) "), { date: "2027-05-01", time: null });
});

test("parseTixcraftDate: extracts an appended trailing time (real bug: the listing page never has a time at all, but tixcraft.mjs's detail page does and now appends it as ' HH:MM' — see its own SHOW_TIME_RE comment)", () => {
  const result = parseTixcraftDate("2027/05/01 (六)  ~ 2027/05/02 (日)  18:45");
  assert.deepEqual(result, { date: "2027-05-01", time: "18:45" });
});

test("normalize() end-to-end for a Ticket Plus raw event (reuses parseKktixVenue — same 'location / address' shape)", () => {
  const raw = {
    raw_id: "abc_session1",
    title_raw: "深海系樂團 Live",
    url: "https://ticketplus.com.tw/activity/abc",
    date_raw: "2026-10-15 ~ 2026-10-15 19:30 ~ 19:30",
    venue_raw: "漢神洲際 8樓天際營地 / 台中市北屯區仁美里崇德路三段865號8F",
    tickets_raw: [],
    source_name: "Ticket Plus",
  };
  const { event } = normalize(raw, artistsYml);
  assert.equal(event.date, "2026-10-15");
  assert.equal(event.time, "19:30");
  assert.equal(event.venue, "漢神洲際 8樓天際營地");
  assert.equal(event.city, "台中");
});

test("normalize() end-to-end for a FANSI GO raw event (reuses tixcraft's date/venue parsers — same bare-name-no-address shape)", () => {
  const raw = {
    raw_id: "100130",
    title_raw: "深海系樂團 Live",
    url: "https://go.fansi.me/events/100130",
    date_raw: "2026/09/19",
    venue_raw: "PIPE Live Music",
    tickets_raw: [],
    source_name: "FANSI GO",
  };
  const venuesYml = [{ match: "PIPE", city: "台北" }];
  const { event } = normalize(raw, artistsYml, venuesYml);
  assert.equal(event.date, "2026-09-19");
  assert.equal(event.time, null);
  assert.equal(event.venue, "PIPE Live Music");
  assert.equal(event.city, "台北");
});

test("normalize() end-to-end for an iNDIEVOX raw event", () => {
  const raw = {
    raw_id: "26_iv04098fa",
    title_raw: "深海系樂團 Live",
    url: "https://www.indievox.com/activity/detail/26_iv04098fa",
    date_raw: "2026.09.19 (Sat.) 19:30 open / 20:00 start",
    venue_raw: "野地方 Wildlab",
    tickets_raw: [],
    source_name: "iNDIEVOX",
  };
  const venuesYml = [{ match: "野地方", city: "台北" }];
  const { event } = normalize(raw, artistsYml, venuesYml);
  assert.equal(event.date, "2026-09-19");
  assert.equal(event.time, "20:00");
  assert.equal(event.venue, "野地方 Wildlab");
  assert.equal(event.city, "台北");
});

test("normalize(): falls back to a city named in the title when venue_raw is completely empty (real bug: some iNDIEVOX organizers skip the venue field entirely, but still write 'XX場'/'XX演出' in the title)", () => {
  const raw = makeRaw({ title_raw: "EmptyORio ALL THE BEAST 高雄場", venue_raw: "", source_name: "iNDIEVOX" });
  const { event } = normalize(raw, [], []);
  assert.equal(event.city, "高雄");
  assert.equal(event.venue, "");
});

test("normalize(): the title fallback also checks venues.yml, not just a literal city name (real bug: X-Formosa 2026 彩虹音樂節's title/venue never mention a city at all — its venue is a known recurring festival brand confirmed via its own official site)", () => {
  const raw = makeRaw({ title_raw: "X-Formosa 2026 彩虹音樂節", venue_raw: "", source_name: "iNDIEVOX" });
  const venuesYml = [{ match: "X-Formosa", city: "新北" }];
  const { event } = normalize(raw, [], venuesYml);
  assert.equal(event.city, "新北");
});

test("normalize(): the title-city fallback never overrides a real venue-derived city, even a null one (a promoter name that just doesn't map to any city must stay 未知-eligible, not get a wrong guess from an unrelated city mentioned in the title)", () => {
  const raw = makeRaw({
    title_raw: "台北場也會辦的活動",
    venue_raw: "某個沒收錄過的展演空間",
    source_name: "拓元",
  });
  const { event } = normalize(raw, [], []);
  assert.equal(event.city, "未知", "non-empty but unmapped venue_raw must not trigger the title fallback");
});

test("matchArtists: headliners are ordered by position in the title, not by artists.yml file order", () => {
  const yml = [
    { canonical: "第二順位", aliases: [], tags_origin_default: "本地" },
    { canonical: "第一順位", aliases: [], tags_origin_default: "歐美" },
  ];
  // "第二順位" is declared first in yml, but "第一順位" appears earlier in the title.
  const headliners = matchArtists("第一順位 x 第二順位 聯合演出", yml);
  assert.deepEqual(headliners, ["第一順位", "第二順位"]);
});

test("normalize(): tags_origin is the union of ALL recognized headliners' origins, not just the first", () => {
  const yml = [
    { canonical: "甲團", aliases: [], tags_origin_default: "本地" },
    { canonical: "乙團", aliases: [], tags_origin_default: "歐美" },
  ];
  const raw = makeRaw({ title_raw: "甲團 x 乙團 聯合演出" });
  const { event } = normalize(raw, yml, []);
  assert.deepEqual(event.tags_origin, ["本地", "歐美"]);
});

test("matchArtists: a pure-Latin canonical requires a word boundary, not a bare substring match", () => {
  const yml = [{ canonical: "FLOW", aliases: [], tags_origin_default: "日韓" }];
  // Real bug found live in production data (2026-09-17): FLOW (a real J-rock
  // band) matched inside LE SSERAFIM's unrelated "PUREFLOW" tour name.
  assert.deepEqual(matchArtists("2026 LE SSERAFIM TOUR 'PUREFLOW' IN TAIPEI", yml), []);
  assert.deepEqual(matchArtists('FLOW WORLD TOUR 2026 "NARUTO THE ROCK" Live in Taipei', yml), ["FLOW"]);
});

test("matchArtists: word-boundary check does not affect CJK/mixed-script names, which still match as plain substrings", () => {
  const yml = [{ canonical: "小球", aliases: [], tags_origin_default: "本地" }];
  assert.deepEqual(matchArtists("莊鵑瑛（小球）Live in 台北", yml), ["小球"]);
});

test("artists.yml has no substring collisions between any two canonical/alias names that matchArtists() would actually mismatch on", () => {
  // Regression guard for the real "IVE"/"LIVE" and "ASCA"/"Patrick Brasca"
  // bugs found in review (2026-09-17): a short or common canonical/alias name
  // that is a substring of another entry's name causes matchArtists() to
  // silently over-match.
  //
  // 2026-09-21: switched from a blind case-insensitive .includes() check to
  // findNameIndex() itself (the actual runtime matcher) — adding "MONO" flagged
  // a false positive against the existing "Monomania偏執狂" entry ("MONO" is a
  // raw substring of it), but findNameIndex's word-boundary rule for pure-Latin
  // names already rejects that match at runtime ("MONO" immediately followed
  // by "mania", no boundary) — the blind substring check couldn't tell a real
  // collision (IVE/LIVE, which IS a boundary-adjacent match) from data that
  // merely looks alarming.
  //
  // 2026-09-21, same day, second refinement: adding "MONO NO AWARE" (a real,
  // distinct band) alongside "MONO" flagged ANOTHER false positive — "MONO"
  // is a boundary-valid match at position 0 of "MONO NO AWARE", same as it
  // would be at position 0 of a real title. But matchArtists() now breaks
  // same-position ties by preferring the longer match (see its own comment),
  // so two entries matching at the exact same starting position (one is an
  // exact word-prefix of the other) is safe — the real, still-dangerous shape
  // is a short name matching at a position OTHER than 0 inside a longer
  // entry's text (IVE at position 1 inside "LIVE", ASCA at position 1 inside
  // "...Brasca") — that's a name buried mid-word/mid-phrase in something
  // unrelated, which the tie-break can't fix because the two entries won't
  // even tie (only one, the wrong one, matches at all in a real title). Only
  // a non-zero match position counts as a real collision here.
  const artistsYml = loadArtists();
  const names = [];
  for (const entry of artistsYml) {
    for (const n of [entry.canonical, ...(entry.aliases ?? [])]) {
      names.push({ canonical: entry.canonical, name: n });
    }
  }
  const collisions = [];
  for (const a of names) {
    for (const b of names) {
      if (a.canonical === b.canonical) continue;
      if (a.name === b.name) continue;
      const idx = findNameIndex(b.name, a.name);
      if (idx !== null && idx > 0) {
        collisions.push(`"${a.name}" (${a.canonical}) would match inside "${b.name}" (${b.canonical}) at position ${idx}`);
      }
    }
  }
  assert.deepEqual(collisions, []);
});

test("matchArtists: two real, distinct artists where one's name is an exact word-prefix of the other's — the longer/more specific match wins (real bug: 'MONO NO AWARE PASSION TOUR 2027' was misattributed to the unrelated band 'MONO')", () => {
  const yml = [
    { canonical: "MONO", aliases: [], tags_origin_default: "日韓" },
    { canonical: "MONO NO AWARE", aliases: [], tags_origin_default: "日韓" },
  ];
  assert.deepEqual(matchArtists("MONO NO AWARE PASSION TOUR 2027 in Taipei", yml), ["MONO NO AWARE"]);
  assert.deepEqual(matchArtists('MONO "Snowdrop" Asia Tour 2026 - TAIPEI', yml), ["MONO"]);
});

test("parsePriceFromText: tixcraft's rich-text price line, numbers wrapped in their own <span>s (also excludes the 身障優惠票/陪同票 discount tier, see the dedicated test below)", () => {
  const html =
    '點：高雄國家體育場<br><br><span><strong>🎫</strong> </span>票價：<span>NT$ 3,380</span>起至 NT$ 7,980及身障優惠票<span> (</span>陪同票) NT$ 2,990 / 2,690 / 2,490，實際票價以當下顯示為準。<br>※ 購買前請注意，本節目每張票券外加系統服務費<span>200</span>元。';
  assert.deepEqual(parsePriceFromText(html), { min: 3380, max: 7980 });
});

test("parsePriceFromText: iNDIEVOX's 元-suffixed multi-tier list, no $ sign at all (also excludes the 愛心席 discount tier)", () => {
  const raw = "Shhh! ALL IN｜三場套票 9900元 / Self! SELECT｜現場票 3500元 / 愛心席 1750元（線上訂購）";
  assert.deepEqual(parsePriceFromText(raw), { min: 3500, max: 9900 });
});

test("parsePriceFromText: Ticket Plus's HTML <p>/<span> info field with a 門票｜ label (also excludes the 身障票 discount tier)", () => {
  const html =
    '<p><span style="font-size:16px"><span>演出門票｜預售單人$1,000/ 預售雙人$1,800/ 現場單人$1,200/ 身障票 $500</span></span></p>';
  assert.deepEqual(parsePriceFromText(html), { min: 1000, max: 1800 });
});

test("parsePriceFromText: FANSI GO's fullwidth decorative text with no 票價/門票 label at all", () => {
  const html = "<p>　  ＡＤＶ．ＮＴ＄５００</p><p> ＤＯＯＲ．ＮＴ＄６００</p>";
  assert.deepEqual(parsePriceFromText(html), { min: 500, max: 600 });
});

test("parsePriceFromText: FANSI GO's plain-colon per-tier labels (no $ sign, no fullwidth)", () => {
  const html = "<p>預售票：600　雙人套票：1000　現場票：700</p>";
  assert.deepEqual(parsePriceFromText(html), { min: 600, max: 1000 });
});

test("parsePriceFromText: no price-shaped text anywhere returns null, not a guess", () => {
  assert.deepEqual(parsePriceFromText("<p>這場活動很棒，敬請期待！</p>"), { min: null, max: null });
  assert.deepEqual(parsePriceFromText(""), { min: null, max: null });
});

test("parsePriceFromText: a 身障票 discount tier never becomes the displayed min price (real bug found by Max: a show with 單人預售票1200/雙人套票2000/現場票1500/身障票600 showed 'NT$600 up' as the headline price — 身障票 is a restricted-eligibility discount, not a price a general visitor can actually get)", () => {
  const raw = "單人預售票 1200 元 / 雙人套票 2000 元 / 現場票 1500 元 / 身障票 600 元（線上購票）";
  assert.deepEqual(parsePriceFromText(raw), { min: 1200, max: 2000 });
});

test("parsePriceFromText: if a discount tier is the ONLY price mentioned, the result is null rather than showing a misleading restricted-eligibility price as if it were generally available", () => {
  assert.deepEqual(parsePriceFromText("票價：身障票 400 元"), { min: null, max: null });
});

test("parsePriceFromText: Ticket Plus's 'TWD' currency prefix (real bug: '票價｜TWD 4,280 | 愛心席 TWD 2,140' returned null entirely — neither 'NT$'/'$' nor '元' matched 'TWD', and the 愛心席 discount tier is excluded too)", () => {
  const raw = "票價｜TWD 4,280 | 愛心席 TWD 2,140 (全區座席)";
  assert.deepEqual(parsePriceFromText(raw), { min: 4280, max: 4280 });
});

test("parsePriceFromText: Ticket Plus's bare 'NT' prefix with no $ sign (real bug: '票價：S區 NT4,000...一般區 NT2,500' returned null — 'NT' alone, no '$', matched nothing)", () => {
  const raw = "票價：S區 NT4,000 (附特典親筆簽名色紙) / 一般區 NT2,500 (全場站席)";
  assert.deepEqual(parsePriceFromText(raw), { min: 2500, max: 4000 });
});

test("parsePriceFromText: a bare, completely unmarked number list after the label (real bug: '票價｜8,500 / 8,000 / ... / 1,500' has no currency symbol on ANY tier — CURRENCY_NUMBER_RE requires at least one marker and found nothing)", () => {
  const raw = "票價｜8,500 / 8,000 / 6,500 / 5,500 / 4,500 / 4,000 / 3,500 / 2,500 / 1,500";
  assert.deepEqual(parsePriceFromText(raw), { min: 1500, max: 8500 });
});

test("normalize(): falls back to parsePriceFromText's price_text_raw when tickets_raw is empty", () => {
  const raw = makeRaw({
    source_name: "拓元",
    venue_raw: "Legacy Taipei / 台北市中正區",
    tickets_raw: [],
    price_text_raw: "票價：NT$800 / NT$1,200",
  });
  const { event } = normalize(raw, artistsYml, []);
  assert.equal(event.price_min, 800);
  assert.equal(event.price_max, 1200);
});

test("normalize(): tags_type recognizes 音樂節 as a festival synonym, not just 音樂祭", () => {
  const yml = [{ canonical: "李芳旭", aliases: [], tags_origin_default: "本地" }];
  const raw = makeRaw({ title_raw: "2026臺北爵士音樂節 感爵夜現場｜李芳旭三重奏" });
  const { event } = normalize(raw, yml, []);
  assert.deepEqual(event.tags_type, ["音樂祭"]);
});

test("normalize(): a branded festival name in the title is tagged 音樂祭 even with a single recognized headliner (real bug: 爛泥發芽10週年 was tagged 專場)", () => {
  const yml = [{ canonical: "爛泥發芽", aliases: [], tags_origin_default: "本地" }];
  const raw = makeRaw({ title_raw: "爛泥發芽10週年" });
  const { event } = normalize(raw, yml, []);
  assert.deepEqual(event.tags_type, ["音樂祭"]);
});

test("normalize(): RUSH BALL and FNC BAND KINGDOM are also recognized festival brands", () => {
  const yml = [{ canonical: "RUSH BALL", aliases: [], tags_origin_default: "日韓" }];
  const raw1 = normalize(makeRaw({ title_raw: "RUSH BALL 2026 in Taipei & Taichung on the ROAD(台北場)" }), yml, []);
  assert.deepEqual(raw1.event.tags_type, ["音樂祭"]);

  const yml2 = [{ canonical: "FNC BAND KINGDOM", aliases: [], tags_origin_default: "日韓" }];
  const raw2 = normalize(makeRaw({ title_raw: "2026 FNC BAND KINGDOM IN TAIPEI（11/7場次）" }), yml2, []);
  assert.deepEqual(raw2.event.tags_type, ["音樂祭"]);
});

test("findNameIndex/matchArtists: an ASCII canonical matches case-insensitively (real bug: 'Punk Strike' in one listing vs 'PUNK STRIKE' in another, same series)", () => {
  const yml = [{ canonical: "Punk Strike", aliases: [], tags_origin_default: "本地" }];
  assert.deepEqual(matchArtists("9.20(日) Punk Strike Warm-Up Party #6", yml), ["Punk Strike"]);
  assert.deepEqual(matchArtists("9.27(日)PUNK STRIKE ： NEXT GENERATION", yml), ["Punk Strike"]);
});

test("guessTagsType: keyword matching is also case-insensitive (real bug: 'TOUR' in an all-caps title didn't match the ['Tour', '巡迴'] entry)", () => {
  assert.deepEqual(guessTagsType("PERSONA LIVE TOUR 2026 - Resonance - 台北公演", 1), ["巡迴"]);
});

test("normalize(): non-music noise (sports tickets, courses, exhibitions, comedy, podcasts) is excluded outright, not sent to needs-review", () => {
  const yml = [];
  const cases = [
    "2026福岡軟銀鷹例行賽門票",
    "2026年第14屆亞洲(U18)青棒錦標賽",
    "2026 摔角兄弟會-高雄場 Wrestling Brotherhood",
    "Feedback Fascial Tools 筋膜刀專業技術課程(台北7/4-7/5)",
    "CHIIKAWA DAYS 台北特展（一般全票）",
    "Des Bishop Live in Taipei",
    "2026 法白 13 週年 LIVE PODCAST SHOW｜建國派對",
  ];
  for (const title_raw of cases) {
    const result = normalize(makeRaw({ title_raw }), yml, []);
    assert.equal(result.excluded?.reason, "non_music_noise", `expected "${title_raw}" to be excluded`);
  }
});

test("normalize(): a bare 'https://' title (a real FANSI GO scrape artifact) is excluded as junk, not sent to needs-review", () => {
  const result = normalize(makeRaw({ title_raw: "https://" }), [], []);
  assert.equal(result.excluded?.reason, "junk_title");
});

test("normalize(): a real music event is not caught by the noise filter just because it shares a word with a noise keyword", () => {
  // 摔角 (wrestling) is noise, but a title merely mentioning "節" or "課" in
  // an unrelated sense must not be excluded — sanity check the filter is
  // keyed on the actual curated phrases, not single loose characters.
  const yml = [{ canonical: "深海系樂團", aliases: [], tags_origin_default: "本地" }];
  const result = normalize(makeRaw({ title_raw: "深海系樂團 音樂節 Live" }), yml, []);
  assert.ok(result.event, "a real festival-titled event must not be excluded");
});

test("normalize() D15 reversal: an unrecognized artist still produces a visible event, not a needsReview block (real bug: Age Factory @ SUB LIVE never appeared on the site at all)", () => {
  const result = normalize(makeRaw({ title_raw: "Age Factory Live in Taipei 2026" }), [], []);
  assert.ok(result.event, "no recognized headliner must not block the event from showing");
  assert.equal(result.needsReview, undefined);
  assert.deepEqual(result.event.headliners, []);
  assert.deepEqual(result.event.lineup, []);
  assert.deepEqual(result.event.tags_origin, [], "no recognized artist means no origin tag, not a guess");
  assert.deepEqual(result.event.tags_type, ["專場"], "guessTagsType still falls back sensibly with 0 headliners");
});
