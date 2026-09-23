import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRegisterCheck, runStats } from "./adapters/kktix.mjs";

const TODAY = "2026-09-23";

test("needsRegisterCheck: an on_sale known event is still checked — it can sell out", () => {
  assert.equal(needsRegisterCheck({ status: "on_sale", on_sale_at: null }, TODAY), true);
});

test("needsRegisterCheck: sold_out/ended known events are skipped — a repeat SOLD_OUT only re-fetched to the same status, and a revert to IN_STOCK was never acted on", () => {
  assert.equal(needsRegisterCheck({ status: "sold_out", on_sale_at: null }, TODAY), false);
  assert.equal(needsRegisterCheck({ status: "ended", on_sale_at: null }, TODAY), false);
});

test("needsRegisterCheck: announced with an on-sale date still in the future is skipped — can't be sold out before sales open", () => {
  assert.equal(needsRegisterCheck({ status: "announced", on_sale_at: "2026-10-01T12:00:00+08:00" }, TODAY), false);
});

test("needsRegisterCheck: announced whose on-sale date is today or past, or unknown, is still checked", () => {
  assert.equal(needsRegisterCheck({ status: "announced", on_sale_at: "2026-09-23T12:00:00+08:00" }, TODAY), true);
  assert.equal(needsRegisterCheck({ status: "announced", on_sale_at: "2026-09-01T12:00:00+08:00" }, TODAY), true);
  assert.equal(needsRegisterCheck({ status: "announced", on_sale_at: null }, TODAY), true);
});

test("needsRegisterCheck: no previous info at all is checked, not silently skipped", () => {
  assert.equal(needsRegisterCheck(undefined, TODAY), true);
});

test("runStats: exposes the register_info counters fetch.mjs writes into sources.json", () => {
  assert.deepEqual(Object.keys(runStats().register_info).sort(), [
    "blocked_403",
    "checked",
    "failed",
    "ok_first_try",
    "ok_on_retry",
    "skipped_known",
  ]);
});
