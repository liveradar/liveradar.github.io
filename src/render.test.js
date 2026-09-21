import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEventCard } from "./render.js";

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
  assert.match(html, /已售完，查看頁面/);
  assert.match(html, /已售完<\/div>/);
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
