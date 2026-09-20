import { splitDate, formatOnSaleCountdown, daysUntil } from "./format.js";

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

  const timeText = event.time ? `${escapeHtml(event.time)}` : "時間未公布";
  const metaText = `${escapeHtml(event.venue)} · ${escapeHtml(event.city)} · ${timeText}`;

  const onSaleCountdown = event.status === "announced" ? formatOnSaleCountdown(event.on_sale_at) : null;
  const onSaleBadge = onSaleCountdown
    ? `<span class="badge-onsale">⏱ 即將開賣・${escapeHtml(onSaleCountdown)}</span>`
    : "";

  const pinnedBadge = mode === "timeline" && pinned ? `<span class="badge-pinned">已收藏，忽略排除規則</span>` : "";
  const daysUntilLine =
    mode === "favorites" ? `<div style="font-size:12px;font-weight:700;color:var(--coral-ink);">距今 ${daysUntil(event.date)} 天</div>` : "";
  const newBadge = showNewBadge ? `<span class="badge-new">新</span>` : "";
  const updatedBadge =
    mode === "favorites" && event.updated_fields?.length ? `<span class="badge-updated">已更新</span>` : "";

  let priceLine;
  if (event.status === "sold_out") {
    priceLine = `<div class="event-price muted">已售完</div>`;
  } else {
    const priceText = event.price_min != null ? `NT$${event.price_min.toLocaleString()} up` : "票價未公布";
    const sourceNames = [...new Set(event.sources.map((s) => s.name))].join(" · ");
    priceLine = `<div class="event-price">${priceText} <span class="muted">· ${escapeHtml(sourceNames)}</span></div>`;
  }
  // Sold out still gets the link — the external page is still worth reaching
  // (resale, waitlists, checking for a newly added date) even once the
  // primary sale is over; only the label changes to stop implying you can
  // still buy a ticket there.
  const ctaLabel = event.status === "on_sale" ? "購票" : event.status === "sold_out" ? "已售完，查看頁面" : "查看頁面";
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
            <div class="event-title">${escapeHtml(event.headliners.join(" / "))}</div>
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
        <div class="event-meta">${metaText}</div>
        ${onSaleBadge}
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
