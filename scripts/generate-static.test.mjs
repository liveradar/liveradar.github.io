import test from "node:test";
import assert from "node:assert/strict";
import { eventJsonLd, eventPage, schedulePage, sitemap } from "./generate-static.mjs";

const base = {
  id: "abc", title_raw: "A <b>&</b> Tour", headliners: ["A"], venue: "V", city: "台北", date: "2026-12-17", time: "20:00",
  price_min: 1000, status: "on_sale", ticket_url: "https://t/x", sources: [{ name: "拓元" }], tags_type: [], tags_origin: [],
  updated_at: "2026-11-01T00:00:00Z", on_sale_at: null,
};

test("offers: availability by status, none when price unknown or ended", () => {
  assert.equal(eventJsonLd(base).offers.availability, "https://schema.org/InStock");
  assert.equal(eventJsonLd({ ...base, status: "sold_out" }).offers.availability, "https://schema.org/SoldOut");
  const ann = eventJsonLd({ ...base, status: "announced", on_sale_at: "2026-11-20T12:00:00+08:00" }).offers;
  assert.equal(ann.availability, "https://schema.org/PreOrder");
  assert.equal(ann.validFrom, "2026-11-20T12:00:00+08:00");
  assert.equal(eventJsonLd({ ...base, price_min: null }).offers, undefined);
  assert.equal(eventJsonLd({ ...base, status: "ended" }).offers, undefined);
});

test("startDate carries +08:00 and unknown city has no addressLocality", () => {
  assert.equal(eventJsonLd(base).startDate, "2026-12-17T20:00:00+08:00");
  assert.equal(eventJsonLd({ ...base, city: "未知" }).location.address.addressLocality, undefined);
});

test("html and JSON-LD escape title", () => {
  const html = eventPage(base, null);
  assert.ok(!html.includes("<b>&</b>"));
  assert.ok(html.includes("A &lt;b&gt;&amp;&lt;/b&gt; Tour"));
  assert.ok(!/<script[^>]*>[^]*<b>[^]*<\/script>/.test(html));
});

test("schedule and sitemap list every event, deterministically", () => {
  const evs = [base, { ...base, id: "zzz", date: "2027-01-02" }];
  assert.equal(schedulePage(evs), schedulePage([...evs].reverse()));
  assert.equal(sitemap(evs), sitemap([...evs].reverse()));
  assert.ok(sitemap(evs).includes("/e/abc.html") && sitemap(evs).includes("/e/zzz.html"));
});
