import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshedStatus, needsStatusCheck } from "./sale-signal.mjs";
import { decodeTicketPlusId } from "./adapters/ticketplus.mjs";

const NOW = Date.parse("2026-09-24T12:00:00+08:00");
const TODAY = "2026-09-24";
const ev = (overrides) => ({ date: "2026-10-24", status: "on_sale", on_sale_at: null, ...overrides });

test("refreshedStatus: a known on_sale event that sold out after discovery becomes sold_out (the 207-event blind spot, 2026-09-24)", () => {
  assert.deepEqual(refreshedStatus(ev({}), "SOLD_OUT", null, NOW, TODAY), { status: "sold_out", on_sale_at: null });
});

test("refreshedStatus: sales closed (Ticket Plus 'over' — the 岡崎體育 cancellation case) also becomes sold_out, shown as 結束販售", () => {
  assert.deepEqual(refreshedStatus(ev({}), "REGISTRATION_CLOSED", null, NOW, TODAY), { status: "sold_out", on_sale_at: null });
});

test("refreshedStatus: a closed-sales signal on an already-past date is ended, not sold_out", () => {
  assert.equal(refreshedStatus(ev({ date: "2026-09-06" }), "SOLD_OUT", null, NOW, TODAY).status, "ended");
});

test("refreshedStatus: announced -> on_sale from an IN_STOCK signal", () => {
  assert.deepEqual(refreshedStatus(ev({ status: "announced", on_sale_at: "2026-10-01T12:00:00+08:00" }), "IN_STOCK", null, NOW, TODAY), {
    status: "on_sale",
    on_sale_at: null,
  });
});

test("refreshedStatus: with NO signal, an announced event whose sale time has passed is still promoted (real: TAKASE TOYA 11/08 stuck on 尚未開賣 a day after sale start)", () => {
  assert.equal(refreshedStatus(ev({ status: "announced", on_sale_at: "2026-09-23T20:00:00+08:00" }), null, null, NOW, TODAY).status, "on_sale");
});

test("refreshedStatus: with no signal and nothing time-based to change, keeps the previous status (returns null)", () => {
  assert.equal(refreshedStatus(ev({}), null, null, NOW, TODAY), null);
  assert.equal(refreshedStatus(ev({ status: "announced", on_sale_at: "2026-10-06T12:00:00+08:00" }), null, null, NOW, TODAY), null);
});

test("refreshedStatus: a signal matching the current status is not reported as a change", () => {
  assert.equal(refreshedStatus(ev({}), "IN_STOCK", null, NOW, TODAY), null);
});

test("refreshedStatus: COMING_SOON keeps/updates the on-sale time", () => {
  assert.deepEqual(refreshedStatus(ev({ status: "on_sale" }), "COMING_SOON", "2026-10-10T13:00:00+08:00", NOW, TODAY), {
    status: "announced",
    on_sale_at: "2026-10-10T13:00:00+08:00",
  });
});

test("needsStatusCheck: skips known sold_out/ended events and announced ones whose sale hasn't started", () => {
  assert.equal(needsStatusCheck({ status: "sold_out" }, TODAY), false);
  assert.equal(needsStatusCheck({ status: "ended" }, TODAY), false);
  assert.equal(needsStatusCheck({ status: "announced", on_sale_at: "2026-10-06T12:00:00+08:00" }, TODAY), false);
  assert.equal(needsStatusCheck({ status: "on_sale" }, TODAY), true);
});

test("decodeTicketPlusId: converts the page URL's hex ids into the e/s ids Ticket Plus's status API takes (real pair observed in the site's own request)", () => {
  assert.equal(decodeTicketPlusId("93e750f2dc0116705f3fdbdd624316e6"), "e000001535");
  assert.equal(decodeTicketPlusId("997e9134099a898306177a2c02abab63"), "s000002268");
});

test("TICKET_TERMINAL_TEXT_RE real bug (Stray Kids tixcraft purchase page: first row reads '已售完', not in the old exact-phrase list)", async () => {
  const { TICKET_TERMINAL_TEXT_RE } = await import("./sale-signal.mjs");
  for (const t of ["已售完", "選購一空", "2026/09/19 12:00 截止", "銷售截止", "販售結束"]) assert.equal(TICKET_TERMINAL_TEXT_RE.test(t), true, t);
  assert.equal(TICKET_TERMINAL_TEXT_RE.test("立即訂購"), false);
});
