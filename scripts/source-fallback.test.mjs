import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackEventsForSource, fallbackReviewItemsForSource } from "./source-fallback.mjs";
import { dedupe } from "./dedup.mjs";

function makeMergedEvent(overrides = {}) {
  return {
    id: "abc123",
    merged_ids: ["abc123"],
    title_raw: "深海系樂團 Live",
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

test("fallbackEventsForSource only returns events that source actually contributed to", () => {
  const previousEvents = [
    makeMergedEvent({ sources: [{ name: "KKTIX", url: "x", raw_id: "a" }] }),
    makeMergedEvent({ id: "def456", sources: [{ name: "拓元", url: "y", raw_id: "b" }] }),
  ];

  const kktixFallback = fallbackEventsForSource(previousEvents, "KKTIX");
  assert.equal(kktixFallback.length, 1);
  assert.equal(kktixFallback[0].sources.length, 1);
  assert.equal(kktixFallback[0].sources[0].name, "KKTIX");
});

test("fallbackEventsForSource strips merge-specific fields so dedupe() can safely re-process it", () => {
  const previousEvents = [makeMergedEvent()];
  const [fallback] = fallbackEventsForSource(previousEvents, "KKTIX");

  assert.equal(fallback.id, undefined);
  assert.equal(fallback.merged_ids, undefined);
  assert.equal(fallback.headliners[0], "深海系樂團");
});

test("a source's fallback event re-merges cleanly with a fresh event from a still-working source, not duplicated", () => {
  // Last run: KKTIX and 拓元 both had this show, already merged.
  const previousEvents = [
    makeMergedEvent({
      sources: [
        { name: "KKTIX", url: "https://kktix.example/a", raw_id: "a" },
        { name: "拓元", url: "https://tixcraft.example/b", raw_id: "b" },
      ],
    }),
  ];

  // This run: KKTIX is blocked (falls back to its old contribution), but
  // 拓元 still works and reports the same show fresh.
  const kktixFallback = fallbackEventsForSource(previousEvents, "KKTIX");
  const freshTixcraftEvent = {
    title_raw: "深海系樂團 Live",
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    is_festival: false,
    venue: "Legacy Taipei",
    city: "台北",
    date: "2026-10-15",
    time: "19:30",
    on_sale_at: null,
    price_min: 850,
    price_max: 850,
    status: "on_sale",
    tags_type: ["專場"],
    tags_origin: ["本地"],
    ticket_url: "https://tixcraft.example/b",
    sources: [{ name: "拓元", url: "https://tixcraft.example/b", raw_id: "b" }],
    first_seen_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
  };

  const result = dedupe([...kktixFallback, freshTixcraftEvent]);

  assert.equal(result.length, 1, "must merge into a single event, not duplicate");
  assert.equal(result[0].sources.length, 2, "keeps both sources — carried-forward KKTIX and fresh 拓元");
});

test("fallbackEventsForSource with a rawIds filter only reuses the specific events an adapter chose to skip", () => {
  const previousEvents = [
    makeMergedEvent({ id: "e1", sources: [{ name: "拓元", url: "x", raw_id: "known-1" }] }),
    makeMergedEvent({ id: "e2", sources: [{ name: "拓元", url: "y", raw_id: "known-2" }] }),
    makeMergedEvent({ id: "e3", sources: [{ name: "拓元", url: "z", raw_id: "known-3" }] }),
  ];

  const reused = fallbackEventsForSource(previousEvents, "拓元", new Set(["known-1", "known-3"]));

  assert.equal(reused.length, 2);
  assert.deepEqual(
    reused.map((e) => e.sources[0].raw_id).sort(),
    ["known-1", "known-3"],
  );
});

test("fallbackReviewItemsForSource only returns items from that source", () => {
  const previousNeedsReview = [
    { raw_id: "a", source: "KKTIX", reason: "artist_unrecognized" },
    { raw_id: "b", source: "拓元", reason: "artist_unrecognized" },
    { raw_id: "c", source: "KKTIX", reason: "artist_unrecognized" },
  ];

  const result = fallbackReviewItemsForSource(previousNeedsReview, "KKTIX");

  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.source === "KKTIX"));
});

test("readPrevious: missing file is a first run ([]), an unparseable file aborts instead of looking like one", async () => {
  const { readPrevious } = await import("./source-fallback.mjs");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "liveradar-"));
  assert.deepEqual(readPrevious(join(dir, "nope.json"), "events"), []);
  writeFileSync(join(dir, "ok.json"), '{"events":[{"id":"a"}]}');
  assert.deepEqual(readPrevious(join(dir, "ok.json"), "events"), [{ id: "a" }]);
  writeFileSync(join(dir, "bad.json"), "{");
  assert.throws(() => readPrevious(join(dir, "bad.json"), "events"), /無法解析/);
});
