import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeRun, upcomingSessions, eventDates, eventCities } from "./runs.js";

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

function makeTour(overrides = {}) {
  return {
    id: "tour-a",
    title_raw: "宇宙人《Dear You》Live Tour",
    date: "2026-12-17",
    time: "20:00",
    venue: "Legacy TERA",
    city: "台北",
    sessions: [
      { date: "2026-12-17", time: "20:00", venue: "Legacy TERA", city: "台北", status: "on_sale" },
      { date: "2027-01-01", time: "20:00", venue: "LIVE WAREHOUSE", city: "高雄", status: "sold_out" },
      { date: "2027-02-13", time: "20:00", venue: "Legacy Taichung", city: "台中", status: "sold_out" },
    ],
    ...overrides,
  };
}

test("materializeRun: swaps venue/city along with date/time to the NEXT upcoming session (a multi-city tour's stops differ, unlike a theater run's)", () => {
  const tour = makeTour();
  const materialized = materializeRun(tour, "2026-12-20"); // the 12/17 台北 stop has already passed
  assert.equal(materialized.date, "2027-01-01");
  assert.equal(materialized.venue, "LIVE WAREHOUSE");
  assert.equal(materialized.city, "高雄");
});

test("materializeRun: a session missing venue/city (old cached data) falls back to the run's own baked-in venue/city", () => {
  const tour = makeTour({ sessions: [{ date: "2026-12-17", time: "20:00", status: "on_sale" }] });
  const materialized = materializeRun(tour, TODAY);
  assert.equal(materialized.venue, "Legacy TERA");
  assert.equal(materialized.city, "台北");
});

test("eventCities: a tour reports every UPCOMING session's city, de-duplicated", () => {
  const tour = makeTour();
  assert.deepEqual(eventCities(tour, "2026-12-20"), ["高雄", "台中"]);
});

test("eventCities: a fully-ended tour reports every session's city (so a filter chip still resolves to something real)", () => {
  const tour = makeTour();
  assert.deepEqual(eventCities(tour, "2027-03-01"), ["台北", "高雄", "台中"]);
});

test("eventCities: a non-run event reports just its own single city", () => {
  const plain = { id: "a", date: "2026-10-24", city: "台北" };
  assert.deepEqual(eventCities(plain, TODAY), ["台北"]);
});
