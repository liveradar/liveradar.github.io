import { test } from "node:test";
import assert from "node:assert/strict";
import { exclusionReason, applyArtistMatch, resolveStoredCity } from "./normalize.mjs";
import { isCacheEntryValid, recordExclusion, skipIdsForSource, MAX_AGE_DAYS } from "./exclusion-cache.mjs";

const DAY = 86400000;
const venuesYml = [
  { match: "河岸留言", city: "台北" },
  { match: "大佳段河濱公園", city: "台北" },
];

test("exclusionReason: 2026-09-30 real spam titles are excluded", () => {
  for (const t of [
    "Find the Best Car Workshop in Abu Dhabi: A 2025 Guide",
    "Understanding the Importance of Wheel Alignment in UAE",
    "Best Affordable Astrologer Online – Acharya Devraj Ji",
    "Cheap CIPD Assignment Help",
    "測試用請勿下單",
    "神達數位企業說明會  9/30 (週三) 12:10 @R1401A",
  ]) {
    assert.equal(exclusionReason({ title_raw: t }), "non_music_noise", t);
  }
});

test("exclusionReason: exact placeholder titles are junk, but a real title merely containing 'test' is not", () => {
  for (const t of ["test", "opentest", "MyTest", " Test "]) assert.equal(exclusionReason({ title_raw: t }), "junk_title", t);
  for (const t of ["TESTSET LIVE IN TAIPEI", "Contest Night", "Protest Songs 之夜"]) {
    assert.equal(exclusionReason({ title_raw: t }), null, t);
  }
});

test("exclusionReason: real performances from the same run are NOT excluded", () => {
  for (const t of [
    "中華民國各界慶祝115年國慶晚會",
    "僑光科技大學 浪潮盛典 62週年校慶演唱會",
    "我知道你不會來我的演唱會#2",
    "TAIPEI:MIX PRESENTS — RUN 2 RAVE: RUN TO THE BUS",
    "LISANI！TAIPEI 2026(雙日)",
  ]) {
    assert.equal(exclusionReason({ title_raw: t, venue_raw: "台北市" }), null, t);
  }
});

test("resolveStoredCity: resolves 未知 from the stored venue via venues.yml", () => {
  assert.equal(resolveStoredCity({ venue: "西門｜河岸留言", title_raw: "x" }, venuesYml), "台北");
  assert.equal(resolveStoredCity({ venue: "基隆河大佳段河濱公園停車場", title_raw: "x" }, venuesYml), "台北");
  assert.equal(resolveStoredCity({ venue: "某個沒登記的場館", title_raw: "高雄場" }, venuesYml), null, "title is only a fallback when venue is blank");
  assert.equal(resolveStoredCity({ venue: "", title_raw: "巡迴 高雄場" }, venuesYml), "高雄");
});

test("applyArtistMatch: fills headliners/tags for an unrecognized event, leaves recognized events alone", () => {
  const artists = [{ canonical: "MIERE", aliases: [], tags_origin_default: "韓國" }];
  const e = { title_raw: "MIERE TAIPEI 1st Special LIVE", headliners: [], lineup: [] };
  assert.equal(applyArtistMatch(e, artists), true);
  assert.deepEqual(e.headliners, ["MIERE"]);
  assert.deepEqual(e.tags_origin, ["韓國"]);

  const known = { title_raw: "MIERE LIVE", headliners: ["別人"], tags_origin: ["本地"] };
  assert.equal(applyArtistMatch(known, artists), false);
  assert.deepEqual(known.tags_origin, ["本地"]);
});

test("applyArtistMatch: a theater event (category set) still gets headliners/tags_origin from a matched troupe name, but keeps its source category as tags_type instead of guessTagsType()'s generic guess", () => {
  const artists = [{ canonical: "MIERE", aliases: [], tags_origin_default: "韓國" }];
  const theater = { title_raw: "MIERE 音樂劇", headliners: [], category: "音樂劇", tags_type: ["音樂劇"] };
  assert.equal(applyArtistMatch(theater, artists), true);
  assert.deepEqual(theater.headliners, ["MIERE"]);
  assert.deepEqual(theater.tags_origin, ["韓國"]);
  assert.deepEqual(theater.tags_type, ["音樂劇"], "tags_type stays the source category, not guessTagsType()'s 專場/拼盤 guess");
});

test("exclusion cache: only noise/outside-Taiwan are cached; test placeholders are never skipped", () => {
  const map = new Map();
  recordExclusion(map, { source: "KKTIX", raw_id: "a", title_raw: "Cheap CIPD Assignment Help", reason: "non_music_noise" });
  recordExclusion(map, { source: "KKTIX", raw_id: "b", title_raw: "X", venue_raw: "Hong Kong", reason: "outside_taiwan" });
  recordExclusion(map, { source: "KKTIX", raw_id: "c", title_raw: "test", reason: "junk_title" });
  assert.deepEqual([...skipIdsForSource(map, "KKTIX")].sort(), ["a", "b"]);
  assert.deepEqual([...skipIdsForSource(map, "拓元")], []);
});

test("exclusion cache: an entry expires after MAX_AGE_DAYS so the page gets re-checked", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  const entry = { title_raw: "Cheap CIPD Assignment Help", checked_at: new Date(now - 2 * DAY).toISOString() };
  assert.equal(isCacheEntryValid(entry, now), true);
  assert.equal(isCacheEntryValid({ ...entry, checked_at: new Date(now - MAX_AGE_DAYS * DAY).toISOString() }, now), false);
});

test("exclusion cache: an entry whose title no longer matches today's rules is NOT skipped (e.g. keyword removed or title edited)", () => {
  const now = Date.now();
  const entry = { title_raw: "某樂團 2026 巡迴演唱會", checked_at: new Date(now - DAY).toISOString() };
  assert.equal(isCacheEntryValid(entry, now), false);
});
