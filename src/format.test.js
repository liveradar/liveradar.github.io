import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDate, formatOnSaleDateTime } from "./format.js";

test("splitDate: groupLabel has no year prefix for a date in the current year", () => {
  const thisYear = new Date().getFullYear();
  const { groupLabel } = splitDate(`${thisYear}-10-15`);
  assert.equal(groupLabel, "10月15日");
});

test("splitDate: groupLabel gets a year prefix for a date in a different year (real bug: scrolling from 12月26日 into 1月2日 gave no visual cue which year '1月2日' was)", () => {
  const nextYear = new Date().getFullYear() + 1;
  const { groupLabel } = splitDate(`${nextYear}-01-02`);
  assert.equal(groupLabel, `${nextYear}年1月2日`);
});

test("formatOnSaleDateTime: reads the date/time straight out of an on_sale_at ISO string (Max: \"但我想要知道的預售準確的時間\")", () => {
  assert.equal(formatOnSaleDateTime("2026-09-23T20:00:00+08:00"), "9/23 20:00");
});

test("formatOnSaleDateTime: no leading zero on the month/day (matches splitDate's own month formatting convention)", () => {
  assert.equal(formatOnSaleDateTime("2026-01-05T09:00:00+08:00"), "1/5 09:00");
});

test("formatOnSaleDateTime: null input returns null", () => {
  assert.equal(formatOnSaleDateTime(null), null);
});
