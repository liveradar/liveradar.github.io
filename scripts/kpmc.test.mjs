import { test } from "node:test";
import assert from "node:assert/strict";
import { extractItems, isWaveTowerConcert, toDateRaw, parsePriceLines, itemToRawEvent } from "./adapters/kpmc.mjs";
import { normalize } from "./normalize.mjs";

// Real shapes fetched 2026-10-30 from kpmc.com.tw/program/ (months with no
// shows are null; titles carry HTML entities).
const LIST_HTML = `<script>var items={"Jan":[],"Feb":null,"Oct":[{"desc":"Chill &#038; High","id":1,"performer":"x","date_time":"10.30 (Fri) 20:00","location":"音浪塔 高音塔","link":"https:\\/\\/kpmc.com.tw\\/program\\/a\\/","show_category":134,"year":"2026","state":"normal"},{"desc":"展覽 {not json}","id":2,"date_time":"10.31 (Sat) 10:00","location":"音浪塔 高音塔","link":"x","show_category":136,"year":"2026","state":"normal"}]};var other=1;</script>`;

const WAVE_TOWER = { desc: "新世代拉丁爵⼠聲響｜Dan Costa Quartet", id: 17000, date_time: "10.30 (Fri) 20:00", location: "音浪塔 高音塔", link: "https://kpmc.com.tw/program/dan-costa/", show_category: 134, year: "2026", state: "normal" };

const detailHtml = (...lines) =>
  `<div class="m-single-info__item"><p class="m-single-info__title">場地</p><p class="m-single-info__paragraph">音浪塔</p></div>
   <div class="m-single-info__item"><p class="m-single-info__title">票價資訊</p>${lines.map((l) => `<p class="m-single-info__paragraph">${l}</p>`).join("")}</div>`;

test("extractItems reads the embedded catalog, nulls and all", () => {
  const items = extractItems(LIST_HTML);
  assert.equal(items.Feb, null);
  assert.equal(items.Oct.length, 2);
  assert.equal(items.Oct[1].desc, "展覽 {not json}"); // a brace inside a string must not end the scan
  assert.equal(extractItems("<html></html>"), null);
});

test("only 音浪塔 concerts (category 134) are kept", () => {
  assert.equal(isWaveTowerConcert(WAVE_TOWER), true);
  assert.equal(isWaveTowerConcert({ ...WAVE_TOWER, show_category: 136 }), false); // 展覽
  assert.equal(isWaveTowerConcert({ ...WAVE_TOWER, show_category: 142 }), false); // Open Jam / 市集
  assert.equal(isWaveTowerConcert({ ...WAVE_TOWER, location: "LIVE WAREHOUSE 小庫" }), false); // covered by iNDIEVOX etc.
  assert.equal(isWaveTowerConcert({ ...WAVE_TOWER, location: "音浪塔 2F" }), true);
});

test("toDateRaw uses the item's own year (Jan 2027 shows live in the same list)", () => {
  assert.equal(toDateRaw(WAVE_TOWER), "2026-10-30 20:00");
  assert.equal(toDateRaw({ date_time: "01.09 (Sat) 18:00", year: "2027" }), "2027-01-09 18:00");
  assert.equal(toDateRaw({ date_time: "", year: "2026" }), null);
  assert.equal(toDateRaw({ date_time: "10.30 (Fri) 20:00", year: "" }), null);
});

test("parsePriceLines reads only the 票價資訊 block", () => {
  assert.deepEqual(parsePriceLines(detailHtml("單人500元", "現場收費")), ["單人500元", "現場收費"]);
  assert.deepEqual(parsePriceLines("<p>nothing</p>"), []);
});

test("itemToRawEvent drops the 含…元 voucher so it can't become price_min", () => {
  const raw = itemToRawEvent({ ...WAVE_TOWER, desc: "Chill &#038; High" }, ["單人700元", "門票含100元餐飲抵用券", "現場收費"]);
  assert.equal(raw.title_raw, "Chill & High");
  assert.equal(raw.price_text_raw, "票價：單人700元 現場收費");
  assert.equal(itemToRawEvent({ ...WAVE_TOWER }, ["單人400元 含150元午茶飲品"]).price_text_raw, "票價：單人400元");
});

test("itemToRawEvent drops 雙人 (price for two) so it can't become price_max", () => {
  assert.equal(itemToRawEvent(WAVE_TOWER, ["單人500元", "雙人900元", "現場收費"]).price_text_raw, "票價：單人500元 現場收費");
});

test("sold-out state maps to SOLD_OUT; otherwise no signal", () => {
  assert.equal(itemToRawEvent({ ...WAVE_TOWER, state: "soldout" }, []).register_status, "SOLD_OUT");
  assert.equal(itemToRawEvent(WAVE_TOWER, []).register_status, null);
  assert.equal(itemToRawEvent({ ...WAVE_TOWER, date_time: "" }, []), null);
});

test("end to end through normalize: 高雄 city, price range, on_sale, 音浪塔 venue", () => {
  const raw = itemToRawEvent(WAVE_TOWER, ["單人500元", "雙人900元", "現場收費"]);
  const { event } = normalize(raw, [], []);
  assert.equal(event.city, "高雄");
  assert.equal(event.venue, "音浪塔 高音塔");
  assert.equal(event.date, "2026-10-30");
  assert.equal(event.time, "20:00");
  assert.equal(event.price_min, 500);
  assert.equal(event.price_max, 500);
  assert.equal(event.status, "on_sale");
});
