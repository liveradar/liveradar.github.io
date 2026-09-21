import { test } from "node:test";
import assert from "node:assert/strict";
import { isPast, partitionEvents } from "./filter.js";

function makeEvent(overrides = {}) {
  return {
    id: "a",
    headliners: ["Test Artist"],
    lineup: ["Test Artist"],
    date: "2026-10-15",
    time: "19:30",
    tags_type: [],
    tags_origin: [],
    title_raw: "Test Event",
    ...overrides,
  };
}

function defaultPrefs(overrides = {}) {
  return {
    favorites: [],
    excluded_events: [],
    excluded_artists: [],
    excluded_types: [],
    mute_keywords: [],
    strict_mode: false,
    ...overrides,
  };
}

test("isPast fix: today's own date is never past, regardless of time-of-day the check runs", () => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(isPast(todayStr), false);
});

test("isPast: yesterday is past, tomorrow is not", () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  assert.equal(isPast(fmt(yesterday)), true);
  assert.equal(isPast(fmt(tomorrow)), false);
});

test("partitionEvents: a today-dated event is not silently bucketed as ended", () => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const event = makeEvent({ date: todayStr });

  const { visible, ended } = partitionEvents([event], defaultPrefs());

  assert.equal(ended.length, 0);
  assert.equal(visible.length, 1);
});

test("partitionEvents: type view filter only shows events with a matching tags_type", () => {
  const festival = makeEvent({ id: "f", tags_type: ["音樂祭"] });
  const solo = makeEvent({ id: "s", tags_type: ["專場"] });

  const { visible } = partitionEvents([festival, solo], defaultPrefs(), { type: "音樂祭" });

  assert.deepEqual(visible.map((v) => v.event.id), ["f"]);
});

test("partitionEvents: origin view filter only shows events with a matching tags_origin", () => {
  const local = makeEvent({ id: "l", tags_origin: ["本地"] });
  const kpop = makeEvent({ id: "k", tags_origin: ["日韓"] });

  const { visible } = partitionEvents([local, kpop], defaultPrefs(), { origin: "日韓" });

  assert.deepEqual(visible.map((v) => v.event.id), ["k"]);
});

test("partitionEvents: type and origin filters combine (both must match)", () => {
  const match = makeEvent({ id: "m", tags_type: ["音樂祭"], tags_origin: ["本地"] });
  const wrongOrigin = makeEvent({ id: "w", tags_type: ["音樂祭"], tags_origin: ["日韓"] });

  const { visible } = partitionEvents([match, wrongOrigin], defaultPrefs(), { type: "音樂祭", origin: "本地" });

  assert.deepEqual(visible.map((v) => v.event.id), ["m"]);
});

test("partitionEvents: a favorited event that doesn't match the active view filter is hidden, not force-shown (real bug: Max filtered by city=新北 and a favorited 台北 show still appeared — FR-33 only promises favorites win over exclude RULES, not over the separate view-filter chips)", () => {
  const favoritedElsewhere = makeEvent({ id: "f", city: "台北" });
  const prefs = defaultPrefs({ favorites: ["f"] });

  const { visible } = partitionEvents([favoritedElsewhere], prefs, { city: "新北" });

  assert.deepEqual(visible, []);
});

test("partitionEvents: a favorited event still bypasses every exclude rule regardless of view filters (FR-33 itself is unchanged — only its interaction with view filters changed)", () => {
  const favorited = makeEvent({ id: "f", city: "新北", headliners: ["Blocked Artist"], tags_type: ["音樂祭"] });
  const prefs = defaultPrefs({
    favorites: ["f"],
    excluded_artists: ["Blocked Artist"],
    excluded_types: ["音樂祭"],
    mute_keywords: ["Test"],
  });

  const { visible } = partitionEvents([favorited], prefs, { city: "新北" });

  assert.deepEqual(visible.map((v) => v.event.id), ["f"]);
  assert.equal(visible[0].pinned, true);
});
