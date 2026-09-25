import { test } from "node:test";
import assert from "node:assert/strict";
import {
  taiwanMonthList,
  toTaiwanDateTimeDash,
  toTaiwanTimestampSlash,
  extractRscText,
  extractEventObjects,
  showSaleSignal,
  buildTicketsRaw,
  showToRawEvent,
} from "./adapters/billboard.mjs";

// Real fields as fetched 2026-09-25 from billboardlivetaipei.tw/tw/events
// (fox capture plan RE:FRAME-15th Anniversary tour in TAIPEI).
const FOX_CAPTURE_PLAN_EVENT = {
  title: "fox capture plan RE:FRAME-15th Anniversary tour in TAIPEI",
  slug: "foxcaptureplan2026",
  artist: { name: "fox capture plan", country: "JP" },
  status: "published",
  salesChannel: "online",
  salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z", memberEarlyAccessStart: null },
  shows: [
    {
      _id: "gp6ezqhia846ckubhzxg50kf",
      name: "2026/12/06 1st fox capture plan",
      startTime: "2026-12-06T08:00:00.000Z",
      openTime: "2026-12-06T07:00:00.000Z",
      status: "preparing",
      salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z", memberEarlyAccessStart: null },
      availableCount: 202,
      totalCount: 268,
      ticketPrices: { "尊榮席 Orange": 2200, "pair-v2": 4400, "悠閒席 (Light Blue)": 1600, "尊享席 (Deep Blue)": 2000, "標準席 (Medium Blue)": 1800, "豪華席 (Pink)": 2000 },
      productAvailability: {
        "尊榮席 Orange": { total: 20, available: 3 },
        "pair-v2": { total: 22, available: 10 },
        "悠閒席 (Light Blue)": { total: 22, available: 22 },
        "尊享席 (Deep Blue)": { total: 40, available: 23 },
        "標準席 (Medium Blue)": { total: 122, available: 107 },
        "豪華席 (Pink)": { total: 42, available: 37 },
      },
    },
    {
      _id: "pd072x5pfhlvbmlvhuhffju6",
      name: "2026/12/06 2nd fox capture plan",
      startTime: "2026-12-06T11:00:00.000Z",
      openTime: "2026-12-06T10:00:00.000Z",
      status: "preparing",
      salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T09:00:00.000Z", memberEarlyAccessStart: null },
      availableCount: 209,
      totalCount: 268,
      ticketPrices: { "標準席 (Medium Blue)": 1800, "尊榮席 Orange": 2200, "豪華席 (Pink)": 2000, "悠閒席 (Light Blue)": 1600, "pair-v2": 4400, "尊享席 (Deep Blue)": 2000 },
      productAvailability: null,
    },
  ],
};

// Wraps a JS object the same way Next.js RSC actually ships it: the pushed
// argument is a JS string literal whose JSON.parse'd content is itself the
// JSON payload — building it via double JSON.stringify reproduces that
// shape exactly instead of hand-escaping quotes.
function fakeNextFChunk(obj) {
  const innerJson = JSON.stringify(obj);
  const jsStringLiteral = JSON.stringify(innerJson);
  return `self.__next_f.push([1,${jsStringLiteral}])`;
}

test("extractRscText + extractEventObjects: round-trips a real event+shows object out of a page's embedded RSC chunk", () => {
  const html = `<html><body><script>${fakeNextFChunk(FOX_CAPTURE_PLAN_EVENT)}</script></body></html>`;
  const rsc = extractRscText(html);
  const eventTexts = extractEventObjects(rsc);
  assert.equal(eventTexts.length, 1);
  const parsed = JSON.parse(eventTexts[0]);
  assert.equal(parsed.slug, "foxcaptureplan2026");
  assert.equal(parsed.shows.length, 2);
  assert.equal(parsed.shows[0]._id, "gp6ezqhia846ckubhzxg50kf");
  assert.equal(parsed.shows[1].availableCount, 209);
});

test("extractEventObjects: a title/description containing literal braces doesn't break the object boundary scan", () => {
  const withBraces = { ...FOX_CAPTURE_PLAN_EVENT, title: "A {weird} title with } and { chars" };
  const html = `<script>${fakeNextFChunk(withBraces)}</script>`;
  const eventTexts = extractEventObjects(extractRscText(html));
  assert.equal(eventTexts.length, 1);
  assert.equal(JSON.parse(eventTexts[0]).title, "A {weird} title with } and { chars");
});

test("extractRscText: multiple push chunks across separate <script> tags all get decoded and concatenated", () => {
  const secondEvent = { ...FOX_CAPTURE_PLAN_EVENT, slug: "second2026", shows: [FOX_CAPTURE_PLAN_EVENT.shows[0]] };
  const html = `<script>${fakeNextFChunk(FOX_CAPTURE_PLAN_EVENT)}</script><script>${fakeNextFChunk(secondEvent)}</script>`;
  const eventTexts = extractEventObjects(extractRscText(html));
  assert.equal(eventTexts.length, 2);
  const slugs = eventTexts.map((t) => JSON.parse(t).slug).sort();
  assert.deepEqual(slugs, ["foxcaptureplan2026", "second2026"]);
});

const NOW = Date.parse("2026-09-25T12:00:00+08:00");

test("showSaleSignal: before startDate is COMING_SOON with the general on-sale time", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z" }, availableCount: null };
  assert.deepEqual(showSaleSignal({ status: "published" }, show, NOW), { sale_signal: "COMING_SOON", on_sale_at: "2026/10/01 08:00" });
});

test("showSaleSignal: within the sale window with plenty left is IN_STOCK", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z" }, availableCount: 88 };
  assert.deepEqual(showSaleSignal({ status: "published" }, show, NOW), { sale_signal: "IN_STOCK", on_sale_at: null });
});

test("showSaleSignal real case (家入レオ 12/13 1st, 網站顯示「即將售罄」/few-left): low-but-nonzero availableCount is still IN_STOCK, not SOLD_OUT", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-07-24T10:00:00.000Z", endDate: "2026-12-13T07:00:00.000Z" }, availableCount: 9 };
  assert.equal(showSaleSignal({ status: "published" }, show, NOW).sale_signal, "IN_STOCK");
});

test("showSaleSignal: availableCount 0 is SOLD_OUT", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z" }, availableCount: 0 };
  assert.equal(showSaleSignal({ status: "published" }, show, NOW).sale_signal, "SOLD_OUT");
});

test("showSaleSignal: a NEGATIVE availableCount is also SOLD_OUT, not IN_STOCK — defensive, since the site's own commerce data (a product's `quantity` field, checked 2026-09-25) can go negative once oversold", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-07-23T10:00:00.000Z", endDate: "2026-12-12T06:00:00.000Z" }, availableCount: -5 };
  assert.equal(showSaleSignal({ status: "published" }, show, NOW).sale_signal, "SOLD_OUT");
});

test("showSaleSignal: a null availableCount (no inventory signal at all) defaults to IN_STOCK, not SOLD_OUT", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z" }, availableCount: null };
  assert.equal(showSaleSignal({ status: "published" }, show, NOW).sale_signal, "IN_STOCK");
});

test("showSaleSignal real case (TETSUYA 9/12, 網站顯示「販售結束」): now past endDate is REGISTRATION_CLOSED", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-09-12T09:00:00.000Z" }, availableCount: 0 };
  assert.deepEqual(showSaleSignal({ status: "published" }, show, NOW), { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null });
});

test("showSaleSignal: a cancelled show is REGISTRATION_CLOSED (shown as 結束販售, same as a cancelled Ticket Plus listing)", () => {
  const show = { status: "cancelled", salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z" }, availableCount: 50 };
  assert.deepEqual(showSaleSignal({ status: "published" }, show, NOW), { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null });
});

test("showSaleSignal: an event marked cancelled/sold-out at the event level overrides an individual show that otherwise looks fine", () => {
  const show = { status: "preparing", salesPeriod: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-12-06T06:00:00.000Z" }, availableCount: 200 };
  assert.equal(showSaleSignal({ status: "cancelled" }, show, NOW).sale_signal, "REGISTRATION_CLOSED");
  assert.equal(showSaleSignal({ status: "sold-out" }, show, NOW).sale_signal, "SOLD_OUT");
});

test("showSaleSignal: during a member-early-access window, on_sale_at is still the GENERAL on-sale time, not the early-access one", () => {
  const show = {
    status: "preparing",
    salesPeriod: { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z", memberEarlyAccessStart: "2026-09-20T00:00:00.000Z" },
    availableCount: null,
  };
  // "now" is after memberEarlyAccessStart but still before the general startDate.
  assert.deepEqual(showSaleSignal({ status: "published" }, show, NOW), { sale_signal: "COMING_SOON", on_sale_at: "2026/10/01 08:00" });
});

test("showSaleSignal: no salesPeriod.startDate at all is COMING_SOON with no on_sale_at", () => {
  assert.deepEqual(showSaleSignal({ status: "published" }, { status: "preparing", salesPeriod: null }, NOW), {
    sale_signal: "COMING_SOON",
    on_sale_at: null,
  });
});

test("buildTicketsRaw: excludes pair-* tiers (2-person seats priced for two) from tickets_raw entirely", () => {
  const signal = { sale_signal: "IN_STOCK", on_sale_at: null };
  const tickets = buildTicketsRaw(FOX_CAPTURE_PLAN_EVENT.shows[0], signal);
  assert.ok(!tickets.some((t) => t.name.toLowerCase().startsWith("pair")));
  assert.equal(tickets.length, 5); // 6 tiers minus pair-v2
});

test("buildTicketsRaw: IN_STOCK signal — a per-tier availableCount of 0 closes just that tier, others stay open", () => {
  const show = {
    ticketPrices: { A: 1000, B: 2000 },
    productAvailability: { A: { total: 10, available: 0 }, B: { total: 10, available: 5 } },
  };
  const tickets = buildTicketsRaw(show, { sale_signal: "IN_STOCK", on_sale_at: null });
  assert.deepEqual(
    tickets.map((t) => [t.name, t.closed]),
    [["A", true], ["B", false]],
  );
});

test("buildTicketsRaw: SOLD_OUT/REGISTRATION_CLOSED signal closes every tier regardless of per-tier availability", () => {
  const show = { ticketPrices: { A: 1000 }, productAvailability: { A: { total: 10, available: 5 } } };
  const tickets = buildTicketsRaw(show, { sale_signal: "SOLD_OUT", on_sale_at: null });
  assert.equal(tickets[0].closed, true);
});

test("buildTicketsRaw: COMING_SOON signal marks every tier waiting and stamps on_sale_at_raw from the signal", () => {
  const show = { ticketPrices: { A: 1000 }, productAvailability: null };
  const tickets = buildTicketsRaw(show, { sale_signal: "COMING_SOON", on_sale_at: "2026/10/01 08:00" });
  assert.deepEqual(tickets[0], { name: "A", price: 1000, closed: false, waiting: true, on_sale_at_raw: "2026/10/01 08:00" });
});

test("buildTicketsRaw: no ticketPrices at all returns an empty array rather than throwing", () => {
  assert.deepEqual(buildTicketsRaw({ ticketPrices: null }, { sale_signal: "IN_STOCK", on_sale_at: null }), []);
});

test("toTaiwanDateTimeDash: UTC -> Taiwan (+8) same-day conversion", () => {
  assert.equal(toTaiwanDateTimeDash("2026-10-24T07:00:00.000Z"), "2026-10-24 15:00");
});

test("toTaiwanDateTimeDash: a UTC time at/after 16:00 rolls into the NEXT Taiwan day", () => {
  assert.equal(toTaiwanDateTimeDash("2026-10-24T16:30:00.000Z"), "2026-10-25 00:30");
});

test("toTaiwanTimestampSlash: same conversion, slash-separated (parseKktixTimestamp's format)", () => {
  assert.equal(toTaiwanTimestampSlash("2026-09-02T10:00:00.000Z"), "2026/09/02 18:00");
});

test("taiwanMonthList: 7 unpadded 'YYYY-M' months starting from the current Taiwan month, rolling over into the next year", () => {
  const nowMs = Date.parse("2026-09-10T04:00:00+08:00"); // Taiwan 2026-09-10
  assert.deepEqual(taiwanMonthList(nowMs), ["2026-9", "2026-10", "2026-11", "2026-12", "2027-1", "2027-2", "2027-3"]);
});

test("taiwanMonthList real case (Max/9/25 research: default page missed non-sold-out shows): a UTC timestamp already in the next Taiwan day/month is used, not the UTC month", () => {
  const nowMs = Date.parse("2026-09-30T20:00:00Z"); // Taiwan: 2026-10-01 04:00
  assert.deepEqual(taiwanMonthList(nowMs)[0], "2026-10");
});

test("showToRawEvent: builds a RawEvent shape normalize.mjs can consume, city-resolvable to 台北", () => {
  const nowMs = Date.parse("2026-09-25T12:00:00+08:00");
  const raw = showToRawEvent(FOX_CAPTURE_PLAN_EVENT, FOX_CAPTURE_PLAN_EVENT.shows[0], nowMs);
  assert.equal(raw.raw_id, "gp6ezqhia846ckubhzxg50kf");
  assert.equal(raw.source_name, "Billboard Live");
  assert.equal(raw.title_raw, "fox capture plan RE:FRAME-15th Anniversary tour in TAIPEI");
  assert.equal(raw.url, "https://www.billboardlivetaipei.tw/tw/events/foxcaptureplan2026");
  assert.match(raw.venue_raw, /台北/);
  assert.equal(raw.date_raw, "2026-12-06 16:00");
  assert.ok(raw.tickets_raw.length > 0);
});
