import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeRun, upcomingSessions, eventDates } from "./runs.js";

const TODAY = "2026-10-26";

function makeRun(overrides = {}) {
  return {
    id: "run-a",
    title_raw: "《神隱少女》舞台劇",
    date: "2026-10-24",
    time: "14:30",
    date_end: "2026-11-10",
    sessions: [
      { date: "2026-10-24", time: "14:30", status: "on_sale" },
      { date: "2026-10-30", time: "19:30", status: "on_sale" },
      { date: "2026-11-10", time: "14:30", status: "on_sale" },
    ],
    ...overrides,
  };
}

test("upcomingSessions: only sessions on/after today", () => {
  const run = makeRun();
  const upcoming = upcomingSessions(run, TODAY);
  assert.deepEqual(
    upcoming.map((s) => s.date),
    ["2026-10-30", "2026-11-10"],
  );
});

test("materializeRun: swaps date/time to the NEXT upcoming session when the first one has already passed", () => {
  const run = makeRun();
  const materialized = materializeRun(run, TODAY);
  assert.equal(materialized.date, "2026-10-30");
  assert.equal(materialized.time, "19:30");
});

test("materializeRun: every session already passed falls back to the LAST one, so isPast() naturally treats it as ended", () => {
  const run = makeRun({ sessions: [{ date: "2026-09-01", time: "19:30", status: "sold_out" }, { date: "2026-09-05", time: "19:30", status: "sold_out" }] });
  const materialized = materializeRun(run, TODAY);
  assert.equal(materialized.date, "2026-09-05");
});

test("materializeRun: a non-run event (no `sessions`) passes through completely unchanged", () => {
  const plain = { id: "a", title_raw: "A Band Live", date: "2026-10-24", time: "19:30" };
  assert.equal(materializeRun(plain, TODAY), plain);
});

test("eventDates: a run reports every UPCOMING session date", () => {
  const run = makeRun();
  assert.deepEqual(eventDates(run, TODAY), ["2026-10-30", "2026-11-10"]);
});

test("eventDates: a fully-ended run reports every session date (so it still resolves to something real)", () => {
  const run = makeRun({ sessions: [{ date: "2026-09-01", time: "19:30", status: "sold_out" }, { date: "2026-09-05", time: "19:30", status: "sold_out" }] });
  assert.deepEqual(eventDates(run, TODAY), ["2026-09-01", "2026-09-05"]);
});

test("eventDates: a non-run event reports just its own single date", () => {
  const plain = { id: "a", date: "2026-10-24" };
  assert.deepEqual(eventDates(plain, TODAY), ["2026-10-24"]);
});
