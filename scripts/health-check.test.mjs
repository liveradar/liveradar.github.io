import { test } from "node:test";
import assert from "node:assert/strict";
import { isUpcoming, findUnknownCity, findEmptyVenue, findMissingPrice, findMissingHeadliner, findLikelyDuplicates } from "./health-check.mjs";

function makeEvent(overrides = {}) {
  return {
    id: "a",
    title_raw: "Test Event",
    headliners: ["Test Artist"],
    date: "2026-10-15",
    time: "19:30",
    venue: "Legacy Taipei",
    city: "台北",
    status: "on_sale",
    price_min: 1000,
    price_max: 1000,
    sources: [{ name: "KKTIX" }],
    ...overrides,
  };
}

const TODAY = "2026-09-26";

test("isUpcoming: an ordinary event uses its own date", () => {
  assert.equal(isUpcoming(makeEvent({ date: "2026-09-25" }), TODAY), false);
  assert.equal(isUpcoming(makeEvent({ date: "2026-09-26" }), TODAY), true);
});

test("isUpcoming: a theater run (date_end set) stays upcoming until its LAST session, not its next one", () => {
  assert.equal(isUpcoming(makeEvent({ date: "2026-09-01", date_end: "2026-09-30" }), TODAY), true);
  assert.equal(isUpcoming(makeEvent({ date: "2026-09-01", date_end: "2026-09-20" }), TODAY), false);
});

test("findUnknownCity: only city 未知 is flagged", () => {
  const unknown = makeEvent({ id: "u", city: "未知" });
  const known = makeEvent({ id: "k", city: "台北" });
  assert.deepEqual(findUnknownCity([unknown, known]), [unknown]);
});

// 2026-09-26 real case (囪擊音樂祭 group-hub duplicate, before it was cleaned up).
test("findEmptyVenue: an empty string venue is flagged, a real one is not", () => {
  const empty = makeEvent({ id: "e", venue: "" });
  const real = makeEvent({ id: "r", venue: "十鼓文創園區-夢糖劇場" });
  assert.deepEqual(findEmptyVenue([empty, real]), [empty]);
});

test("findMissingPrice: on_sale/sold_out with no price at all is flagged, announced (not on sale yet) is not", () => {
  const missing = makeEvent({ id: "m", status: "on_sale", price_min: null, price_max: null });
  const soldOutMissing = makeEvent({ id: "s", status: "sold_out", price_min: null, price_max: null });
  const announced = makeEvent({ id: "a", status: "announced", price_min: null, price_max: null });
  const priced = makeEvent({ id: "p", status: "on_sale", price_min: 500, price_max: 500 });

  const flagged = findMissingPrice([missing, soldOutMissing, announced, priced]);
  assert.deepEqual(flagged.map((e) => e.id).sort(), ["m", "s"]);
});

test("findMissingHeadliner: no recognized headliner is flagged, EXCEPT a theater/musical run (category set) whose title names a show, not a performer", () => {
  const noHeadliner = makeEvent({ id: "n", headliners: [] });
  const run = makeEvent({ id: "r", headliners: [], category: "音樂劇" });
  const normal = makeEvent({ id: "o", headliners: ["Someone"] });

  assert.deepEqual(findMissingHeadliner([noHeadliner, run, normal]), [noHeadliner]);
});

// 2026-09-26 real case: the 花澤香菜/囪擊音樂祭 KKTIX group-hub bugs were
// exactly this shape — same date+time+venue, two different ids, never
// merged by dedup.mjs's headliner-based computeId().
test("findLikelyDuplicates: same date+time+venue under two different ids is flagged as one group", () => {
  const hub = makeEvent({ id: "hub", title_raw: "2026 囪擊音樂祭", venue: "十鼓文創園區-夢糖劇場", date: "2026-10-24", time: "11:00" });
  const real = makeEvent({ id: "real", title_raw: "【10/24】2026 囪擊音樂祭", venue: "十鼓文創園區-夢糖劇場", date: "2026-10-24", time: "11:00" });
  const unrelated = makeEvent({ id: "other", venue: "Legacy Taipei", date: "2026-11-01", time: "19:00" });

  const groups = findLikelyDuplicates([hub, real, unrelated]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((e) => e.id).sort(), ["hub", "real"]);
});

test("findLikelyDuplicates: venue name is compared case/whitespace-insensitively but NOT fuzzy — a genuinely different venue never groups", () => {
  const a = makeEvent({ id: "a", venue: " Legacy Taipei ", date: "2026-10-01", time: "19:00" });
  const b = makeEvent({ id: "b", venue: "legacy taipei", date: "2026-10-01", time: "19:00" });
  const different = makeEvent({ id: "c", venue: "Legacy Taichung", date: "2026-10-01", time: "19:00" });

  const groups = findLikelyDuplicates([a, b, different]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((e) => e.id).sort(), ["a", "b"]);
});

test("findLikelyDuplicates: events missing a date or venue are never grouped (nothing meaningful to compare)", () => {
  const noVenue = makeEvent({ id: "x", venue: "" });
  const noVenue2 = makeEvent({ id: "y", venue: "" });
  assert.deepEqual(findLikelyDuplicates([noVenue, noVenue2]), []);
});
