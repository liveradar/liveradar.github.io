import { test } from "node:test";
import assert from "node:assert/strict";
import { extraSessions } from "./adapters/fansi.mjs";

test("extraSessions: later upcoming sessions get their own raw_id; the first session (the event's own id), past dates and duplicate rows are skipped", () => {
  const sessions = [
    { datetime: "2026/09/06 19:30", venue: "Revolver", address: "台北" },
    { datetime: "2026/09/25 19:30", venue: "Revolver", address: "台北" }, // past
    { datetime: "2026/11/01 19:30", venue: "百樂門酒館", address: "高雄" },
    { datetime: "2026/11/01 19:30", venue: "百樂門酒館", address: "高雄" }, // duplicate row
    { datetime: "2026/11/01 15:00", venue: "百樂門酒館", address: "高雄" },
  ];
  assert.deepEqual(extraSessions("500056", sessions, "2026/10/19"), [
    { raw_id: "500056_202611011930", date_raw: "2026/11/01 19:30", venue_raw: "百樂門酒館 / 高雄" },
    { raw_id: "500056_202611011500", date_raw: "2026/11/01 15:00", venue_raw: "百樂門酒館 / 高雄" },
  ]);
  assert.deepEqual(extraSessions("1", [{ datetime: "2026/12/01 20:00", venue: "A", address: "B" }], "2026/10/19"), []);
});
