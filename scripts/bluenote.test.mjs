import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEvents, cleanTitle, parsePriceText, eventToRawEvent } from "./adapters/bluenote.mjs";
import { normalize } from "./normalize.mjs";

// Shape captured 2026-10-30 from bluenotetaipei.com/shows (Wix embeds each
// event object in the static HTML; the "𝖡𝖺𝗅𝖺𝗇𝖼𝖾𝖽" title is the real styled-Unicode one).
const EVENT = {
  id: "abc-1",
  location: { name: "Blue Note Taipei 台北藍調", address: "10647台湾台北市大安區羅斯福路三段171號4F" },
  scheduling: { config: { startDate: "2026-10-30T13:30:00.000Z", timeZoneId: "Asia/Taipei" } },
  title: "台北藍調 週五特演 𝖡𝖺𝗅𝖺𝗇𝖼𝖾𝖽 爵士樂團 | 𝟣𝟢𝟥𝟢",
  about: "",
  slug: "tai-bei-lan-diao-zhou-wu-te-yan-jue-shi-le-tuan",
  status: 0,
};
const page = (...events) => `<script>window.x=[${events.map((e) => JSON.stringify(e)).join(",")}]</script>`;

test("extractEvents finds each embedded event once, braces in strings and all", () => {
  const tricky = { ...EVENT, id: "abc-2", slug: "s2", title: "a } b { c" };
  const found = extractEvents(page(EVENT, tricky) + page(EVENT)); // same event twice -> once
  assert.deepEqual(found.map((e) => e.id).sort(), ["abc-1", "abc-2"]);
  assert.equal(found.find((e) => e.id === "abc-2").title, "a } b { c");
  assert.deepEqual(extractEvents("<html></html>"), []);
});

test("cleanTitle undoes styled Unicode and drops the trailing date code", () => {
  assert.equal(cleanTitle(EVENT.title), "台北藍調 週五特演 Balanced 爵士樂團");
  assert.equal(cleanTitle("台北藍調 週六特演 烏野薰四重奏 𝐊𝐔𝐐 | 𝐄𝐯𝐞𝐫𝐲 𝐒𝐚𝐭𝐮𝐫𝐝𝐚𝐲"), "台北藍調 週六特演 烏野薰四重奏 KUQ | Every Saturday");
  assert.equal(cleanTitle("首週週日特演 MWQ | Every 1st Sunday 1101"), "首週週日特演 MWQ | Every 1st Sunday");
  // only an MMDD code after a space/pipe goes — a trailing year or glued digits stay
  assert.equal(cleanTitle("Jazz Night 2026"), "Jazz Night 2026");
  assert.equal(cleanTitle("Quartet Vol1030"), "Quartet Vol1030");
});

test("parsePriceText takes the first paragraph that has an NT$ amount", () => {
  const html = `<p data-ricos-paragraph="a"><span>歡迎</span></p>
    <p data-ricos-paragraph="b"><span>NT$550 入場費含一份選定飲料</span></p>
    <p data-ricos-paragraph="c"><span>BOGO NT$100</span></p>`;
  assert.equal(parsePriceText(html), "票價：NT$550 入場費含一份選定飲料");
  assert.equal(parsePriceText("<p data-ricos-paragraph='a'>no price</p>"), "");
});

test("eventToRawEvent: Taiwan time, show URL, and only scheduled shows", () => {
  const raw = eventToRawEvent(EVENT, "票價：NT$550");
  assert.equal(raw.date_raw, "2026-10-30 21:30"); // 13:30Z
  assert.equal(raw.url, "https://www.bluenotetaipei.com/events/tai-bei-lan-diao-zhou-wu-te-yan-jue-shi-le-tuan");
  assert.equal(raw.raw_id, "abc-1_202610302130"); // date in the id: a recurring show keeps one id
  assert.equal(eventToRawEvent({ ...EVENT, status: 1 }, ""), null);
  const bad = { ...EVENT, scheduling: { config: { startDate: "nope" } } };
  assert.equal(eventToRawEvent(bad, ""), null);
});

test("end to end through normalize: 台北 city, NT$ price, on_sale", () => {
  const { event } = normalize(eventToRawEvent(EVENT, "票價：NT$550 入場費含一份選定飲料"), [], []);
  assert.equal(event.city, "台北");
  assert.equal(event.venue, "Blue Note Taipei 台北藍調");
  assert.equal(event.date, "2026-10-30");
  assert.equal(event.time, "21:30");
  assert.equal(event.price_min, 550);
  assert.equal(event.status, "on_sale");
});
