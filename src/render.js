import { splitDate, formatOnSaleCountdown, formatOnSaleDateTime, daysUntil } from "./format.js";
import { upcomingSessions } from "./runs.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ARROW_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const STAR_OUTLINE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.5l1-5.8L3.5 9.6l5.9-.8Z"/></svg>`;
const STAR_FILLED = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.5l1-5.8L3.5 9.6l5.9-.8Z"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>`;

/**
 * 2026-09-21: first only reverted to the raw title for 音樂祭-tagged shows
 * ("2026 FIREBALL Fest. 火球祭" was showing as just "火球祭", throwing away
 * the year/English name/venue-day suffix — see that day's HANDOFF entry).
 * 2026-09-22 real bug (Max, Chevon pre.Yoshinani 〜Nomadic Edition〜: "這場是
 * 專場，而Yoshinani是巡迴標題...你這樣簡寫就造成你自己判斷失誤了對吧"):
 * the same failure mode wasn't specific to festivals — `matchArtists()`
 * false-matched "Yoshinani" (a tour-concept name, "Chevon pre.[tour name]",
 * not a second performer) as a second headliner purely because a bogus
 * "Yoshinani" entry existed in artists.yml, and collapsing the card to just
 * the matched names ("Chevon / Yoshinani") threw away the actual tour
 * title AND masked the classification being wrong (拼盤 instead of 專場,
 * see data/artists.yml's fix removing that entry). Headliner-matching is
 * still useful for exclude rules and tags_origin — this just stops treating
 * "the names we managed to match" as trustworthy enough to show as truth.
 * Always show the scraped title as-is now — simplest, and immune to this
 * whole bug class by construction, not by chasing down every bad match.
 */
export function displayTitle(event) {
  return event.title_raw;
}

// "YYYY-MM-DD" -> "M/D", same no-leading-zero convention splitDate() already
// uses for a card's own date badge.
function shortDate(isoDate) {
  const [, m, d] = isoDate.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * A theater/musical run's (PLAN-1-theater-runs.md) "🎭 檔期 …" line, or null
 * for a plain single-session event — including a run that's down to its
 * last upcoming performance, which should look exactly like an ordinary
 * card, not "檔期 10/25–10/25・共 1 場".
 */
function runSessionsLine(event) {
  if (!event.sessions) return null;
  const upcoming = upcomingSessions(event);
  if (upcoming.length <= 1) return null;
  const first = upcoming[0].date;
  const last = upcoming[upcoming.length - 1].date;
  return `🎭 檔期 ${shortDate(first)}–${shortDate(last)}・共 ${upcoming.length} 場`;
}

/**
 * Renders one event card as an HTML string, matching the markup in styles/main.css.
 * `pinned` doubles as "is favorited" — filter.js only sets it true for events
 * that are in prefs.favorites (SPEC §6 short-circuit).
 * `mode: "favorites"` swaps the star+✕ pair for a single unfavorite star and
 * adds a "距今 N 天" line (favorites.html, US-07) instead of the exclude menu.
 */
export function renderEventCard(event, { pinned = false, mode = "timeline", showNewBadge = false } = {}) {
  const { day, month, weekday } = splitDate(event.date);

  const tags = [
    ...event.tags_type.map((t) => `<span class="tag-perf">${escapeHtml(t)}</span>`),
    ...event.tags_origin.map((t) => `<span class="tag-origin">${escapeHtml(t)}</span>`),
  ].join("");

  // 2026-09-22 (Max: "如果你還沒確定票價和演出時間的，不要寫未公布，就空白
  // 就好" — writing "時間未公布"/"票價未公布" states it as a checked fact
  // ("we looked, it isn't announced") when really it just means the scraper
  // didn't find it on this pass; showing nothing is honest about that
  // instead of implying more certainty than there is. 📍/🕐 prefixes replace
  // the old "·"-joined venue/city/time blob so the two kinds of information
  // (where vs. when) read as distinct fields instead of one run-on line.
  const locationText = [event.venue, event.city].filter(Boolean).map(escapeHtml).join(" · ");
  const sessionsLine = runSessionsLine(event);
  // A multi-session run's own time is just its NEXT show, not the only one —
  // "下一場" says that instead of implying this is the whole story.
  const timeLabel = sessionsLine ? `下一場 ${event.time}` : event.time;
  const metaText = event.time
    ? `📍 ${locationText}　🕐 ${escapeHtml(timeLabel)}`
    : `📍 ${locationText}`;

  // A "announced but not yet on sale" event previously only got a badge when
  // the exact on-sale date was known (rare, on_sale_at was always null until
  // parseOnSaleAt() was wired up today) — Max: "有一些表演目前是尚未開賣...
  // 卡片設計上可以做出一些區別". Now it always gets a badge, with the
  // countdown layered on top when the date is actually known.
  // 2026-09-22 (Max: "但我想要知道的預售準確的時間" — "1 天後" alone doesn't
  // say WHEN, just how far off): show the actual date/time first, countdown
  // second as a quick-scan add-on, not a replacement for it.
  const onSaleCountdown = event.status === "announced" ? formatOnSaleCountdown(event.on_sale_at) : null;
  const onSaleDateTime = event.status === "announced" ? formatOnSaleDateTime(event.on_sale_at) : null;
  const onSaleBadge =
    event.status === "announced"
      ? `<span class="badge-onsale">⏱ ${onSaleDateTime ? `${escapeHtml(onSaleDateTime)} 開賣${onSaleCountdown ? `・${escapeHtml(onSaleCountdown)}` : ""}` : "尚未開賣"}</span>`
      : "";

  // 2026-09-22 (Max: "是否可以多做一個提醒使用者要買票的機制"): only makes
  // sense once there's an actual on_sale_at to put in the reminder — a
  // "尚未開賣" badge with no known date has nothing to set an alarm for.
  // Downloads a single-event .ics with a VALARM (see src/ics.js) rather than
  // a server-pushed notification — this is a static site with no backend
  // capable of firing something at a future moment on its own, but the
  // user's own OS/calendar app already does exactly that once it's holding
  // the event.
  const remindButton =
    event.status === "announced" && event.on_sale_at
      ? `<button class="btn-remind" type="button" data-remind-ics="${escapeHtml(event.id)}" data-remind-title="${escapeHtml(displayTitle(event))}" data-remind-venue="${escapeHtml(locationText)}" data-remind-onsale="${escapeHtml(event.on_sale_at)}" data-remind-url="${escapeHtml(event.ticket_url ?? "")}">🔔 開賣提醒加入行事曆</button>`
      : "";

  // 2026-09-22 (Max, MAHIRU: "有些場次的票券是要用登記的...如果你抓到是有寫
  // 的，請標上") — dedup.mjs's mergeGroup() sets this true when ANY of the
  // merged listings for this show mentioned a lottery-signup mechanism (登記
  // 抽選), even on events where the plain/general-sale listing correctly won
  // the card's title and link.
  const lotteryBadge = event.is_lottery ? `<span class="badge-lottery">🎟️ 需登記抽選</span>` : "";

  const pinnedBadge = mode === "timeline" && pinned ? `<span class="badge-pinned">已收藏，忽略排除規則</span>` : "";
  const daysUntilLine =
    mode === "favorites" ? `<div style="font-size:12px;font-weight:700;color:var(--coral-ink);">距今 ${daysUntil(event.date)} 天</div>` : "";
  const newBadge = showNewBadge ? `<span class="badge-new">新</span>` : "";
  const updatedBadge =
    mode === "favorites" && event.updated_fields?.length ? `<span class="badge-updated">已更新</span>` : "";

  // 2026-09-23 (Max, 岡崎體育場次真的是因為取消才沒在賣票，不是單純賣光):
  // `status === "sold_out"` covers both "actually sold out" and "sales
  // closed for some other reason (cancellation, etc.)" — the data has no
  // reliable way to tell those two apart (see statusFromTickets/
  // SOLD_OUT_TEXT_RE), so the label says "結束販售" (sales ended), not
  // "已售完" (sold out) — accurate either way instead of asserting a
  // specific reason the data doesn't actually know.
  let priceLine;
  if (event.status === "sold_out") {
    priceLine = `<div class="event-price muted">結束販售</div>`;
  } else {
    const sourceNames = [...new Set(event.sources.map((s) => s.name))].join(" · ");
    priceLine =
      event.price_min != null
        ? `<div class="event-price">NT$${event.price_min.toLocaleString()} up <span class="muted">· ${escapeHtml(sourceNames)}</span></div>`
        : `<div class="event-price muted">${escapeHtml(sourceNames)}</div>`;
  }
  // Sold out still gets the link — the external page is still worth reaching
  // (resale, waitlists, checking for a newly added date) even once the
  // primary sale is over; only the label changes to stop implying you can
  // still buy a ticket there.
  const ctaLabel = event.status === "on_sale" ? "購票" : event.status === "sold_out" ? "結束販售，查看頁面" : "查看頁面";
  const ctaButton = `<button class="pill-arrow" aria-label="${ctaLabel}" data-ticket-url="${escapeHtml(event.ticket_url)}">${ARROW_ICON}</button>`;

  const actionButtons =
    mode === "favorites"
      ? `<button class="icon-circle" style="width:28px;height:28px;background:var(--coral-bg);color:var(--coral);" aria-label="取消收藏" data-favorite-toggle="${escapeHtml(event.id)}">${STAR_FILLED}</button>`
      : `<button class="icon-circle" style="width:26px;height:26px;background:transparent;color:${pinned ? "var(--coral)" : "var(--border-strong)"};" aria-label="收藏" data-favorite-toggle="${escapeHtml(event.id)}">${pinned ? STAR_FILLED : STAR_OUTLINE}</button>
         <button class="icon-circle" style="width:26px;height:26px;background:transparent;color:var(--border-strong);" aria-label="排除選單" data-exclude-menu="${escapeHtml(event.id)}">${X_ICON}</button>`;

  return `
    <div class="event-card${event.status === "sold_out" ? " event-card--muted" : ""}" data-event-id="${escapeHtml(event.id)}">
      <div class="event-date">
        <div class="event-date__day">${month}/${day}</div>
        <div class="event-date__weekday">${weekday}</div>
      </div>
      <div class="event-body">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${newBadge}
            <div class="event-title">${escapeHtml(displayTitle(event))}</div>
            ${updatedBadge}
          </div>
          <div style="display:flex;gap:2px;flex:0 0 auto;">
            ${actionButtons}
          </div>
        </div>
        ${daysUntilLine}
        ${tags ? `<div class="tag-row">${tags}</div>` : ""}
        ${pinnedBadge}
        ${
          mode === "favorites" && event.updated_fields?.length
            ? `<a href="#" style="font-size:12px;font-weight:700;" data-updated-fields="${escapeHtml(event.updated_fields.join("、"))}">查看變更內容 →</a>`
            : ""
        }
        ${sessionsLine ? `<div class="event-meta">${sessionsLine}</div>` : ""}
        <div class="event-meta">${metaText}</div>
        ${onSaleBadge}
        ${remindButton}
        ${lotteryBadge}
        ${priceLine}
      </div>
      ${ctaButton}
    </div>
  `;
}

/** Renders the full date-grouped list (array of {dateLabel, cards: [{event, pinned}]}). */
export function renderEventList(groups) {
  return groups
    .map(
      (group) => `
    <div class="day-group">
      <div class="day-label">${escapeHtml(group.dateLabel)}</div>
      ${group.cards.map(({ event, pinned }) => renderEventCard(event, { pinned })).join("")}
    </div>
  `
    )
    .join("");
}

/** Flat, date-sorted list (no day-group headers) — used by favorites.html. */
export function renderFavoritesList(items) {
  return items.map((event) => renderEventCard(event, { pinned: true, mode: "favorites" })).join("");
}

/** new.html (FR-23): 今天新增 / 過去 7 天 sections, each event tagged with the 新 badge. */
export function renderNewArrivalsList(todayItems, pastWeekItems) {
  const section = (label, items) =>
    items.length === 0
      ? ""
      : `
    <div class="day-group">
      <div class="day-label">${escapeHtml(label)}</div>
      ${items.map(({ event, pinned }) => renderEventCard(event, { pinned, showNewBadge: true })).join("")}
    </div>
  `;
  return section("今天新增", todayItems) + section("過去 7 天", pastWeekItems);
}

export function renderEmptyList(message) {
  return `<div style="padding:32px 4px;text-align:center;color:var(--muted);font-size:13px;">${escapeHtml(message)}</div>`;
}
