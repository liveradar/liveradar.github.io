import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRuns } from "./runs.mjs";
import { computeId } from "./dedup.mjs";

const TODAY = "2026-10-10";

function makeSession(overrides = {}) {
  return {
    title_raw: "《神隱少女》舞台劇",
    headliners: [],
    lineup: [],
    is_festival: false,
    venue: "臺北市藝文推廣處城市舞台",
    city: "台北",
    date: "2026-10-24",
    time: "14:30",
    on_sale_at: null,
    price_min: 700,
    price_max: 3500,
    status: "on_sale",
    tags_type: ["舞台劇"],
    tags_origin: [],
    is_lottery: false,
    ticket_url: "https://www.opentix.life/event/123",
    sources: [{ name: "OPENTIX", url: "https://www.opentix.life/event/123", raw_id: "123_1793359800000" }],
    first_seen_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    category: "舞台劇",
    run_key: "opentix:123:臺北市藝文推廣處城市舞台",
    ...overrides,
  };
}

test("groupRuns: 3 sessions sharing a run_key merge into one run event with date/date_end/sessions/price all correct", () => {
  const sessions = [
    makeSession({ date: "2026-10-24", time: "14:30", price_min: 700, price_max: 3500 }),
    makeSession({ date: "2026-10-25", time: "14:30", price_min: 500, price_max: 3500 }),
    makeSession({ date: "2026-10-30", time: "19:30", price_min: 700, price_max: 4000 }),
  ];
  const [run] = groupRuns(sessions, TODAY);
  assert.equal(run.date, "2026-10-24");
  assert.equal(run.time, "14:30");
  assert.equal(run.date_end, "2026-10-30");
  assert.equal(run.sessions.length, 3);
  assert.deepEqual(
    run.sessions.map((s) => s.date),
    ["2026-10-24", "2026-10-25", "2026-10-30"],
  );
  assert.equal(run.price_min, 500);
  assert.equal(run.price_max, 4000);
});

test("groupRuns: status is on_sale if ANY upcoming session is on_sale", () => {
  const sessions = [makeSession({ date: "2026-10-24", status: "sold_out" }), makeSession({ date: "2026-10-25", status: "on_sale" })];
  const [run] = groupRuns(sessions, TODAY);
  assert.equal(run.status, "on_sale");
});

test("groupRuns: with no on_sale session, status is announced if any upcoming session is announced, using the EARLIEST on_sale_at among them", () => {
  const sessions = [
    makeSession({ date: "2026-10-24", status: "announced", on_sale_at: "2026-10-01T12:00:00+08:00" }),
    makeSession({ date: "2026-10-25", status: "announced", on_sale_at: "2026-09-28T12:00:00+08:00" }),
    makeSession({ date: "2026-10-26", status: "sold_out" }),
  ];
  const [run] = groupRuns(sessions, TODAY);
  assert.equal(run.status, "announced");
  assert.equal(run.on_sale_at, "2026-09-28T12:00:00+08:00");
});

test("groupRuns: with no on_sale/announced session, status is sold_out if any upcoming session is sold_out", () => {
  const sessions = [makeSession({ date: "2026-10-24", status: "sold_out" }), makeSession({ date: "2026-10-25", status: "sold_out" })];
  const [run] = groupRuns(sessions, TODAY);
  assert.deepEqual({ status: run.status, on_sale_at: run.on_sale_at }, { status: "sold_out", on_sale_at: null });
});

test("groupRuns: every upcoming session accounted for as ended (no on_sale/announced/sold_out among them) reports ended", () => {
  // A run whose remaining sessions are all... nothing recognized as buyable
  // (the adapter never saw a real signal) still needs *some* fallback status.
  const sessions = [makeSession({ date: "2026-10-24", status: "ended" })];
  const [run] = groupRuns(sessions, TODAY);
  assert.equal(run.status, "ended");
});

test("groupRuns: sessions already in the past don't affect date/date_end/status — only upcoming ones count", () => {
  const sessions = [
    makeSession({ date: "2026-10-01", status: "ended" }), // already past TODAY
    makeSession({ date: "2026-10-24", status: "on_sale" }),
    makeSession({ date: "2026-10-30", status: "on_sale" }),
  ];
  const [run] = groupRuns(sessions, TODAY);
  assert.equal(run.date, "2026-10-24"); // not the past 10/01 session
  assert.equal(run.date_end, "2026-10-30");
  assert.equal(run.status, "on_sale");
  assert.equal(run.sessions.length, 3); // still recorded, just not "relevant"
});

test("groupRuns: a run whose EVERY session has already passed falls back to the full run (not undefined) and reports ended", () => {
  const sessions = [makeSession({ date: "2026-09-01", status: "sold_out" }), makeSession({ date: "2026-09-05", status: "sold_out" })];
  const [run] = groupRuns(sessions, TODAY);
  assert.equal(run.date, "2026-09-01");
  assert.equal(run.date_end, "2026-09-05");
  assert.equal(run.status, "ended");
});

test("groupRuns: id is stable across the first session passing — it's derived from run_key only, never a date", () => {
  const before = groupRuns(
    [makeSession({ date: "2026-10-24" }), makeSession({ date: "2026-10-25" }), makeSession({ date: "2026-10-30" })],
    "2026-10-10",
  )[0];
  // Same run_key, but the 10/24 session is gone now (a later fetch after it
  // played) and "today" has moved on.
  const after = groupRuns([makeSession({ date: "2026-10-25" }), makeSession({ date: "2026-10-30" })], "2026-10-26")[0];
  assert.equal(before.id, after.id);
  assert.equal(before.id, computeId("run", "opentix:123:臺北市藝文推廣處城市舞台", ""));
});

test("groupRuns: an event with no run_key passes through completely unchanged", () => {
  const plain = { title_raw: "A Band Live", date: "2026-10-24", headliners: ["A Band"] };
  const [result] = groupRuns([plain], TODAY);
  assert.equal(result, plain);
});

test("groupRuns: an event that already carries `sessions` (reused from a previous run via source-fallback) passes through unchanged, not re-grouped", () => {
  const alreadyRun = { title_raw: "Already Merged", run_key: "opentix:999:X", sessions: [{ date: "2026-10-24", time: "19:30", status: "on_sale" }] };
  const [result] = groupRuns([alreadyRun], TODAY);
  assert.equal(result, alreadyRun);
});

test("groupRuns: the same run_key at two different venues never merge — venue is part of run_key identity", () => {
  const sessions = [
    makeSession({ run_key: "opentix:123:臺北場", venue: "臺北場", date: "2026-10-24" }),
    makeSession({ run_key: "opentix:123:高雄場", venue: "高雄場", date: "2026-11-01" }),
  ];
  const runs = groupRuns(sessions, TODAY);
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].id, runs[1].id);
});
