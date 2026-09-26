import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {
  isWheelchairNote,
  parsePriceCell,
  parseDateCell,
  parseVenueCell,
  parseProductPage,
  combineRowsIntoSessions,
  sessionToRawEvent,
  classifyProduct,
  collectEligibleIds,
} from "./adapters/utk.mjs";
import { normalize, loadArtists } from "./normalize.mjs";

function cellsFrom(rowHtml) {
  const $ = cheerio.load(`<table><tr>${rowHtml}</tr></table>`);
  return { $, cells: $("td") };
}

test("isWheelchairNote: matches 輪椅/身障, not an ordinary note", () => {
  assert.equal(isWheelchairNote("【輪椅場】XG世界巡迴演唱會"), true);
  assert.equal(isWheelchairNote("【身障/輪椅場】XG世界巡迴演唱會"), true);
  assert.equal(isWheelchairNote("【VIP門票】XG世界巡迴演唱會"), false);
  assert.equal(isWheelchairNote(""), false);
  assert.equal(isWheelchairNote(undefined), false);
});

test("parsePriceCell real case (寬宏 WILD WILD, checked 2026-09-26): <s><font>N</font></s>-wrapped numbers are closed, bare numbers are open", () => {
  const html = "<s><font color='lightblue'>2880</font></s>、<s><font color='lightblue'>3680</font></s>、4280、<s><font color='lightblue'>4880</font></s>";
  assert.deepEqual(parsePriceCell(html), [
    { price: 2880, closed: true },
    { price: 3680, closed: true },
    { price: 4280, closed: false },
    { price: 4880, closed: true },
  ]);
});

test("parsePriceCell real case (年代 Novelbright, checked 2026-09-26): <del>N</del>-wrapped inside <wbr> tags, same closed/open reading", () => {
  const html = "<wbr>3900、</wbr><wbr><del>3600</del>、</wbr><wbr><del>2800</del>、</wbr><wbr><del>2000</del></wbr>";
  assert.deepEqual(parsePriceCell(html), [
    { price: 3900, closed: false },
    { price: 3600, closed: true },
    { price: 2800, closed: true },
    { price: 2000, closed: true },
  ]);
});

test("parsePriceCell: empty/null input returns an empty array, not throwing", () => {
  assert.deepEqual(parsePriceCell(""), []);
  assert.deepEqual(parsePriceCell(null), []);
});

test("parseDateCell real case (寬宏, plain text 'YYYY/MM/DD(周) HH:MM')", () => {
  const { $, cells } = cellsFrom("<td>\n\t\t\t2026/11/21(六)15:00\n\t\t\t\n\t\t</td>");
  assert.deepEqual(parseDateCell(cells.eq(0), $), { date: "2026-11-21", time: "15:00" });
});

test("parseDateCell real case (寬宏 多日活動, 2026玖壹壹南北貳路音樂節): a date RANGE 'A ~ B' takes only the start", () => {
  const { $, cells } = cellsFrom("<td>2026/11/07(六)13:00 ~ 2026/11/08(日)13:00</td>");
  assert.deepEqual(parseDateCell(cells.eq(0), $), { date: "2026-11-07", time: "13:00" });
});

test("parseDateCell real case (年代, <time datetime> + <span class='time'>)", () => {
  const html = `<td><div align='center'><span><time datetime='2026-11-28' class='icon'><em>星期六</em><strong>2026 - 11</strong><span class='day'>28</span><hr><span class='time'>15:00</span></time></span></div></td>`;
  const { $, cells } = cellsFrom(html);
  assert.deepEqual(parseDateCell(cells.eq(0), $), { date: "2026-11-28", time: "15:00" });
});

test("parseDateCell: an unparseable cell returns null", () => {
  const { $, cells } = cellsFrom("<td>洽詢主辦單位</td>");
  assert.equal(parseDateCell(cells.eq(0), $), null);
});

test("parseVenueCell real case (寬宏 WILD WILD, checked 2026-09-26): venue name + Google Maps address decoded from the href", () => {
  const html = `<td><a id="PLACE_ADDRESS" href="http://maps.google.com.tw/maps?f=q&amp;hl=zh-TW&amp;geocode=&amp;t=&amp;z=16&amp;q=%e5%8f%b0%e4%b8%ad%e5%b8%82%e8%a5%bf%e5%b1%af%e5%8d%80%e5%ae%89%e5%92%8c%e8%b7%af117%e8%99%9f" target="GoogleMap"><img src="x.png" /></a>&nbsp;<span id="PLACE_NAME">Legacy Taichung 傳 音樂展演空間</span></td>`;
  const { cells } = cellsFrom(html);
  const result = parseVenueCell(cells.eq(0));
  assert.equal(result.venueName, "Legacy Taichung 傳 音樂展演空間");
  assert.equal(result.address, "台中市西屯區安和路117號");
  assert.equal(result.note, "");
});

test("parseVenueCell: id-suffix selector works regardless of 寬宏's bare 'PLACE_NAME' or 年代's 'ctl00_...PLACE_NAME' prefix", () => {
  const bare = cellsFrom(`<td><a id="PLACE_ADDRESS" href="http://maps.google.com.tw/maps?q=%e5%8f%b0%e5%8c%97"></a><span id="PLACE_NAME">場館A</span></td>`);
  assert.deepEqual(parseVenueCell(bare.cells.eq(0)), { venueName: "場館A", address: "台北", note: "" });

  const prefixed = cellsFrom(
    `<td><a id="ctl00_ContentPlaceHolder1_PerformanceList_ctl00_PLACE_ADDRESS" href="http://maps.google.com.tw/maps?q=%e5%8f%b0%e5%8c%97"></a><span id="ctl00_ContentPlaceHolder1_PerformanceList_ctl00_PLACE_NAME">場館B</span><br>臺中場</td>`,
  );
  const result = parseVenueCell(prefixed.cells.eq(0));
  assert.equal(result.venueName, "場館B");
  assert.equal(result.address, "台北");
  assert.equal(result.note, "臺中場");
});

test("parseVenueCell real case (XG WORLD TOUR, VIP row): note text after the venue span/address is captured (used for wheelchair-row detection)", () => {
  const html = `<td><a id="PLACE_ADDRESS" href="http://maps.google.com.tw/maps?q=%e5%8f%b0%e5%8c%97"><img src="x.png"/></a>&nbsp;<span id="PLACE_NAME">臺北小巨蛋</span><br>【VIP門票】XG世界巡迴演唱會 THE CORE 台北站</td>`;
  const { cells } = cellsFrom(html);
  const result = parseVenueCell(cells.eq(0));
  assert.equal(result.venueName, "臺北小巨蛋");
  assert.equal(result.note, "【VIP門票】XG世界巡迴演唱會 THE CORE 台北站");
});

const KHAM_WILD_WILD_ROW = `
<tr>
  <td>2026/11/21(六)15:00</td>
  <td><a id="PLACE_ADDRESS" href="http://maps.google.com.tw/maps?q=%e5%8f%b0%e4%b8%ad%e5%b8%82%e8%a5%bf%e5%b1%af%e5%8d%80%e5%ae%89%e5%92%8c%e8%b7%af117%e8%99%9f"><img src="x.png"/></a>&nbsp;<span id="PLACE_NAME">Legacy Taichung 傳 音樂展演空間</span></td>
  <td data-th="票價(NT$)："><s><font color='lightblue'>2880</font></s>、<s><font color='lightblue'>3680</font></s>、4280、<s><font color='lightblue'>4880</font></s></td>
  <td><a href='javascript:;'><button class='red' onclick="top.location.href='UTK0204_.aspx?PERFORMANCE_ID=P1F5NEG8&PRODUCT_ID=P1F4200H';return false;">立即訂購</button></a></td>
</tr>`;

test("parseProductPage real case (寬宏 2026 SHOW MUSICAL《WILD WILD》, checked 2026-09-26): title + one real row parsed correctly", () => {
  const html = `<html><body><div class="eventTitle">2026 SHOW MUSICAL《WILD WILD》</div><table class="eventTABLE"><tbody><tr><th>活動日期</th><th>地點</th><th>票價</th><th>訂購</th></tr>${KHAM_WILD_WILD_ROW}</tbody></table></body></html>`;
  const { title, rows } = parseProductPage(html);
  assert.equal(title, "2026 SHOW MUSICAL《WILD WILD》");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-11-21");
  assert.equal(rows[0].time, "15:00");
  assert.equal(rows[0].venueName, "Legacy Taichung 傳 音樂展演空間");
  assert.match(rows[0].address, /台中市西屯區安和路117號/);
  assert.deepEqual(rows[0].prices, [
    { price: 2880, closed: true },
    { price: 3680, closed: true },
    { price: 4280, closed: false },
    { price: 4880, closed: true },
  ]);
});

test("parseProductPage: the header row (<th> cells, no <td>) is skipped, not misread as a session", () => {
  const html = `<div class="eventTitle">Test</div><table class="eventTABLE"><tbody><tr><th>活動日期</th><th>地點</th><th>票價</th><th>訂購</th></tr>${KHAM_WILD_WILD_ROW}</tbody></table>`;
  const { rows } = parseProductPage(html);
  assert.equal(rows.length, 1);
});

test("parseProductPage real case (寬宏「三個不老擊敗之人生跑馬燈 LIVE SHOW」, checked 2026-09-26): a product not yet on sale — UTK0201_00.aspx redirects to a completely different template with no eventTABLE at all — returns a title but zero rows, not throwing", () => {
  const html = `<html><body><div class="eventTitle">三個不老擊敗之人生跑馬燈 LIVE SHOW</div><div>開賣時間：2026年09月28日(一)中午12點</div></body></html>`;
  const { title, rows } = parseProductPage(html);
  assert.equal(title, "三個不老擊敗之人生跑馬燈 LIVE SHOW");
  assert.deepEqual(rows, []);
});

test("combineRowsIntoSessions real case (BIGBANG 高雄場, checked 2026-09-25): several rows at the SAME (date+time, venue), each its own price tier as a separate PERFORMANCE_ID, merge into ONE session with the price union", () => {
  const rows = [
    { date: "2027-02-27", time: "18:30", venueName: "高雄國家體育場", address: "高雄市左營區世運大道100號", note: "", prices: [{ price: 9430, closed: true }] },
    { date: "2027-02-27", time: "18:30", venueName: "高雄國家體育場", address: "高雄市左營區世運大道100號", note: "", prices: [{ price: 9380, closed: true }] },
    { date: "2027-02-27", time: "18:30", venueName: "高雄國家體育場", address: "高雄市左營區世運大道100號", note: "", prices: [{ price: 8880, closed: true }] },
  ];
  const sessions = combineRowsIntoSessions(rows);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tickets.length, 3);
  assert.equal(sessions[0].allStruck, true, "every tier struck through -> the whole session is sold out");
});

test("combineRowsIntoSessions real case (XG WORLD TOUR 台北站, checked 2026-09-26): a wheelchair-only row (【身障/輪椅場】) is excluded from the merged price list when normal rows exist", () => {
  const rows = [
    { date: "2026-10-17", time: "19:30", venueName: "臺北小巨蛋", address: "台北市松山區", note: "【VIP門票】XG世界巡迴演唱會", prices: [{ price: 6980, closed: false }, { price: 7980, closed: true }] },
    { date: "2026-10-17", time: "19:30", venueName: "臺北小巨蛋", address: "台北市松山區", note: "XG世界巡迴演唱會 THE CORE 台北站", prices: [{ price: 800, closed: true }, { price: 4580, closed: false }, { price: 5580, closed: false }] },
    { date: "2026-10-17", time: "19:30", venueName: "臺北小巨蛋", address: "台北市松山區", note: "【身障/輪椅場】XG世界巡迴演唱會", prices: [{ price: 800, closed: true }] },
  ];
  const sessions = combineRowsIntoSessions(rows);
  assert.equal(sessions.length, 1);
  // 6980 (VIP) survives, plus the plain row's tiers — the wheelchair row's
  // OWN dedicated 800 entry doesn't add anything new since it's already
  // present (closed) in the plain row.
  assert.ok(sessions[0].tickets.some((t) => t.price === 6980 && !t.closed));
  assert.equal(sessions[0].allStruck, false);
});

test("combineRowsIntoSessions: a session whose ONLY rows are wheelchair rows still uses them (nothing else to fall back to)", () => {
  const rows = [{ date: "2026-10-17", time: "19:30", venueName: "X", address: "台北", note: "【輪椅場】", prices: [{ price: 800, closed: false }] }];
  const sessions = combineRowsIntoSessions(rows);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].tickets, [{ price: 800, closed: false }]);
});

test("combineRowsIntoSessions: all tiers struck -> allStruck true (SOLD_OUT); any tier open -> allStruck false (IN_STOCK)", () => {
  const soldOut = combineRowsIntoSessions([{ date: "2026-10-01", time: "19:00", venueName: "X", address: "", note: "", prices: [{ price: 100, closed: true }, { price: 200, closed: true }] }]);
  assert.equal(soldOut[0].allStruck, true);
  const partial = combineRowsIntoSessions([{ date: "2026-10-01", time: "19:00", venueName: "X", address: "", note: "", prices: [{ price: 100, closed: true }, { price: 200, closed: false }] }]);
  assert.equal(partial[0].allStruck, false);
});

test("combineRowsIntoSessions: the same price appearing both open and closed across rows keeps the OPEN state", () => {
  const rows = [
    { date: "2026-10-01", time: "19:00", venueName: "X", address: "", note: "", prices: [{ price: 100, closed: true }] },
    { date: "2026-10-01", time: "19:00", venueName: "X", address: "", note: "", prices: [{ price: 100, closed: false }] },
  ];
  const sessions = combineRowsIntoSessions(rows);
  assert.deepEqual(sessions[0].tickets, [{ price: 100, closed: false }]);
});

test("sessionToRawEvent: builds a RawEvent statusFromTickets/normalize.mjs can consume, register_status reflects allStruck", () => {
  const session = { date: "2026-11-21", time: "15:00", venueName: "Legacy Taichung 傳 音樂展演空間", address: "台中市西屯區安和路117號", tickets: [{ price: 4280, closed: false }], allStruck: false };
  const raw = sessionToRawEvent(session, { productId: "P1F4200H", productTitle: "2026 SHOW MUSICAL《WILD WILD》", host: "kham.com.tw", sourceName: "寬宏", category: "音樂劇" });
  assert.equal(raw.raw_id, "P1F4200H_202611211500");
  assert.equal(raw.date_raw, "2026-11-21 15:00");
  assert.equal(raw.venue_raw, "Legacy Taichung 傳 音樂展演空間 / 台中市西屯區安和路117號");
  assert.equal(raw.register_status, "IN_STOCK");
  assert.equal(raw.category, "音樂劇");
  assert.equal(raw.run_key, "寬宏:P1F4200H:Legacy Taichung 傳 音樂展演空間");
  assert.equal(raw.source_name, "寬宏");
});

test("sessionToRawEvent: a fully sold-out session gets register_status SOLD_OUT", () => {
  const session = { date: "2027-02-27", time: "18:30", venueName: "高雄國家體育場", address: "高雄市", tickets: [{ price: 9430, closed: true }], allStruck: true };
  const raw = sessionToRawEvent(session, { productId: "P1EMCIC6", productTitle: "BIGBANG", host: "kham.com.tw", sourceName: "寬宏", category: undefined });
  assert.equal(raw.register_status, "SOLD_OUT");
  assert.equal("category" in raw, false);
  assert.equal("run_key" in raw, false);
});

test("classifyProduct: 80 (音樂劇) wins outright over 116 (舞台劇) when a product is dual-listed", () => {
  const idsByCategory = { musical: new Set(["A"]), drama: new Set(["A"]) };
  assert.equal(classifyProduct(idsByCategory, "A"), "音樂劇");
});

test("classifyProduct: 116 alone is 舞台劇, 205-only (neither) is undefined — plain concert, no run grouping", () => {
  const idsByCategory = { musical: new Set(), drama: new Set(["B"]), concert: new Set(["C"]) };
  assert.equal(classifyProduct(idsByCategory, "B"), "舞台劇");
  assert.equal(classifyProduct(idsByCategory, "C"), undefined);
});

test("collectEligibleIds real case (年代 2026《再一次！唱歌旅行去》十週年親子演唱會, checked 2026-09-26): a product listed in BOTH 戲劇(116) and 親子(129) is excluded", () => {
  const idsByCategory = { concert: new Set(), musical: new Set(), drama: new Set(["P19I4966", "OTHER"]), kids: new Set(["P19I4966"]) };
  const eligible = collectEligibleIds(idsByCategory);
  assert.deepEqual(eligible.sort(), ["OTHER"]);
});

test("collectEligibleIds: a product with no kids overlap at all is kept", () => {
  const idsByCategory = { concert: new Set(["A"]), musical: new Set(), drama: new Set(), kids: new Set() };
  assert.deepEqual(collectEligibleIds(idsByCategory), ["A"]);
});

test("normalize()+sessionToRawEvent real case (寬宏《WILD WILD》, checked 2026-09-25): three different venues resolve to their real cities — 台中/高雄/台北", () => {
  const artistsYml = loadArtists();
  const cases = [
    ["Legacy Taichung 傳 音樂展演空間 / 台中市西屯區安和路117號", "台中"],
    ["高雄LIVE WAREHOUSE / 高雄市鹽埕區大義街2之5號駁二藝術特區大義C10倉庫(輕軌駁二大義)", "高雄"],
    ["信義劇場 Legacy MAX / 台北市信義區松壽路11號6樓(捷運市政府站)", "台北"],
  ];
  for (const [venueRaw, expectedCity] of cases) {
    const raw = {
      raw_id: "x", url: "https://x", title_raw: "test", venue_raw: venueRaw, date_raw: "2026-11-21 15:00",
      tickets_raw: [{ name: "4280", price: 4280, closed: false, waiting: false }], register_status: "IN_STOCK", source_name: "寬宏",
    };
    const { event } = normalize(raw, artistsYml);
    assert.equal(event.city, expectedCity, venueRaw);
  }
});
