import { test } from "node:test";
import assert from "node:assert/strict";
import { computeId, dedupe } from "./dedup.mjs";

function makeEvent(overrides = {}) {
  return {
    title_raw: "Test Event",
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
    is_lottery: false,
    ticket_url: "https://example.com/a",
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
    first_seen_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("computeId is stable for the same headliner/date/venue", () => {
  const id1 = computeId("深海系樂團", "2026-10-15", "Legacy Taipei");
  const id2 = computeId("深海系樂團", "2026-10-15", "Legacy Taipei");
  assert.equal(id1, id2);
});

test("computeId ignores whitespace/case differences (normalization)", () => {
  const id1 = computeId("ABC Band", "2026-10-15", "The Wall");
  const id2 = computeId(" abc band ", "2026-10-15", "the wall");
  assert.equal(id1, id2);
});

test("AC-12: same event from two sources merges into one, keeping both source links", () => {
  const fromKktix = makeEvent({
    sources: [{ name: "KKTIX", url: "https://kktix.example/a", raw_id: "a" }],
    ticket_url: "https://kktix.example/a",
  });
  const fromTixcraft = makeEvent({
    sources: [{ name: "拓元", url: "https://tixcraft.example/b", raw_id: "b" }],
    ticket_url: "https://tixcraft.example/b",
  });

  const result = dedupe([fromKktix, fromTixcraft]);

  assert.equal(result.length, 1, "must collapse to a single event");
  assert.equal(result[0].sources.length, 2, "must keep both original source links (AC-12)");
  // KKTIX has priority 1, 拓元 priority 2 — ticket_url must prefer the higher-priority source.
  assert.equal(result[0].ticket_url, "https://kktix.example/a");
});

test("AC-12 negative: same venue/day, different headliners must NOT merge", () => {
  const earlyShow = makeEvent({
    headliners: ["樂團甲"],
    lineup: ["樂團甲"],
    time: "14:00",
    sources: [{ name: "KKTIX", url: "https://example.com/early", raw_id: "early" }],
  });
  const lateShow = makeEvent({
    headliners: ["樂團乙"],
    lineup: ["樂團乙"],
    time: "20:00",
    sources: [{ name: "KKTIX", url: "https://example.com/late", raw_id: "late" }],
  });

  const result = dedupe([earlyShow, lateShow]);

  assert.equal(result.length, 2, "different headliners on the same day/venue must stay separate");
});

test("AC-12 negative (the real risk, SPEC §4.1): SAME headliner, same venue/day, matinee + evening must NOT merge", () => {
  const matinee = makeEvent({
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    time: "14:00",
    title_raw: "深海系樂團 午場",
    sources: [{ name: "KKTIX", url: "https://example.com/matinee", raw_id: "matinee" }],
  });
  const evening = makeEvent({
    headliners: ["深海系樂團"],
    lineup: ["深海系樂團"],
    time: "20:00",
    title_raw: "深海系樂團 晚場",
    sources: [{ name: "KKTIX", url: "https://example.com/evening", raw_id: "evening" }],
  });

  const result = dedupe([matinee, evening]);

  assert.equal(
    result.length,
    2,
    "same artist playing an afternoon AND evening show the same day at the same venue must stay two separate events, not collapse into one"
  );
});

test("dedupe unions lineup, tags_type and tags_origin across merged sources", () => {
  const a = makeEvent({
    lineup: ["深海系樂團", "配角甲"],
    tags_type: ["拼盤"],
    tags_origin: ["本地"],
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
  });
  const b = makeEvent({
    lineup: ["深海系樂團", "配角乙"],
    tags_type: ["拼盤"],
    tags_origin: ["亞洲其他"],
    sources: [{ name: "拓元", url: "https://example.com/b", raw_id: "b" }],
  });

  const [merged] = dedupe([a, b]);

  assert.deepEqual(new Set(merged.lineup), new Set(["深海系樂團", "配角甲", "配角乙"]));
  assert.deepEqual(new Set(merged.tags_origin), new Set(["本地", "亞洲其他"]));
});

test("mergeGroup fix: price_max is merged across sources, not just price_min", () => {
  const fromKktix = makeEvent({
    price_min: 800,
    price_max: 3800,
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
  });
  const fromTixcraft = makeEvent({
    price_min: null,
    price_max: null, // 拓元's listing-only scrape never has price data
    sources: [{ name: "拓元", url: "https://example.com/b", raw_id: "b" }],
  });

  const [merged] = dedupe([fromTixcraft, fromKktix]); // tixcraft processed first

  assert.equal(merged.price_min, 800);
  assert.equal(merged.price_max, 3800, "price_max must pick up KKTIX's value even though it merged second");
});

test("mergeGroup real bug (Max, MAHIRU: \"你卡片內的連結還連錯不同場次\"): a special-purpose listing (VIP addon lottery signup) scraped FIRST must not win the merged ticket_url/title over a plain on-sale listing scraped later", () => {
  const vipLottery = makeEvent({
    title_raw: "MAHIRU ONE-MAN LIVE 2027 in Zepp New Taipei VIP PASS限量加購 登記抽選",
    ticket_url: "https://ticketplus.com.tw/activity/vip",
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/vip", raw_id: "vip" }],
  });
  const plain = makeEvent({
    title_raw: "MAHIRU ONE-MAN LIVE 2027 in Zepp New Taipei",
    ticket_url: "https://ticketplus.com.tw/activity/plain",
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/plain", raw_id: "plain" }],
  });
  const lotteryOnly = makeEvent({
    title_raw: "MAHIRU ONE-MAN LIVE 2027 in Zepp New Taipei 登記抽選",
    ticket_url: "https://ticketplus.com.tw/activity/lottery",
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/lottery", raw_id: "lottery" }],
  });

  const [merged] = dedupe([vipLottery, plain, lotteryOnly]);

  assert.equal(merged.title_raw, "MAHIRU ONE-MAN LIVE 2027 in Zepp New Taipei");
  assert.equal(merged.ticket_url, "https://ticketplus.com.tw/activity/plain");
  assert.equal(merged.sources.length, 3, "all three real listings are still kept as sources");
});

test("mergeGroup: is_lottery comes from the WINNING (base) listing only — normalize.mjs computes it per-listing, dedup.mjs just propagates whichever one wins the title/url", () => {
  const plain = makeEvent({
    title_raw: "MAHIRU ONE-MAN LIVE 2027 in Zepp New Taipei",
    // normalize.mjs already determined THIS listing's own general-ticket sale
    // itself requires lottery registration (real case: its sale-time section
    // lists 登記抽選 as the first phase, with general sale only "視情況").
    is_lottery: true,
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/plain", raw_id: "plain" }],
  });
  const lotteryOnly = makeEvent({
    title_raw: "MAHIRU ONE-MAN LIVE 2027 in Zepp New Taipei 登記抽選",
    is_lottery: true,
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/lottery", raw_id: "lottery" }],
  });

  const [merged] = dedupe([plain, lotteryOnly]);
  assert.equal(merged.is_lottery, true);
});

test("mergeGroup real bug (Max, 音田雅則: \"需登記抽選這個...是VIP PASS 加購才要登記抽選 這種特殊就不用管了 需登記抽選的標籤只適用於全部票券都要抽選的\"): a VIP-only lottery sibling listing must NOT flip is_lottery to true when the winning plain listing's own general-ticket sale doesn't require it", () => {
  const plain = makeEvent({
    title_raw: "音田雅則 One Man Tour 2026 “Hiraeth” in Taipei",
    // normalize.mjs determined: this listing's own text offers an
    // unconditional general sale date, with 登記抽選 only ever mentioned in a
    // VIP-PASS-addon context — so this listing itself is false.
    is_lottery: false,
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/plain", raw_id: "plain" }],
  });
  const vipLottery = makeEvent({
    title_raw: "音田雅則 One Man Tour 2026 “Hiraeth” in Taipei VIP PASS加購 登記抽選",
    // this sibling's OWN title contains "VIP" so normalize.mjs also reports
    // false for it specifically — it's a real listing, just not the general
    // ticket path, and (before this fix) used to be the thing that made the
    // OLD "true if ANY listing mentions it" rule wrongly flag the whole card.
    is_lottery: false,
    sources: [{ name: "Ticket Plus", url: "https://ticketplus.com.tw/activity/vip", raw_id: "vip" }],
  });

  const [merged] = dedupe([plain, vipLottery]);
  assert.equal(merged.is_lottery, false);
});

test("mergeGroup: an ordinary event with no lottery-signup listing anywhere reports is_lottery: false", () => {
  const [merged] = dedupe([makeEvent({})]);
  assert.equal(merged.is_lottery, false);
});

test("mergeGroup real bug (羊文学 10/24@高雄: register_info correctly caught the show going SOLD_OUT, but the merged card still showed on_sale): when two same-source listings tie on listingRank, the one that actually has real price data wins base over a decorative info-only listing with no ticket data of its own", () => {
  const infoOnly = makeEvent({
    title_raw: "羊文学 Hitsujibungaku TOUR 2026",
    price_min: null,
    price_max: null,
    status: "on_sale", // stale/default — this listing never had its own ticket table to derive a real status from
    sources: [{ name: "KKTIX", url: "https://baodaorecords.kktix.cc/events/ff315f99", raw_id: "ff315f99" }],
  });
  const realTicketPage = makeEvent({
    title_raw: "【10/24】羊文学 Hitsujibungaku TOUR 2026",
    price_min: 1100,
    price_max: 2200,
    status: "sold_out", // the freshly re-fetched, register_info-confirmed real status
    sources: [{ name: "KKTIX", url: "https://baodaorecords.kktix.cc/events/58eae147", raw_id: "58eae147" }],
  });

  // Order matters for reproducing the original bug (array-order tiebreak
  // used to just take whichever came first) — put the decorative listing
  // first, the way the adapter happened to return it that day.
  const [merged] = dedupe([infoOnly, realTicketPage]);
  assert.equal(merged.status, "sold_out");
  assert.equal(merged.price_min, 1100);
});

test("dedupe real bug (HANDOFF 9/24 待辦第4項: Disney in Concert 13:00 場 and 16:30 場 merged into one card): two showtimes 210 minutes apart both read as the day/evening 'day' bucket under the old single-cutoff split, so they wrongly merged — must stay two separate events", () => {
  const early = makeEvent({
    title_raw: "【13:00】《Disney in Concert: Once Upon a Time》",
    time: "13:00",
    sources: [{ name: "KKTIX", url: "https://example.com/early", raw_id: "early" }],
  });
  const late = makeEvent({
    title_raw: "【16:30】《Disney in Concert: Once Upon a Time》",
    time: "16:30",
    sources: [{ name: "KKTIX", url: "https://example.com/late", raw_id: "late" }],
  });

  const result = dedupe([early, late]);

  assert.equal(result.length, 2, "13:00 and 16:30 are different showtimes, not one event");
  assert.notEqual(result[0].id, result[1].id);
});

test("dedupe: two reported times close together (same show, one platform reports door time vs start time) still merge into one event", () => {
  const startTime = makeEvent({
    time: "19:30",
    sources: [{ name: "KKTIX", url: "https://example.com/a", raw_id: "a" }],
  });
  const doorTime = makeEvent({
    time: "19:00", // 30 min apart — well within TIME_CLUSTER_GAP_MINUTES
    sources: [{ name: "拓元", url: "https://example.com/b", raw_id: "b" }],
  });

  const result = dedupe([startTime, doorTime]);

  assert.equal(result.length, 1, "same show reported 30 minutes apart across platforms must still merge");
});

test("dedupe: id stability — a show with only ONE reported time (the common case) gets the exact same id scheme as before the clustering fix, not a new time-based suffix", () => {
  const single = makeEvent({ time: "19:30" });
  const [result] = dedupe([single]);
  assert.equal(result.id, computeId("深海系樂團", "2026-10-15", "Legacy Taipei"), "single-time groups must keep the plain baseId, no suffix");
});

test("dedupe: id stability — an already-correct matinee/evening split (6 hours apart) still gets the old '-day'/'-evening' suffix, not a time-based one, so existing favorites/exclusions keyed by id don't silently break", () => {
  const matinee = makeEvent({ time: "14:00", sources: [{ name: "KKTIX", url: "https://example.com/m", raw_id: "m" }] });
  const evening = makeEvent({ time: "20:00", sources: [{ name: "KKTIX", url: "https://example.com/e", raw_id: "e" }] });
  const [a, b] = dedupe([matinee, evening]).sort((x, y) => (x.time < y.time ? -1 : 1));
  const baseId = computeId("深海系樂團", "2026-10-15", "Legacy Taipei");
  assert.equal(a.id, `${baseId}-day`);
  assert.equal(b.id, `${baseId}-evening`);
});
