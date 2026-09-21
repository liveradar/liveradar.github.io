import { test } from "node:test";
import assert from "node:assert/strict";
import { computeId, dedupe } from "./dedup.mjs";

function makeEvent(overrides = {}) {
  return {
    title_raw: "Test Event",
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    is_festival: false,
    venue: "Legacy Taipei",
    city: "台北",
    date: "2026-10-15",
    time: "19:30",
    on_sale_at: null,
    price_min: 800,
    price_max: 800,
    status: "on_sale",
    tags_type: ["專場"],
    tags_origin: ["本地"],
    ticket_url: "https://example.com/a",
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
    first_seen_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("computeId is stable for the same headliner/date/venue", () => {
  const id1 = computeId("深海系樂團", "2026-10-15", "Legacy Taipei");
  const id2 = computeId("深海系樂團", "2026-10-15", "Legacy Taipei");
  assert.equal(id1, id2);
});

test("computeId ignores whitespace/case differences (normalization)", () => {
  const id1 = computeId("ABC Band", "2026-10-15", "The Wall");
  const id2 = computeId(" abc band ", "2026-10-15", "the wall");
  assert.equal(id1, id2);
});

test("AC-12: same event from two sources merges into one, keeping both source links", () => {
  const fromKktix = makeEvent({
    sources: [{ name: "KKTIX", url: "https://kktix.example/a", raw_id: "a" }],
    ticket_url: "https://kktix.example/a",
  });
  const fromTixcraft = makeEvent({
    sources: [{ name: "拓元", url: "https://tixcraft.example/b", raw_id: "b" }],
    ticket_url: "https://tixcraft.example/b",
  });

  const result = dedupe([fromKktix, fromTixcraft]);

  assert.equal(result.length, 1, "must collapse to a single event");
  assert.equal(result[0].sources.length, 2, "must keep both original source links (AC-12)");
  // KKTIX has priority 1, 拓元 priority 2 — ticket_url must prefer the higher-priority source.
  assert.equal(result[0].ticket_url, "https://kktix.example/a");
});

test("AC-12 negative: same venue/day, different headliners must NOT merge", () => {
  const earlyShow = makeEvent({
    headliners: ["樂團甲"],
    lineup: ["樂團甲"],
    time: "14:00",
    sources: [{ name: "KKTIX", url: "https://example.com/early", raw_id: "early" }],
  });
  const lateShow = makeEvent({
    headliners: ["樂團乙"],
    lineup: ["樂團乙"],
    time: "20:00",
    sources: [{ name: "KKTIX", url: "https://example.com/late", raw_id: "late" }],
  });

  const result = dedupe([earlyShow, lateShow]);

  assert.equal(result.length, 2, "different headliners on the same day/venue must stay separate");
});

test("AC-12 negative (the real risk, SPEC §4.1): SAME headliner, same venue/day, matinee + evening must NOT merge", () => {
  const matinee = makeEvent({
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    time: "14:00",
    title_raw: "深海系樂團 午場",
    sources: [{ name: "KKTIX", url: "https://example.com/matinee", raw_id: "matinee" }],
  });
  const evening = makeEvent({
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    time: "20:00",
    title_raw: "深海系樂團 晚場",
    sources: [{ name: "KKTIX", url: "https://example.com/evening", raw_id: "evening" }],
  });

  const result = dedupe([matinee, evening]);

  assert.equal(
    result.length,
    2,
    "same artist playing an afternoon AND evening show the same day at the same venue must stay two separate events, not collapse into one"
  );
});

test("dedupe unions lineup, tags_type and tags_origin across merged sources", () => {
  const a = makeEvent({
    lineup: ["深海系樂團", "配角甲"],
    tags_type: ["拼盤"],
    tags_origin: ["本地"],
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
  });
  const b = makeEvent({
    lineup: ["深海系樂團", "配角乙"],
    tags_type: ["拼盤"],
    tags_origin: ["亞洲其他"],
    sources: [{ name: "拓元", url: "https://example.com/b", raw_id: "b" }],
  });

  const [merged] = dedupe([a, b]);

  assert.deepEqual(new Set(merged.lineup), new Set(["深海系樂團", "配角甲", "配角乙"]));
  assert.deepEqual(new Set(merged.tags_origin), new Set(["本地", "亞洲其他"]));
});

test("mergeGroup fix: price_max is merged across sources, not just price_min", () => {
  const fromKktix = makeEvent({
    price_min: 800,
    price_max: 3800,
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
  });
  const fromTixcraft = makeEvent({
    price_min: null,
    price_max: null, // 拓元's listing-only scrape never has price data
    sources: [{ name: "拓元", url: "https://example.com/b", raw_id: "b" }],
  });

  const [merged] = dedupe([fromTixcraft, fromKktix]); // tixcraft processed first

  assert.equal(merged.price_min, 800);
  assert.equal(merged.price_max, 3800, "price_max must pick up KKTIX's value even though it merged second");
});
