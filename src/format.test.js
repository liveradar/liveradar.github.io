import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDate } from "./format.js";

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
