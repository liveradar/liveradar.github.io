import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOnSaleReminderIcs } from "./ics.js";

test("buildOnSaleReminderIcs: DTSTART is the on-sale time in UTC ics format, not the show date", () => {
  const ics = buildOnSaleReminderIcs({
    id: "abc123",
    title: "測試樂團",
    venue: "The Wall",
    onSaleAt: "2026-09-23T20:00:00+08:00",
    ticketUrl: "https://example.com/ticket",
  });
  assert.match(ics, /DTSTART:20260923T120000Z/);
});

test("buildOnSaleReminderIcs: has two VALARM blocks, one 15 minutes before and one exactly at on-sale time", () => {
  const ics = buildOnSaleReminderIcs({
    id: "abc123",
    title: "測試樂團",
    venue: "The Wall",
    onSaleAt: "2026-09-23T20:00:00+08:00",
    ticketUrl: null,
  });
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.match(ics, /TRIGGER:PT0M/);
});

test("buildOnSaleReminderIcs: UID is stable per event id, so re-downloading the same reminder updates the existing calendar entry instead of duplicating it", () => {
  const event = { id: "xyz789", title: "A", venue: "B", onSaleAt: "2026-09-23T20:00:00+08:00", ticketUrl: null };
  const first = buildOnSaleReminderIcs(event);
  const second = buildOnSaleReminderIcs(event);
  const uidOf = (ics) => ics.match(/UID:(\S+)/)[1];
  assert.equal(uidOf(first), uidOf(second));
});

test("buildOnSaleReminderIcs: special characters in the title (commas, semicolons) are escaped, not left to break the SUMMARY field", () => {
  const ics = buildOnSaleReminderIcs({
    id: "abc123",
    title: "A, B; C",
    venue: null,
    onSaleAt: "2026-09-23T20:00:00+08:00",
    ticketUrl: null,
  });
  assert.match(ics, /SUMMARY:🎫 開賣提醒：A\\, B\\; C/);
});

test("buildOnSaleReminderIcs: omits DESCRIPTION/URL lines entirely when venue/ticketUrl are missing, rather than writing empty fields", () => {
  const ics = buildOnSaleReminderIcs({
    id: "abc123",
    title: "測試",
    venue: null,
    onSaleAt: "2026-09-23T20:00:00+08:00",
    ticketUrl: null,
  });
  assert.doesNotMatch(ics, /^URL:/m);
});

test("buildOnSaleReminderIcs: uses CRLF line endings per RFC 5545, not bare LF", () => {
  const ics = buildOnSaleReminderIcs({
    id: "abc123",
    title: "測試",
    venue: "V",
    onSaleAt: "2026-09-23T20:00:00+08:00",
    ticketUrl: null,
  });
  assert.ok(ics.includes("\r\n"));
});
