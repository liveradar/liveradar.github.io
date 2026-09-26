import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShowSaleDate, gameSaleSignal, groupGamesIntoSessions, decodeHtmlEntities } from "./adapters/ibon.mjs";

// Real fields as fetched 2026-09-25 from ticket.ibon.com.tw's
// GetGameInfoList (see PLAN-2-ibon.md).
const KANA_BOON_GAME = {
  ShowSaleDate: "2026/11/15(日) 18:00\r\n",
  GameInfoName: "2026 KANA–BOON「CRITICAL HIT PARADE in TAIPEI」",
  VenueRegion: "Legacy Taipei",
  StartDT: "2026-08-14T12:00:00",
  EndDT: "2026-11-14T23:59:00",
  SoldOut: false,
  CanBuy: true,
};

test("parseShowSaleDate: a normal single showtime", () => {
  assert.deepEqual(parseShowSaleDate("2026/11/15(日) 18:00\r\n"), { date: "2026-11-15", time: "18:00", dateRaw: "2026-11-15 18:00" });
});

test("parseShowSaleDate real case (2026 第23屆 Taipei Toy Festival): an exhibition's date RANGE takes only the start date/time", () => {
  assert.deepEqual(parseShowSaleDate("2026/10/08(四) 10:00\r\n ~ 2026/10/11(日) 18:00"), {
    date: "2026-10-08",
    time: "10:00",
    dateRaw: "2026-10-08 10:00",
  });
});

test("parseShowSaleDate: unparseable input returns null", () => {
  assert.equal(parseShowSaleDate(""), null);
  assert.equal(parseShowSaleDate(undefined), null);
});

const NOW = Date.parse("2026-09-25T12:00:00+08:00");

test("gameSaleSignal real case (山岡晃 Akira Yamaoka, SUB LIVE): SoldOut true is SOLD_OUT regardless of CanBuy", () => {
  const game = { SoldOut: true, CanBuy: false, StartDT: "2026-08-21T12:00:00", EndDT: null };
  assert.deepEqual(gameSaleSignal(game, NOW), { sale_signal: "SOLD_OUT", on_sale_at: null });
});

test("gameSaleSignal real case (MAMAMOO 2026 WORLD TOUR, 開賣前): CanBuy false + StartDT in the future is COMING_SOON with that start time as on_sale_at", () => {
  const game = { SoldOut: false, CanBuy: false, StartDT: "2026-09-26T11:00:00", EndDT: null };
  assert.deepEqual(gameSaleSignal(game, NOW), { sale_signal: "COMING_SOON", on_sale_at: "2026-09-26T11:00:00+08:00" });
});

test("gameSaleSignal real case (KANA-BOON, 開賣中): past StartDT, before EndDT, CanBuy true is IN_STOCK", () => {
  assert.deepEqual(gameSaleSignal(KANA_BOON_GAME, NOW), { sale_signal: "IN_STOCK", on_sale_at: null });
});

test("gameSaleSignal: past EndDT (registration window closed) is REGISTRATION_CLOSED even if CanBuy is still true", () => {
  const game = { SoldOut: false, CanBuy: true, StartDT: "2026-01-01T00:00:00", EndDT: "2026-09-01T00:00:00" };
  assert.deepEqual(gameSaleSignal(game, NOW), { sale_signal: "REGISTRATION_CLOSED", on_sale_at: null });
});

test("gameSaleSignal: within the sale window but CanBuy false and no EndDT reports no signal at all", () => {
  const game = { SoldOut: false, CanBuy: false, StartDT: "2026-01-01T00:00:00", EndDT: null };
  assert.deepEqual(gameSaleSignal(game, NOW), { sale_signal: null, on_sale_at: null });
});

test("groupGamesIntoSessions real case (BANG YONGGUK, CORNER MAX): 4 games at the SAME (date+time, venue) merge into ONE session", () => {
  const games = [
    { ShowSaleDate: "2026/10/18(日) 18:30\r\n", VenueRegion: "CORNER MAX", StartDT: "2026-08-17T12:00:00", EndDT: null, SoldOut: false, CanBuy: true },
    { ShowSaleDate: "2026/10/18(日) 18:30\r\n", VenueRegion: "CORNER MAX", StartDT: "2026-08-21T12:00:00", EndDT: null, SoldOut: false, CanBuy: true },
    { ShowSaleDate: "2026/10/18(日) 18:30\r\n", VenueRegion: "CORNER MAX", StartDT: "2026-08-21T12:00:00", EndDT: null, SoldOut: false, CanBuy: true },
    { ShowSaleDate: "2026/10/18(日) 18:30\r\n", VenueRegion: "CORNER MAX", StartDT: "2026-08-21T12:00:00", EndDT: null, SoldOut: false, CanBuy: true },
  ];
  const sessions = groupGamesIntoSessions(games, NOW);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].parsed.date, "2026-10-18");
  assert.equal(sessions[0].venue, "CORNER MAX");
});

test("groupGamesIntoSessions real case (藤本洸大粉絲見面會 in 臺北): 午場/晚場 are DIFFERENT times, so they stay 2 separate sessions", () => {
  const games = [
    { ShowSaleDate: "2026/12/06(日) 12:00\r\n", GameInfoName: "藤本洸大粉絲見面會 in 臺北（午場）", VenueRegion: "花漾展演空間–HANASPACE", StartDT: "2026-09-11T17:00:00", EndDT: "2026-12-06T12:00:00", SoldOut: false, CanBuy: true },
    { ShowSaleDate: "2026/12/06(日) 17:00\r\n", GameInfoName: "藤本洸大粉絲見面會 in 臺北（晚場）", VenueRegion: "花漾展演空間–HANASPACE", StartDT: "2026-09-11T17:00:00", EndDT: "2026-12-06T17:00:00", SoldOut: false, CanBuy: true },
  ];
  const sessions = groupGamesIntoSessions(games, NOW);
  assert.equal(sessions.length, 2);
  assert.deepEqual(
    sessions.map((s) => s.parsed.time).sort(),
    ["12:00", "17:00"],
  );
});

test("groupGamesIntoSessions: one SoldOut game + one CanBuy game for the same session -> combined signal is IN_STOCK (the still-buyable tier wins)", () => {
  const games = [
    { ShowSaleDate: "2026/11/15(日) 18:00\r\n", VenueRegion: "Legacy Taipei", StartDT: "2026-08-14T12:00:00", EndDT: null, SoldOut: true, CanBuy: false },
    { ShowSaleDate: "2026/11/15(日) 18:00\r\n", VenueRegion: "Legacy Taipei", StartDT: "2026-08-14T12:00:00", EndDT: null, SoldOut: false, CanBuy: true },
  ];
  const sessions = groupGamesIntoSessions(games, NOW);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].signal.sale_signal, "IN_STOCK");
});

test("groupGamesIntoSessions: a game whose ShowSaleDate doesn't parse is skipped, not thrown", () => {
  const games = [{ ShowSaleDate: "", VenueRegion: "X", StartDT: null, EndDT: null, SoldOut: false, CanBuy: true }, KANA_BOON_GAME];
  const sessions = groupGamesIntoSessions(games, NOW);
  assert.equal(sessions.length, 1);
});

test("decodeHtmlEntities: ibon's ActivityContent is HTML-escaped ONCE on top of being HTML — decodes back to real tags", () => {
  assert.equal(decodeHtmlEntities("&lt;p&gt;票價｜&lt;/p&gt;"), "<p>票價｜</p>");
  assert.equal(decodeHtmlEntities("A &amp; B &quot;quoted&quot; &#39;single&#39;"), 'A & B "quoted" \'single\'');
});
