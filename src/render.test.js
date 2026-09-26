import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEventCard, displayTitle } from "./render.js";

function makeEvent(overrides = {}) {
  return {
    id: "abc123",
    title_raw: "深海系樂團 Live",
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    is_festival: false,
    venue: "Legacy Taipei",
    city: "台北",
    date: "2026-10-15",
    time: "19:30",
    on_sale_at: null,
    price_min: 800,
    price_max: 800,
    status: "on_sale",
    tags_type: ["專場"],
    tags_origin: ["本地"],
    ticket_url: "https://example.com/a",
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
    first_seen_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("renderEventCard: a sold-out event still renders the ticket link, just with a different label", () => {
  const html = renderEventCard(makeEvent({ status: "sold_out" }));
  assert.match(html, /data-ticket-url="https:\/\/example\.com\/a"/);
  assert.match(html, /結束販售，查看頁面/);
  assert.match(html, /結束販售<\/div>/);
});

test("renderEventCard: on_sale shows the 購票 label", () => {
  const html = renderEventCard(makeEvent({ status: "on_sale" }));
  assert.match(html, /aria-label="購票"/);
  assert.match(html, /data-ticket-url="https:\/\/example\.com\/a"/);
});

test("renderEventCard: announced (not yet on sale) shows the 查看頁面 label, not 購票", () => {
  const html = renderEventCard(makeEvent({ status: "announced" }));
  assert.match(html, /aria-label="查看頁面"/);
  assert.match(html, /data-ticket-url="https:\/\/example\.com\/a"/);
});

test("renderEventCard: an unrecognized artist (headliners: []) falls back to the raw scraped title instead of rendering blank (real bug found alongside the D15 reversal)", () => {
  const html = renderEventCard(makeEvent({ headliners: [], lineup: [], title_raw: "Age Factory Release Tour 2026 Taipei" }));
  assert.match(html, /event-title">Age Factory Release Tour 2026 Taipei</);
});

test("displayTitle: a 音樂祭-tagged event shows the full raw title, not just the matched festival-brand headliner (real bug: '2026 FIREBALL Fest. 火球祭' showed as just '火球祭' — 火球祭 is registered in artists.yml purely to make guessTagsType() recognize the brand, not as a real performer)", () => {
  const event = makeEvent({
    title_raw: "2026 FIREBALL Fest. 火球祭",
    headliners: ["火球祭"],
    lineup: ["火球祭"],
    tags_type: ["音樂祭"],
  });
  assert.equal(displayTitle(event), "2026 FIREBALL Fest. 火球祭");
});

test("displayTitle: a normal recognized artist ALSO shows the raw title now, not just the matched headliner(s) (2026-09-22 reversal, Max: \"你顯示的名稱不用少，直接把那個演出的標題同步顯示就好，你這樣簡寫就造成你自己判斷失誤了對吧\" — a real case, Chevon pre.Yoshinani, had a bogus second headliner match that both mislabeled the card AND masked a misclassified tags_type)", () => {
  const event = makeEvent({ title_raw: "【Legacy Presents】深海系樂團", headliners: ["深海系樂團"], tags_type: ["專場"] });
  assert.equal(displayTitle(event), "【Legacy Presents】深海系樂團");
});

test("renderEventCard: a missing time is left out entirely, not shown as '時間未公布' (Max: writing that states it as a checked fact rather than a scraper gap)", () => {
  const html = renderEventCard(makeEvent({ time: null }));
  assert.doesNotMatch(html, /未公布/);
  assert.match(html, /📍 Legacy Taipei · 台北</);
});

test("renderEventCard: a missing price is left out entirely, not shown as '票價未公布' — the source name still shows so there's something to click through to", () => {
  const html = renderEventCard(makeEvent({ price_min: null, price_max: null }));
  assert.doesNotMatch(html, /未公布/);
  assert.match(html, /event-price muted">KKTIX</);
});

test("renderEventCard: an 'announced' (not yet on sale) event always gets a badge, even with no known on_sale_at — real gap Max flagged (\"有一些表演目前是尚未開賣...卡片設計上可以做出一些區別\")", () => {
  const html = renderEventCard(makeEvent({ status: "announced", on_sale_at: null }));
  assert.match(html, /badge-onsale">⏱ 尚未開賣</);
});

test("renderEventCard: an 'announced' event WITH a known on_sale_at shows the exact date/time plus the countdown, not just \"即將開賣\" (Max: \"但我想要知道的預售準確的時間\" — the countdown alone doesn't say WHEN)", () => {
  const html = renderEventCard(makeEvent({ status: "announced", on_sale_at: "2099-01-01T12:00:00+08:00" }));
  assert.match(html, /badge-onsale">⏱ 1\/1 12:00 開賣・/);
});

test("renderEventCard: 'announced' event WITH a known on_sale_at gets the 開賣提醒加入行事曆 button (Max: \"是否可以多做一個提醒使用者要買票的機制\")", () => {
  const html = renderEventCard(makeEvent({ status: "announced", on_sale_at: "2099-01-01T12:00:00+08:00" }));
  assert.match(html, /data-remind-ics="/);
});

test("renderEventCard: 'announced' event with NO known on_sale_at does not get the reminder button — there's no date to put in the calendar entry", () => {
  const html = renderEventCard(makeEvent({ status: "announced", on_sale_at: null }));
  assert.doesNotMatch(html, /data-remind-ics="/);
});

test("renderEventCard: an on_sale event does not get the reminder button — the reminder is for buying before it goes on sale, not after", () => {
  const html = renderEventCard(makeEvent({ status: "on_sale", on_sale_at: "2020-01-01T12:00:00+08:00" }));
  assert.doesNotMatch(html, /data-remind-ics="/);
});

test("renderEventCard: is_lottery shows a distinct badge (Max, MAHIRU: \"有些場次的票券是要用登記的...如果你抓到是有寫的，請標上\")", () => {
  const html = renderEventCard(makeEvent({ is_lottery: true }));
  assert.match(html, /badge-lottery">🎟️ 需登記抽選</);
});

test("renderEventCard: no lottery badge when is_lottery is false/undefined", () => {
  const html = renderEventCard(makeEvent({ is_lottery: false }));
  assert.doesNotMatch(html, /badge-lottery/);
});

test("renderEventCard (PLAN-1-theater-runs.md): a theater run with multiple upcoming sessions shows the 檔期 line and '下一場' time label", () => {
  const run = makeEvent({
    title_raw: "《神隱少女》舞台劇",
    tags_type: ["舞台劇"],
    date: "2099-10-24",
    time: "14:30",
    sessions: [
      { date: "2099-10-24", time: "14:30", status: "on_sale" },
      { date: "2099-10-30", time: "19:30", status: "on_sale" },
      { date: "2099-11-10", time: "14:30", status: "on_sale" },
    ],
  });
  const html = renderEventCard(run);
  assert.match(html, /🎭 檔期 10\/24–11\/10・共 3 場/);
  assert.match(html, /🕐 下一場 14:30/);
});

test("renderEventCard: a theater run down to its LAST upcoming session looks like an ordinary card — no 檔期 line, no '下一場' prefix", () => {
  const run = makeEvent({
    title_raw: "《神隱少女》舞台劇",
    tags_type: ["舞台劇"],
    date: "2099-11-10",
    time: "14:30",
    sessions: [
      { date: "2020-01-01", time: "14:30", status: "ended" }, // already past
      { date: "2099-11-10", time: "14:30", status: "on_sale" }, // the one remaining upcoming session
    ],
  });
  const html = renderEventCard(run);
  assert.doesNotMatch(html, /🎭 檔期/);
  assert.doesNotMatch(html, /下一場/);
  assert.match(html, /🕐 14:30/);
});
