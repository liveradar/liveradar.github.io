import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRegisterCheck, runStats, SEARCH_VENUES, saleStatusFromOffers } from "./adapters/kktix.mjs";

const venueRule = (keyword) => SEARCH_VENUES.find((v) => v.keyword === keyword).match;

test("SEARCH_VENUES Legacy Taipei real bug (ZAZEN to VOOID, missing every run): an address that starts with a postal code still matches", () => {
  assert.equal(venueRule("Legacy Taipei")("Legacy", "100臺北市中正區梅花里八德路一段1號華山1914創意文化園區中5A館"), true);
  assert.equal(venueRule("Legacy Taipei")("Legacy", "台北市中正區八德路一段1號"), true);
});

test("SEARCH_VENUES Legacy Taipei/Taichung still tell the two cities apart", () => {
  assert.equal(venueRule("Legacy Taichung")("Legacy", "100臺北市中正區八德路一段1號"), false);
  assert.equal(venueRule("Legacy Taipei")("Legacy Taichung 傳 音樂展演空間", "403臺中市西區英才路"), false);
});

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
    "children_resolved",
    "failed",
    "jsonld_resolved",
    "ok_first_try",
    "ok_on_retry",
    "skipped_known",
  ]);
});

// 2026-09-24: JSON-LD offers replace register_info as the primary sale-status
// signal (register_info failed 61% of the time behind Cloudflare). Shapes
// below are copied from real KKTIX pages sampled that day.
const NOW = Date.parse("2026-09-24T12:00:00+08:00");
const offer = (availability, validFrom = "2026-08-01T12:00:00+08:00", validThrough = "2026-12-01T19:00:00+08:00") => ({
  availability,
  validFrom,
  validThrough,
});

test("saleStatusFromOffers: every tier SoldOut/OutOfStock is SOLD_OUT (real: 羊文学 10/25 加場, SKR FAMILY PARTY)", () => {
  assert.equal(saleStatusFromOffers([offer("http://schema.org/SoldOut"), offer("http://schema.org/OutOfStock")], NOW), "SOLD_OUT");
});

test("saleStatusFromOffers: one InStock tier among sold-out ones is IN_STOCK (real: 音羽-otoha-, 椅子樂團 加場)", () => {
  assert.equal(saleStatusFromOffers([offer("SoldOut"), offer("InStock")], NOW), "IN_STOCK");
});

test("saleStatusFromOffers: InStock tiers whose sale hasn't started yet are COMING_SOON", () => {
  assert.equal(saleStatusFromOffers([offer("InStock", "2026-10-06T12:00:00+08:00")], NOW), "COMING_SOON");
});

test("saleStatusFromOffers: InStock tiers whose sale window already ended are REGISTRATION_CLOSED", () => {
  assert.equal(saleStatusFromOffers([offer("InStock", "2026-08-01T12:00:00+08:00", "2026-09-20T23:59:00+08:00")], NOW), "REGISTRATION_CLOSED");
});

test("saleStatusFromOffers: empty offers is null — the only case that still falls back to register_info (real: fully sold-out seat-map shows like 藤井風/YESUNG)", () => {
  assert.equal(saleStatusFromOffers([], NOW), null);
  assert.equal(saleStatusFromOffers(undefined, NOW), null);
});
