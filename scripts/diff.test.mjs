import { test } from "node:test";
import assert from "node:assert/strict";
import { diff } from "./diff.mjs";

function makeEvent(id, overrides = {}) {
  return {
    id,
    merged_ids: [id],
    title_raw: "Test",
    headliners: ["Test Artist"],
    lineup: ["Test Artist"],
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
    ticket_url: "https://example.com/" + id,
    sources: [{ name: "KKTIX", url: "https://example.com/" + id, raw_id: id }],
    first_seen_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("a genuinely new event lands in added_ids and keeps its fresh first_seen_at", () => {
  const previous = [];
  const next = [makeEvent("a", { first_seen_at: "2026-09-15T08:00:00Z", updated_at: "2026-09-15T08:00:00Z" })];

  const { events, digest } = diff(previous, next);

  assert.deepEqual(digest.added_ids, ["a"]);
  assert.equal(digest.updated.length, 0);
  assert.equal(events[0].first_seen_at, "2026-09-15T08:00:00Z");
});

test("an unchanged existing event keeps its ORIGINAL first_seen_at, not today's stamp", () => {
  const previous = [makeEvent("a", { first_seen_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" })];
  // normalize.mjs always stamps "now" on every run, even for events seen before —
  // diff() must override that with the value from `previous`.
  const next = [makeEvent("a", { first_seen_at: "2026-09-15T08:00:00Z", updated_at: "2026-09-15T08:00:00Z" })];

  const { events, digest } = diff(previous, next);

  assert.deepEqual(digest.added_ids, []);
  assert.deepEqual(digest.updated, []);
  assert.equal(events[0].first_seen_at, "2026-09-01T00:00:00Z", "must carry over the ORIGINAL first-seen date");
  assert.equal(events[0].updated_at, "2026-09-01T00:00:00Z", "must not bump updated_at when nothing changed");
});

test("FR-34: a changed watched field (time) shows up in digest.updated with the field name", () => {
  const previous = [makeEvent("a", { time: "19:30" })];
  const next = [makeEvent("a", { time: "20:00" })];

  const { events, digest } = diff(previous, next);

  assert.equal(digest.updated.length, 1);
  assert.equal(digest.updated[0].id, "a");
  assert.deepEqual(digest.updated[0].fields, ["time"]);
  assert.deepEqual(events[0].updated_fields, ["time"]);
});

test("AC-23: yesterday 100, today 105, exactly 5 new -> digest reports exactly those 5", () => {
  const previous = Array.from({ length: 100 }, (_, i) => makeEvent(`e${i}`));
  const next = [...previous, ...Array.from({ length: 5 }, (_, i) => makeEvent(`new${i}`))];

  const { digest } = diff(previous, next);

  assert.equal(digest.added_ids.length, 5);
  assert.deepEqual(new Set(digest.added_ids), new Set(["new0", "new1", "new2", "new3", "new4"]));
});

test("a field NOT in the watched list (e.g. title_raw) changing does not trigger 已更新", () => {
  const previous = [makeEvent("a", { title_raw: "Old Title" })];
  const next = [makeEvent("a", { title_raw: "New Title" })];

  const { digest } = diff(previous, next);

  assert.deepEqual(digest.updated, []);
});

test("diff real bug (Max, 2026-09-25: \"我發現我收藏的場次不見了\"): an artist getting recognized changes dedup.mjs's computed id (headliners[0] now exists where it used to fall back to title_raw), but the raw_id/source stays the same — diff() must keep the OLD id, not treat this as a brand-new event", () => {
  const oldId = "titleHashId"; // computed from title_raw while headliners was []
  const newId = "headlinerHashId"; // computed from headliners[0] once the artist is recognized
  const previous = [
    makeEvent(oldId, {
      headliners: [],
      lineup: [],
      tags_origin: [],
      sources: [{ name: "KKTIX", url: "https://example.com/raw1", raw_id: "raw1" }],
      first_seen_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    }),
  ];
  const next = [
    makeEvent(newId, {
      headliners: ["Real Artist"],
      lineup: ["Real Artist"],
      tags_origin: ["本地"],
      sources: [{ name: "KKTIX", url: "https://example.com/raw1", raw_id: "raw1" }],
    }),
  ];

  const { events, digest } = diff(previous, next);

  assert.equal(events[0].id, oldId, "must keep the id a favorite/exclusion would already be stored under");
  assert.deepEqual(events[0].merged_ids, [oldId]);
  assert.deepEqual(digest.added_ids, [], "must NOT show up as 新上架 — it's the same show, already seen 9/10");
  assert.equal(events[0].first_seen_at, "2026-09-10T00:00:00Z", "must keep the ORIGINAL first-seen date, not today");
});

test("diff: a genuinely new event (no source raw_id seen before) still gets its fresh id and lands in added_ids normally", () => {
  const previous = [makeEvent("a", { sources: [{ name: "KKTIX", url: "https://example.com/raw1", raw_id: "raw1" }] })];
  const next = [
    makeEvent("a", { sources: [{ name: "KKTIX", url: "https://example.com/raw1", raw_id: "raw1" }] }),
    makeEvent("b", { sources: [{ name: "KKTIX", url: "https://example.com/raw2", raw_id: "raw2" }] }),
  ];

  const { digest } = diff(previous, next);

  assert.deepEqual(digest.added_ids, ["b"]);
});
