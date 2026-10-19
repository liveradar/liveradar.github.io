import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingEventRawEvents } from "./adapters/ticketplus.mjs";

const NOW = Date.parse("2026-10-19T04:00:00Z");
const info = { title: "KENSHI YONEZU", start_date: "2026-12-26", end_date: "2026-12-27", hidden: false };
const data = { title: "KENSHI YONEZU", time: "18:00 ~ 18:00", location: "臺北大巨蛋", address: "臺北市信義區忠孝東路四段515號", info: "票價 NT$1,800" };

test("pendingEventRawEvents: one COMING_SOON raw event per day of the listed range, venue/time from event.json", () => {
  const raws = pendingEventRawEvents("abc", info, data, NOW);
  assert.deepEqual(raws.map((r) => [r.raw_id, r.date_raw]), [["abc_pending_2026-12-26", "2026-12-26 18:00"], ["abc_pending_2026-12-27", "2026-12-27 18:00"]]);
  assert.equal(raws[0].venue_raw, "臺北大巨蛋 / 臺北市信義區忠孝東路四段515號");
  assert.equal(raws[0].register_status, "COMING_SOON");
  assert.equal(raws[0].url, "https://ticketplus.com.tw/activity/abc");
});

test("pendingEventRawEvents: nothing for hidden, already-ended, venue-less or missing entries; a range is capped at 7 days", () => {
  assert.deepEqual(pendingEventRawEvents("a", { ...info, hidden: true }, data, NOW), []);
  assert.deepEqual(pendingEventRawEvents("a", { ...info, start_date: "2026-09-01", end_date: "2026-09-02" }, data, NOW), []);
  assert.deepEqual(pendingEventRawEvents("a", info, { ...data, location: " " }, NOW), []);
  assert.deepEqual(pendingEventRawEvents("a", undefined, data, NOW), []);
  assert.equal(pendingEventRawEvents("a", { ...info, start_date: "2026-11-01", end_date: "2027-11-01" }, data, NOW).length, 7);
});
