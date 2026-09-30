import { test } from "node:test";
import assert from "node:assert/strict";
import { withdrawnRawIds } from "./adapters/tixcraft.mjs";

const NOW = Date.parse("2026-09-30T12:00:00+08:00");

// Real game-page states checked 2026-09-30 — every one of these showed the
// same "目前無場次資訊" placeholder.
test("withdrawnRawIds: empty game page whose on-sale date already passed is withdrawn (real case: Charlie Puth 桃園場 26_cp, moved to 台北小巨蛋)", () => {
  const drop = withdrawnRawIds([{ raw_id: "26_cp", key: "2026/10/18 (日)|桃園陽光劇場", noSessions: true, onSaleAt: "2026-04-23T12:00:00+08:00" }], NOW);
  assert.deepEqual([...drop], ["26_cp"]);
});

test("withdrawnRawIds: empty game page whose sale hasn't opened yet is kept (real cases: 26_topkh, 26_todd)", () => {
  const drop = withdrawnRawIds([
    { raw_id: "26_topkh", key: "a", noSessions: true, onSaleAt: "2026-10-04T00:00:00+08:00" },
    { raw_id: "26_todd", key: "b", noSessions: true, onSaleAt: "2026-10-03T11:00:00+08:00" },
  ], NOW);
  assert.equal(drop.size, 0);
});

test("withdrawnRawIds: a companion page with no on-sale date goes with a withdrawn page at the same date+venue (real case: 26_cp_c card-holder zone)", () => {
  const drop = withdrawnRawIds([
    { raw_id: "26_cp", key: "2026/10/18 (日)|桃園陽光劇場", noSessions: true, onSaleAt: "2026-04-23T12:00:00+08:00" },
    { raw_id: "26_cp_c", key: "2026/10/18 (日)|桃園陽光劇場", noSessions: true, onSaleAt: null },
  ], NOW);
  assert.deepEqual([...drop].sort(), ["26_cp", "26_cp_c"]);
});

test("withdrawnRawIds: an empty page with no on-sale date and no withdrawn companion is kept — nothing says it's over", () => {
  const drop = withdrawnRawIds([
    { raw_id: "x_c", key: "2026/10/18 (日)|桃園陽光劇場", noSessions: true, onSaleAt: null },
    { raw_id: "y", key: "2026/12/19 (六)|高雄巨蛋", noSessions: true, onSaleAt: "2026-04-23T12:00:00+08:00" },
  ], NOW);
  assert.deepEqual([...drop], ["y"]);
});
