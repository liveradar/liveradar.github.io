import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldContinuePaging,
  dedupeProgramsById,
  isKidsProgram,
  classifyCategory,
  timeSaleSignal,
  buildTicketsRaw,
  taiwanMinuteKey,
  parseEventAvailability,
  findAvailability,
  buildRawEvent,
} from "./adapters/opentix.mjs";
import { normalize, loadArtists } from "./normalize.mjs";
import { groupRuns } from "./runs.mjs";

test("shouldContinuePaging real case (戲劇-音樂劇, 48 hits total @ 15/page): pages 1-2 continue, the last page (3 found, nextOffset null) stops", () => {
  assert.equal(shouldContinuePaging({ found: new Array(15), nextOffset: 15 }), true);
  assert.equal(shouldContinuePaging({ found: new Array(15), nextOffset: 30 }), true);
  assert.equal(shouldContinuePaging({ found: new Array(3), nextOffset: null }), false);
});

test("shouldContinuePaging: an empty page stops regardless of nextOffset", () => {
  assert.equal(shouldContinuePaging({ found: [], nextOffset: 15 }), false);
});

test("dedupeProgramsById real case (寶塚OG夢幻舞台 appears in both 戲劇-音樂劇 and 音樂-流行音樂 category queries): kept once", () => {
  const a = { id: "2047993997244669953", title: "寶塚OG夢幻舞台《築夢之橋》" };
  const aAgain = { id: "2047993997244669953", title: "寶塚OG夢幻舞台《築夢之橋》" };
  const b = { id: "999", title: "Other Program" };
  const result = dedupeProgramsById([a, b, aAgain]);
  assert.equal(result.length, 2);
});

test("isKidsProgram real case (新北市生音藝術節- C MUSICAL韓國授權親子音樂劇): 親子-戲劇 alongside a real category is still excluded", () => {
  assert.equal(isKidsProgram(["戲劇-現代戲劇", "親子-戲劇", "戲劇-音樂劇"]), true);
});

test("isKidsProgram: a program with no 親子-* category at all is not a kids program", () => {
  assert.equal(isKidsProgram(["戲劇-音樂劇", "音樂-流行音樂"]), false);
  assert.equal(isKidsProgram(undefined), false);
});

test("classifyCategory real case (寶塚OG夢幻舞台, dual-tagged 戲劇-音樂劇 + 音樂-流行音樂): 音樂劇 wins outright", () => {
  assert.equal(classifyCategory(["戲劇-音樂劇", "音樂-流行音樂"]), "音樂劇");
});

test("classifyCategory: 戲劇-現代戲劇 alone is 舞台劇", () => {
  assert.equal(classifyCategory(["戲劇-現代戲劇"]), "舞台劇");
});

test("classifyCategory: a plain music category (no theater tag at all) is undefined — normal one-session-per-card handling", () => {
  assert.equal(classifyCategory(["音樂-爵士樂"]), undefined);
});

const NOW = Date.parse("2026-09-26T12:00:00+08:00");

test("timeSaleSignal real case (寶塚OG夢幻舞台, 臺中場, checked 2026-09-26): status 0, availability SoldOut -> SOLD_OUT", () => {
  const time = { status: 0, onlineStart: Date.parse("2026-05-13T20:00:00+08:00"), onlineEnd: Date.parse("2026-09-26T00:00:00+08:00") };
  assert.deepEqual(timeSaleSignal(time, "SoldOut", NOW), { sale_signal: "SOLD_OUT", on_sale_at: null });
});

test("timeSaleSignal real case (《鶯鶯》(取消), status 2): cancelled wins outright, even with InStock availability", () => {
  const time = { status: 2, onlineStart: Date.parse("2026-01-01T00:00:00+08:00"), onlineEnd: Date.parse("2026-12-01T00:00:00+08:00") };
  assert.deepEqual(timeSaleSignal(time, "InStock", NOW), { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null });
});

test("timeSaleSignal: status 1 (暫停銷售) also closes sales regardless of availability", () => {
  const time = { status: 1, onlineStart: Date.parse("2026-01-01T00:00:00+08:00"), onlineEnd: null };
  assert.deepEqual(timeSaleSignal(time, "InStock", NOW), { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null });
});

test("timeSaleSignal: status 3/4 (延期/變更演出者) are informational only — sales continue normally", () => {
  const time = { status: 3, onlineStart: Date.parse("2026-01-01T00:00:00+08:00"), onlineEnd: null };
  assert.equal(timeSaleSignal(time, "InStock", NOW).sale_signal, "IN_STOCK");
  const time2 = { status: 4, onlineStart: Date.parse("2026-01-01T00:00:00+08:00"), onlineEnd: null };
  assert.equal(timeSaleSignal(time2, "InStock", NOW).sale_signal, "IN_STOCK");
});

test("timeSaleSignal: before onlineStart is COMING_SOON with that start time as on_sale_at", () => {
  const time = { status: 0, onlineStart: Date.parse("2026-10-01T12:00:00+08:00"), onlineEnd: null };
  assert.deepEqual(timeSaleSignal(time, null, NOW), { sale_signal: "COMING_SOON", on_sale_at: "2026/10/01 12:00" });
});

test("timeSaleSignal: past onlineEnd (registration window closed) is REGISTRATION_CLOSED", () => {
  const time = { status: 0, onlineStart: Date.parse("2026-01-01T00:00:00+08:00"), onlineEnd: Date.parse("2026-09-01T00:00:00+08:00") };
  assert.deepEqual(timeSaleSignal(time, null, NOW), { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null });
});

test("timeSaleSignal: within the sale window, no availability data (event page not fetched/failed), reports IN_STOCK — never silently treated as sold out", () => {
  const time = { status: 0, onlineStart: Date.parse("2026-01-01T00:00:00+08:00"), onlineEnd: Date.parse("2026-12-01T00:00:00+08:00") };
  assert.deepEqual(timeSaleSignal(time, null, NOW), { sale_signal: "IN_STOCK", on_sale_at: null });
});

test("buildTicketsRaw: a normal priced program gets 最低/最高票價 tiers", () => {
  const tickets = buildTicketsRaw({ minPrice: 700, maxPrice: 3500 }, { sale_signal: "IN_STOCK", on_sale_at: null });
  assert.deepEqual(
    tickets.map((t) => [t.name, t.price]),
    [["最低票價", 700], ["最高票價", 3500]],
  );
});

test("buildTicketsRaw: a free program (minPrice/maxPrice both 0) gets one 免費 entry with price null, not 'NT$0 up'", () => {
  const tickets = buildTicketsRaw({ minPrice: 0, maxPrice: 0 }, { sale_signal: "IN_STOCK", on_sale_at: null });
  assert.deepEqual(tickets, [{ name: "免費", price: null, closed: false, waiting: false, on_sale_at_raw: null }]);
});

test("buildTicketsRaw: SOLD_OUT/COMING_SOON signal is reflected as closed/waiting on every tier", () => {
  const soldOut = buildTicketsRaw({ minPrice: 500, maxPrice: 500 }, { sale_signal: "SOLD_OUT", on_sale_at: null });
  assert.equal(soldOut[0].closed, true);
  const comingSoon = buildTicketsRaw({ minPrice: 500, maxPrice: 500 }, { sale_signal: "COMING_SOON", on_sale_at: "2026/10/01 12:00" });
  assert.equal(comingSoon[0].waiting, true);
  assert.equal(comingSoon[0].on_sale_at_raw, "2026/10/01 12:00");
});

test("taiwanMinuteKey: an epoch-ms search-API value and a timezone-less JSON-LD startDate for the SAME real moment produce the identical key", () => {
  // 2026-10-24T14:30:00 Taiwan time == 2026-10-24T06:30:00.000Z
  const epochMs = Date.parse("2026-10-24T06:30:00.000Z");
  assert.equal(taiwanMinuteKey(epochMs), taiwanMinuteKey("2026-10-24T14:30:00"));
  assert.equal(taiwanMinuteKey(epochMs), "2026-10-24 14:30");
});

test("parseEventAvailability real case (寶塚OG夢幻舞台《築夢之橋》event page, 臺中場, checked 2026-09-26): extracts the Event block's startDate/location/availability, skipping the non-Event BreadcrumbList block", () => {
  const html = `
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"Event","name":"寶塚OG夢幻舞台《築夢之橋》","startDate":"2026-09-26T14:30:00","location":{"@type":"Place","name":"丰二三晨露廳","address":{"addressLocality":"臺中市"}},"offers":{"@type":"AggregateOffer","availability":"SoldOut"}}</script>
  `;
  const entries = parseEventAvailability(html);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].minuteKey, "2026-09-26 14:30");
  assert.equal(entries[0].venueName, "丰二三晨露廳");
  assert.equal(entries[0].availability, "SoldOut");
});

test("parseEventAvailability: a malformed JSON-LD block is skipped, not thrown", () => {
  const html = `<script type="application/ld+json">{not valid json</script><script type="application/ld+json">{"@type":"Event","startDate":"2026-01-01T00:00:00","location":{"name":"X"},"offers":{"availability":"InStock"}}</script>`;
  const entries = parseEventAvailability(html);
  assert.equal(entries.length, 1);
});

test("findAvailability: matches by (start time to the minute, venue name), NOT by array position — two real programs 2026-09-25 had a different session count between the search API and the event page's JSON-LD", () => {
  const entries = [
    { minuteKey: "2026-10-24 14:30", venueName: "臺北市藝文推廣處城市舞台", availability: "InStock" },
    { minuteKey: "2026-10-25 14:30", venueName: "臺北市藝文推廣處城市舞台", availability: "SoldOut" },
  ];
  const secondSessionStartMs = Date.parse("2026-10-25T06:30:00.000Z"); // 14:30 Taiwan time
  assert.equal(findAvailability(entries, secondSessionStartMs, "臺北市藝文推廣處城市舞台"), "SoldOut");
});

test("findAvailability: no match (event page fetch was skipped, or genuinely absent) returns null, not throwing or defaulting to a wrong signal", () => {
  assert.equal(findAvailability([], Date.now(), "Some Venue"), null);
});

test("buildRawEvent: a theater program gets category + run_key (keyed on program id + venue name, no date)", () => {
  const program = { id: "2067174521020350465", title: "果陀劇場《Crash, Boom Boom Love!》演唱會音樂劇" };
  const venue = { name: "臺北市藝文推廣處城市舞台", city: "臺北" };
  const time = { start: Date.parse("2026-10-24T06:30:00.000Z"), minPrice: 500, maxPrice: 3500 };
  const raw = buildRawEvent(program, venue, time, "音樂劇", { sale_signal: "IN_STOCK", on_sale_at: null });
  assert.equal(raw.category, "音樂劇");
  assert.equal(raw.run_key, "opentix:2067174521020350465:臺北市藝文推廣處城市舞台");
  assert.equal(raw.raw_id, `2067174521020350465_${time.start}`);
  assert.equal(raw.venue_raw, "臺北市藝文推廣處城市舞台 / 臺北");
  assert.equal(raw.date_raw, "2026-10-24 14:30");
});

test("buildRawEvent: a plain music program has neither category nor run_key at all (not undefined-valued, genuinely absent)", () => {
  const program = { id: "123", title: "A Jazz Concert" };
  const venue = { name: "Some Hall", city: "臺北" };
  const time = { start: Date.now(), minPrice: 800, maxPrice: 800 };
  const raw = buildRawEvent(program, venue, time, undefined, { sale_signal: "IN_STOCK", on_sale_at: null });
  assert.equal("category" in raw, false);
  assert.equal("run_key" in raw, false);
});

test("normalize()+groupRuns() end-to-end (PLAN-3-opentix.md, real shape: 《神隱少女》舞台劇 with 3 sessions in ONE venue, 1 in another): same-venue sessions merge into ONE run card, the other venue stays a separate card", () => {
  const artistsYml = loadArtists();
  const program = { id: "opentix-shinkai-test", title: "《神隱少女》舞台劇" };
  const taipeiVenue = { name: "臺北表演藝術中心", city: "臺北" };
  const kaohsiungVenue = { name: "高雄文化中心", city: "高雄" };
  const signal = { sale_signal: "IN_STOCK", on_sale_at: null };
  const rawEvents = [
    buildRawEvent(program, taipeiVenue, { start: Date.parse("2026-10-24T06:30:00.000Z"), minPrice: 700, maxPrice: 3500 }, "舞台劇", signal),
    buildRawEvent(program, taipeiVenue, { start: Date.parse("2026-10-25T06:30:00.000Z"), minPrice: 700, maxPrice: 3500 }, "舞台劇", signal),
    buildRawEvent(program, taipeiVenue, { start: Date.parse("2026-10-31T06:30:00.000Z"), minPrice: 700, maxPrice: 3500 }, "舞台劇", signal),
    buildRawEvent(program, kaohsiungVenue, { start: Date.parse("2026-11-07T06:30:00.000Z"), minPrice: 700, maxPrice: 3500 }, "舞台劇", signal),
  ];
  const normalized = rawEvents.map((raw) => normalize(raw, artistsYml).event);
  const runs = groupRuns(normalized, "2026-09-26");

  assert.equal(runs.length, 2, "one card per venue, not per session");
  const taipeiRun = runs.find((r) => r.venue === "臺北表演藝術中心");
  const kaohsiungRun = runs.find((r) => r.venue === "高雄文化中心");
  assert.equal(taipeiRun.sessions.length, 3);
  assert.equal(taipeiRun.city, "台北");
  assert.equal(kaohsiungRun.sessions.length, 1);
  assert.equal(kaohsiungRun.city, "高雄");
  assert.notEqual(taipeiRun.id, kaohsiungRun.id);
});
