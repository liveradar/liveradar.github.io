/**
 * Shared "is this still on sale?" vocabulary for re-checking ALREADY-KNOWN
 * events, across all adapters.
 *
 * 2026-09-24: every adapter's incremental fetch reused a known event's
 * previous normalized data wholesale — status included — so an event that
 * sold out, got cancelled, or opened for sale AFTER LiveRadar first saw it
 * never changed status again. KKTIX got a re-check first (register_info,
 * then JSON-LD); on 9/24 the other four platforms still had 207 on_sale
 * events nobody had looked at since discovery. Each adapter now reports a
 * cheap per-event signal for known events (see each adapter's known-event
 * branch), in register_info's own vocabulary so there's one mapping to
 * status, here:
 *   SOLD_OUT | REGISTRATION_CLOSED  -> sold_out (or ended, once the date passed)
 *   IN_STOCK                        -> on_sale
 *   COMING_SOON                     -> announced
 *   null                            -> no signal; keep the previous status
 */
import { taiwanTodayDateStr } from "./normalize.mjs";

/**
 * A ticket row's status text meaning "can't buy this tier any more".
 * 2026-09-24 real bug: tixcraft's and iNDIEVOX's own copies of this were an
 * exact-phrase list (選購一空|銷售一空|完售|售罄|截止) that missed "已售完" —
 * found on Stray Kids' real purchase page, whose first row says exactly that.
 * Same structural pattern normalize.mjs's SOLD_OUT_TEXT_RE switched to after
 * the 岡崎體育 "銷售截止" miss, plus bare 截止 (tixcraft rows read
 * "2026/09/19 12:00 截止").
 */
export const TICKET_TERMINAL_TEXT_RE = /(?:銷售|選購|販售|售票|登記)(?:一空|截止|結束)|售完|完售|售罄|停售|截止/;

/**
 * Whether a known event's status can still change in a way worth a request.
 * Skips events already sold out/ended (nothing to learn) and announced events
 * whose on-sale date is still in the future (can't have sold out yet).
 */
export function needsStatusCheck(previous, todayStr = taiwanTodayDateStr()) {
  if (!previous) return true;
  if (previous.status === "sold_out" || previous.status === "ended") return false;
  if (previous.status === "announced" && previous.on_sale_at && previous.on_sale_at.slice(0, 10) > todayStr) return false;
  return true;
}

/**
 * Schema.org `offers[]` (KKTIX event pages, FANSI GO ticket pages) -> signal.
 * Verified 2026-09-24 against 22 KKTIX events of known status (22/22 match).
 */
export function saleStatusFromOffers(offers, nowMs = Date.now()) {
  if (!Array.isArray(offers) || offers.length === 0) return null;
  const ts = (s) => (s ? Date.parse(s) : NaN);
  const inStock = offers.filter((o) => /InStock|LimitedAvailability|PreSale|PreOrder/i.test(o.availability ?? ""));
  if (inStock.length === 0) return "SOLD_OUT";
  const stillOpen = inStock.filter((o) => !(ts(o.validThrough) < nowMs));
  if (stillOpen.length === 0) return "REGISTRATION_CLOSED";
  if (stillOpen.every((o) => ts(o.validFrom) > nowMs)) return "COMING_SOON";
  return "IN_STOCK";
}

// 2026-09-25 real bug (HANDOFF 9/24 待辦第4項: a merged card's daily recheck
// only ever looked at event.sources[0]'s signal — if that happens to be a
// VIP-only tier that's sold out while a plain-GA tier (sources[1]) still has
// tickets, the whole card gets wrongly marked sold_out, or the reverse if
// sources[0] is the one still open). A merged card can carry a fresh signal
// per source this run (each raw_id checked independently), so they need
// combining, not picking just the first — same priority resolveFromChildEvents
// already uses for KKTIX group pages: any listing still on sale wins outright,
// otherwise any still-upcoming wins, only sold_out when every known signal
// agrees there's nothing left to buy. A source with no signal this run
// doesn't count against the others.
const SIGNAL_RANK = { IN_STOCK: 0, COMING_SOON: 1, SOLD_OUT: 2, REGISTRATION_CLOSED: 2 };

/**
 * @param {{sale_signal: string|null, on_sale_at?: string|null}[]} signals - one entry per source this run had a signal for (skip sources with none)
 * @returns {{sale_signal: string, on_sale_at: string|null}|null} the best (most optimistic) signal, or null if none of the sources had one
 */
export function combineSaleSignals(signals) {
  let best = null;
  for (const s of signals) {
    if (!s || s.sale_signal == null) continue;
    if (!best || SIGNAL_RANK[s.sale_signal] < SIGNAL_RANK[best.sale_signal]) best = s;
  }
  return best;
}

/**
 * The status/on_sale_at a reused event should have given a fresh signal, or
 * null if nothing changes. With no signal, an "announced" event whose on-sale
 * time has already passed is still promoted to on_sale — found 2026-09-24
 * (TAKASE TOYA 11/08 still showed 尚未開賣 a day after its sale started), and
 * true for every platform regardless of whether it has a status signal.
 */
export function refreshedStatus(event, signal, signalOnSaleAt = null, nowMs = Date.now(), todayStr = taiwanTodayDateStr()) {
  let next = null;
  // 2026-09-25 real bug (Max: "都沒東西要修嗎" — 逐一查資料才發現，不是回報
  // 的）：找到 7 場日期已經過去、但 status 還停在 on_sale 的已知場次。前端
  // isPast() 會獨立擋掉過期場次，目前不會顯示在畫面上，不是使用者看得到
  // 的 bug，但底層資料本身是錯的，而且指出這個函式原本完全沒有「日期過了
  // 就該轉成 ended」這條規則——只在 SOLD_OUT/REGISTRATION_CLOSED 訊號分支
  // 裡順便算過（`event.date >= todayStr ? "sold_out" : "ended"`），一旦
  // 訊號查詢失敗（例如被 Cloudflare 擋）或壓根沒有訊號，status 就會永遠停
  // 在舊值，直到哪天訊號剛好查到為止。改成日期優先判斷、不依賴任何訊號：
  // 只要已知場次的日期已經過去，一律轉成 ended，不管這次有沒有查到訊號、
  // 訊號說了什麼。放在最前面，其餘分支因此保證只會在日期還沒到時才跑到。
  if (event.date < todayStr) {
    next = { status: "ended", on_sale_at: null };
  } else if (signal === "SOLD_OUT" || signal === "REGISTRATION_CLOSED") {
    next = { status: "sold_out", on_sale_at: null };
  } else if (signal === "IN_STOCK") {
    next = { status: "on_sale", on_sale_at: null };
  } else if (signal === "COMING_SOON") {
    next = { status: "announced", on_sale_at: signalOnSaleAt ?? event.on_sale_at ?? null };
  } else if (event.status === "announced" && event.on_sale_at && Date.parse(event.on_sale_at) <= nowMs) {
    next = { status: "on_sale", on_sale_at: null };
  }
  if (!next) return null;
  if (next.status === event.status && next.on_sale_at === (event.on_sale_at ?? null)) return null;
  return next;
}
