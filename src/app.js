/**
 * Shared entry point loaded by every page. Each page marks its own root
 * container with a data-page attribute; this file only acts on the ones it
 * knows how to render, so it's safe to load on every page unconditionally.
 *
 * M4: 時間表 (index.html) reads data/events.json for real.
 * M5: favorites + exclude rules (US-06~14) — star/✕ on cards, the exclude
 *   bottom-sheet, undo toast, block-confirmation dialog (FR-48), 已隱藏管理.
 * M6: 新上架 (new.html) reads first_seen_at (via diff.mjs's reconciliation in
 *   events.json) instead of a separate digest fetch — digest.json exists for
 *   the pipeline's own bookkeeping, but the frontend only needs what's
 *   already on each event. Also wires FR-34's "已更新" badge on favorites,
 *   now that diff.mjs actually sets updated_fields.
 * M7: 手動新增場次 (add.html) actually saves to localStorage and shows up
 *   everywhere else — loadEvents() merges in state.js's manual events,
 *   dropping any whose id a real scrape has since produced (AC-17).
 * M8: 待整理頁 (review.html) reads data/needs-review.json for real. "指派
 *   藝人"/"忽略" never write artists.yml themselves (there's no backend to
 *   write to) — they generate a YAML snippet for the user to paste in by
 *   hand and commit, and locally dismiss the item from the queue.
 * M9: Gist 同步 (settings.html) + FR-63/64 匯出/匯入. Every page that reads
 *   prefs calls reconcileGistSync() before its first render so a change made
 *   on another device shows up on load, not just after a manual settings-page
 *   visit.
 * M10: 設定頁來源狀態儀表讀 data/sources.json；時間表在有來源異常時顯示警示
 *   banner（FR-14/62, AC-14）。實際的告警（開 GitHub issue）在 pipeline 端
 *   （scripts/notify.mjs），前端只負責把 sources.json 的 status 顯示出來。
 * 2026-09-20 (current): Gist 同步整個換成 Supabase 帳號登入——貼 GitHub PAT
 *   對一般使用者太技術性。原本一起做了 email/密碼登入，但 Supabase 免費方案
 *   寄出的驗證信用共用網域、無法客製內容，容易被誤認成詐騙信，所以拿掉了，
 *   只留 Google 登入（Google 本身就是身分驗證，完全不涉及 Supabase 寄信）。
 *   呼叫時機不變：reconcileSupabaseSync() 一樣在每個讀 prefs 的頁面初次渲染前呼叫一次；
 *   登入是加分項不是門檻，沒登入時完全 no-op，跟以前沒連 Gist 時一樣。
 */

import { partitionEvents, isPast } from "./filter.js";
import {
  loadPrefs,
  savePrefs,
  toggleFavorite,
  excludeEvent,
  unexcludeEvent,
  excludeArtist,
  unexcludeArtist,
  excludeType,
  unexcludeType,
  countFavoritedByArtist,
  countHiddenByArtist,
  countHiddenByType,
  loadManualEvents,
  addManualEvent,
  loadReviewDismissed,
  dismissReviewItem,
  reconcileSupabaseSync,
  exportPrefsAsJson,
  importPrefsFromJson,
  loadViewFilters,
  saveViewFilters,
  loadFavView,
  saveFavView,
  loadTheme,
  saveTheme,
} from "./state.js";
import { getSession, signInWithGoogle, signOut, reportIssue } from "./supabase.js";
import { buildOnSaleReminderIcs } from "./ics.js";
import { renderEventList, renderFavoritesList, renderNewArrivalsList, renderEmptyList, displayTitle } from "./render.js";
import { splitDate, daysSince } from "./format.js";
import { buildMonthGrid, addMonths } from "./calendar.js";
import {
  openExcludeMenu,
  confirmBlockArtist,
  showUndoToast,
  openAssignArtistDialog,
  showYamlSnippetDialog,
  openFilterSheet,
  openReportDialog,
  openIntroDialog,
} from "./interactions.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadEvents() {
  // no-store: events.json is overwritten daily by the Actions job (SPEC §4.2);
  // without this, a browser tab left open — or even just repeat navigations
  // within the same session — can keep serving a stale cached copy (caught
  // during M7 testing: a newly-scraped event didn't replace its manual
  // stand-in until this was added).
  const res = await fetch("./data/events.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET data/events.json -> ${res.status}`);
  const data = await res.json();
  const realEvents = data.events ?? [];
  const realIds = new Set(realEvents.map((e) => e.id));
  // AC-17: once a real scrape produces a matching id, the manual copy is
  // dropped. Check every id a future scrape of this show could produce
  // (possible_real_ids), not just the manual event's own bare id — a show
  // that turns out to have both a matinee and evening real listing gets
  // bucket-suffixed ids from dedup.mjs that the manual copy must also match.
  const manualEvents = loadManualEvents().filter((e) => {
    const candidates = e.possible_real_ids ?? [e.id];
    return !candidates.some((id) => realIds.has(id));
  });
  return [...realEvents, ...manualEvents];
}

function groupByDate(items) {
  const groups = [];
  for (const item of items) {
    const { groupLabel } = splitDate(item.event.date);
    let group = groups.find((g) => g.dateLabel === groupLabel);
    if (!group) {
      group = { dateLabel: groupLabel, cards: [] };
      groups.push(group);
    }
    group.cards.push(item);
  }
  return groups;
}

function updateHiddenBar(hiddenByRules) {
  const bar = document.getElementById("hidden-bar");
  const count = document.getElementById("hidden-count");
  if (!bar || !count) return;
  if (hiddenByRules > 0) {
    count.textContent = String(hiddenByRules);
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

// Canonical order shared with data/venues.yml's coverage — just for a
// sensible, stable chip order, not a source of truth for which cities exist.
const CITY_DISPLAY_ORDER = [
  "台北", "新北", "桃園", "新竹", "苗栗", "台中", "彰化", "南投",
  "雲林", "嘉義", "台南", "高雄", "屏東", "宜蘭", "花蓮", "台東",
  "澎湖", "金門", "連江",
];
const PRICE_PRESETS = [500, 1000, 2000, 3000];
// Fixed display order, same spirit as CITY_DISPLAY_ORDER above — not every
// value necessarily exists in the current data, filtered down per-call.
const TYPE_DISPLAY_ORDER = ["專場", "拼盤", "音樂祭", "見面會", "簽唱會", "音樂劇", "巡迴", "古典"];
// 2026-09-23 (Max: "日韓分類可以分開成日本韓國兩個類別"): split what used
// to be one combined "日韓" bucket into separate 日本/韓國 filter chips —
// every artists.yml entry that was tagged 日韓 got individually
// reclassified (WebSearch-verified per artist), not just a find-and-replace
// on the category label.
const ORIGIN_DISPLAY_ORDER = ["本地", "日本", "韓國", "歐美", "亞洲其他"];

// Options are built from upcoming events only — an already-ended event's
// month/city would otherwise show up as a selectable chip option that's
// guaranteed to render an empty list (isPast() always excludes it downstream
// in filter.js, regardless of which view filter is chosen).
function cityFilterOptions(events) {
  const upcoming = events.filter((e) => !isPast(e.date));
  const present = new Set(upcoming.map((e) => e.city).filter(Boolean));
  const ordered = CITY_DISPLAY_ORDER.filter((c) => present.has(c));
  if (present.has("未知")) ordered.push("未知");
  return [{ label: "全部城市", value: null }, ...ordered.map((c) => ({ label: c, value: c }))];
}

function monthFilterOptions(events) {
  const upcoming = events.filter((e) => !isPast(e.date));
  const months = Array.from(new Set(upcoming.map((e) => e.date.slice(0, 7)))).sort();
  return [
    { label: "全部月份", value: null },
    ...months.map((m) => ({ label: `${m.slice(0, 4)} 年 ${Number(m.slice(5))}月`, value: m })),
  ];
}

function priceFilterOptions() {
  return [
    { label: "不限價格", value: null },
    ...PRICE_PRESETS.map((p) => ({ label: `NT$${p.toLocaleString()} 以下`, value: p })),
  ];
}

function typeFilterOptions(events) {
  const upcoming = events.filter((e) => !isPast(e.date));
  const present = new Set(upcoming.flatMap((e) => e.tags_type));
  const ordered = TYPE_DISPLAY_ORDER.filter((t) => present.has(t));
  return [{ label: "全部類型", value: null }, ...ordered.map((t) => ({ label: t, value: t }))];
}

function originFilterOptions(events) {
  const upcoming = events.filter((e) => !isPast(e.date));
  const present = new Set(upcoming.flatMap((e) => e.tags_origin));
  const ordered = ORIGIN_DISPLAY_ORDER.filter((o) => present.has(o));
  return [{ label: "全部地區", value: null }, ...ordered.map((o) => ({ label: o, value: o }))];
}

/**
 * Wires the timeline's 全部城市/全部月份/價格 chips (SPEC §6) to
 * openFilterSheet, once — these chips live in the static page-header, not
 * inside the re-rendered event-list container, so they're wired outside
 * render() and read the current filters via getFilters() instead of being
 * recreated each render.
 */
function wireViewFilterChips(events, getFilters, onChange) {
  const cityChip = document.querySelector('[data-filter="city"]');
  const monthChip = document.querySelector('[data-filter="month"]');
  const typeChip = document.querySelector('[data-filter="type"]');
  const originChip = document.querySelector('[data-filter="origin"]');
  const priceChip = document.querySelector('[data-filter="price"]');
  if (!cityChip || !monthChip || !priceChip) return;

  function refreshLabels() {
    const f = getFilters();
    cityChip.textContent = f.city ?? "全部城市";
    cityChip.setAttribute("aria-pressed", String(!!f.city));
    const monthOpt = monthFilterOptions(events).find((o) => o.value === (f.month ?? null));
    monthChip.textContent = f.month ? (monthOpt?.label ?? f.month) : "全部月份";
    monthChip.setAttribute("aria-pressed", String(!!f.month));
    if (typeChip) {
      typeChip.textContent = f.type ?? "全部類型";
      typeChip.setAttribute("aria-pressed", String(!!f.type));
    }
    if (originChip) {
      originChip.textContent = f.origin ?? "音樂人地區";
      originChip.setAttribute("aria-pressed", String(!!f.origin));
    }
    priceChip.textContent = f.priceMax != null ? `NT$${f.priceMax.toLocaleString()} 以下` : "價格";
    priceChip.setAttribute("aria-pressed", String(f.priceMax != null));
  }

  cityChip.addEventListener("click", () => {
    openFilterSheet("篩選城市", cityFilterOptions(events), getFilters().city ?? null, (value) => {
      onChange({ ...getFilters(), city: value });
      refreshLabels();
    });
  });
  monthChip.addEventListener("click", () => {
    openFilterSheet("篩選月份", monthFilterOptions(events), getFilters().month ?? null, (value) => {
      onChange({ ...getFilters(), month: value });
      refreshLabels();
    });
  });
  typeChip?.addEventListener("click", () => {
    openFilterSheet("篩選類型", typeFilterOptions(events), getFilters().type ?? null, (value) => {
      onChange({ ...getFilters(), type: value });
      refreshLabels();
    });
  });
  originChip?.addEventListener("click", () => {
    openFilterSheet("篩選音樂人地區", originFilterOptions(events), getFilters().origin ?? null, (value) => {
      onChange({ ...getFilters(), origin: value });
      refreshLabels();
    });
  });
  priceChip.addEventListener("click", () => {
    openFilterSheet("篩選價格", priceFilterOptions(), getFilters().priceMax ?? null, (value) => {
      onChange({ ...getFilters(), priceMax: value });
      refreshLabels();
    });
  });

  refreshLabels();
}

/** 2026-09-22: replaces the old dismiss-forever intro card — a persistent ⓘ icon reachable any time (see openIntroDialog's doc comment). */
function wireIntroInfoButton() {
  const btn = document.getElementById("intro-info-btn");
  btn?.addEventListener("click", () => openIntroDialog());
}

/** FR-14/62, AC-14: warn on the timeline if any source's last run wasn't clean. Fire-and-forget — shouldn't block the main render. */
async function checkSourceWarning() {
  const bar = document.getElementById("source-warning-bar");
  if (!bar) return;
  try {
    const res = await fetch("./data/sources.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`GET data/sources.json -> ${res.status}`);
    const data = await res.json();
    const anomalous = (data.sources ?? []).filter((s) => s.status !== "ok");
    bar.hidden = anomalous.length === 0;
    if (anomalous.length > 0) {
      const text = document.getElementById("source-warning-text");
      if (text) text.textContent = `⚠ ${anomalous.map((s) => s.name).join("、")} 抓取異常，畫面資料可能不完整`;
    }
  } catch (err) {
    console.error("Failed to load sources.json:", err);
    // Not knowing the source status isn't itself an anomaly worth alarming
    // the user about — just leave the banner hidden.
  }
}

/** Only http(s) may be opened — escapeHtml stops attribute breakout, but never checked scheme, so a "javascript:" ticket_url (bad scrape, or an unvalidated manual entry) could otherwise execute on click. */
function isSafeUrl(url) {
  return /^https?:\/\//i.test(url);
}

function wireTicketButtons(container) {
  container.querySelectorAll("[data-ticket-url]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.ticketUrl;
      if (isSafeUrl(url)) window.open(url, "_blank", "noopener");
    });
  });
}

function wireRemindButtons(container) {
  container.querySelectorAll("[data-remind-ics]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ics = buildOnSaleReminderIcs({
        id: btn.dataset.remindIcs,
        title: btn.dataset.remindTitle,
        venue: btn.dataset.remindVenue,
        onSaleAt: btn.dataset.remindOnsale,
        ticketUrl: isSafeUrl(btn.dataset.remindUrl) ? btn.dataset.remindUrl : null,
      });
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `liveradar-開賣提醒-${btn.dataset.remindIcs}.ics`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

function wireFavoriteToggle(container, render) {
  container.querySelectorAll("[data-favorite-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleFavorite(btn.dataset.favoriteToggle);
      render();
    });
  });
}

/** Shared by 時間表 and 新上架 — both show the full ✕ exclude menu on cards. */
function wireExcludeMenu(container, events, render) {
  container.querySelectorAll("[data-exclude-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const event = events.find((e) => e.id === btn.dataset.excludeMenu);
      if (event) openMenuFor(event, events, render);
    });
  });
}

function openMenuFor(event, events, render) {
  const headliner = event.headliners[0] ?? event.title_raw;
  const type = event.tags_type[0];

  openExcludeMenu(event, {
    onHideEvent() {
      excludeEvent(event.id);
      render();
      showUndoToast(`已排除「${headliner}」`, () => {
        unexcludeEvent(event.id);
        render();
      });
    },
    onBlockArtist() {
      const doBlock = () => {
        excludeArtist(headliner);
        render();
        showUndoToast(`已封鎖演出者「${headliner}」`, () => {
          unexcludeArtist(headliner);
          render();
        });
      };
      const prefs = loadPrefs();
      const favoritedCount = countFavoritedByArtist(headliner, events, prefs);
      if (favoritedCount > 0) {
        confirmBlockArtist(headliner, favoritedCount, doBlock);
      } else {
        doBlock();
      }
    },
    onBlockType() {
      if (!type) return;
      excludeType(type);
      render();
      showUndoToast(`已封鎖類型「${type}」`, () => {
        unexcludeType(type);
        render();
      });
    },
    onReportIssue() {
      openReportDialog(event, async (description) => {
        try {
          await reportIssue({
            eventId: event.id,
            eventTitle: headliner,
            eventUrl: event.ticket_url,
            description,
          });
          alert("已送出，謝謝回報！");
        } catch (err) {
          console.error("Failed to submit report:", err);
          alert("回報失敗，請稍後再試。");
        }
      });
    },
  });
}

const ICON_SEARCH = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

/** index.html's search icon slides a filter input down in place instead of navigating to search.html (search.html stays as a shareable URL) — reuses initTimeline's already-loaded events rather than refetching. */
function wireInlineSearch(events, restoreRender) {
  const toggleBtn = document.getElementById("search-toggle-btn");
  const panel = document.getElementById("search-panel");
  const input = document.getElementById("inline-search-input");
  const container = document.getElementById("event-list");
  if (!toggleBtn || !panel || !input || !container) return;

  function renderSearch() {
    const query = input.value.trim();
    if (!query) {
      // 2026-09-21 real bug (Max): clearing the search box back to empty
      // left the "輸入藝人或標題開始搜尋" placeholder up instead of the full
      // timeline underneath — search.html (a standalone page with nothing
      // else to fall back to) correctly shows that placeholder for an empty
      // query, but this inline panel sits on top of an already-loaded
      // timeline, so an empty query should just restore it instead of
      // repeating a hint the input's own placeholder text already shows.
      restoreRender();
      return;
    }
    const prefs = loadPrefs();
    const { visible } = partitionEvents(events, prefs, {});
    const q = query.toLowerCase();
    const matches = visible.filter(
      ({ event }) => event.title_raw.toLowerCase().includes(q) || event.lineup.some((a) => a.toLowerCase().includes(q)),
    );
    matches.sort((a, b) => (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0));
    container.innerHTML =
      matches.length === 0
        ? renderEmptyList(`沒有符合「${query}」的場次。`)
        : renderEventList(groupByDate(matches));
    wireTicketButtons(container);
    wireRemindButtons(container);
    wireFavoriteToggle(container, renderSearch);
    wireExcludeMenu(container, events, renderSearch);
  }

  function openSearch() {
    panel.classList.add("search-panel--open");
    toggleBtn.setAttribute("aria-expanded", "true");
    toggleBtn.setAttribute("aria-label", "關閉搜尋");
    toggleBtn.innerHTML = ICON_CLOSE;
    input.value = "";
    input.focus();
    renderSearch();
  }

  function closeSearch() {
    panel.classList.remove("search-panel--open");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.setAttribute("aria-label", "搜尋");
    toggleBtn.innerHTML = ICON_SEARCH;
    restoreRender();
  }

  toggleBtn.addEventListener("click", () => {
    if (panel.classList.contains("search-panel--open")) closeSearch();
    else openSearch();
  });
  input.addEventListener("input", renderSearch);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("search-panel--open")) closeSearch();
  });
}

async function initTimeline(container) {
  let events;
  try {
    // Sequential, not Promise.all: loadEvents() reads manual events from
    // localStorage, and reconcileSupabaseSync() may just have overwritten them —
    // running them concurrently risks loadEvents() reading the stale copy.
    await reconcileSupabaseSync();
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  wireIntroInfoButton();
  checkSourceWarning();

  let viewFilters = loadViewFilters();

  function render() {
    const prefs = loadPrefs();
    const { visible, hiddenByRules } = partitionEvents(events, prefs, viewFilters);

    visible.sort((a, b) => {
      if (a.event.date !== b.event.date) return a.event.date < b.event.date ? -1 : 1;
      return (a.event.time ?? "99:99").localeCompare(b.event.time ?? "99:99");
    });

    container.innerHTML =
      visible.length === 0
        ? renderEmptyList("目前沒有符合條件的演出，明天再回來看看。")
        : renderEventList(groupByDate(visible));

    wireTicketButtons(container);
    wireRemindButtons(container);
    wireFavoriteToggle(container, render);
    wireExcludeMenu(container, events, render);
    updateHiddenBar(hiddenByRules);
  }

  wireViewFilterChips(
    events,
    () => viewFilters,
    (next) => {
      viewFilters = next;
      saveViewFilters(viewFilters);
      render();
    },
  );

  render();
  wireInlineSearch(events, render);
}

/** search.html:搜尋藝人或標題, filtered live as the user types. */
async function initSearch(container) {
  const input = document.getElementById("search-input");
  let events;
  try {
    await reconcileSupabaseSync();
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const query = input.value.trim();
    if (!query) {
      container.innerHTML = renderEmptyList("輸入藝人或標題開始搜尋。");
      return;
    }

    const prefs = loadPrefs();
    const { visible } = partitionEvents(events, prefs, {});
    const q = query.toLowerCase();
    const matches = visible.filter(
      ({ event }) => event.title_raw.toLowerCase().includes(q) || event.lineup.some((a) => a.toLowerCase().includes(q)),
    );
    matches.sort((a, b) => (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0));

    container.innerHTML =
      matches.length === 0
        ? renderEmptyList(`沒有符合「${query}」的場次。`)
        : renderEventList(groupByDate(matches));

    wireTicketButtons(container);
    wireRemindButtons(container);
    wireFavoriteToggle(container, render);
    wireExcludeMenu(container, events, render);
  }

  input.addEventListener("input", render);
  render();
}

async function initNewArrivals(container) {
  let events;
  try {
    await reconcileSupabaseSync();
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const prefs = loadPrefs();
    const { visible } = partitionEvents(events, prefs, {});

    const withAge = visible
      .map((item) => ({ ...item, ageDays: daysSince(item.event.first_seen_at) }))
      .filter((item) => item.ageDays <= 7);
    withAge.sort((a, b) => a.ageDays - b.ageDays);

    const today = withAge.filter((item) => item.ageDays <= 0);
    const pastWeek = withAge.filter((item) => item.ageDays > 0);

    const summary = document.getElementById("new-summary");
    if (summary) summary.textContent = `今日新增 ${today.length} 筆 · 近 7 日共 ${withAge.length} 筆`;

    container.innerHTML =
      withAge.length === 0
        ? renderEmptyList("最近 7 天沒有新場次公布。")
        : renderNewArrivalsList(today, pastWeek);

    wireTicketButtons(container);
    wireRemindButtons(container);
    wireFavoriteToggle(container, render);
    wireExcludeMenu(container, events, render);
  }

  render();
}

const CAL_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** Renders the month grid + (if a day is selected) that day's favorited events below it. */
function renderFavCalendar(calendarEl, favorited, view) {
  const byDate = new Map();
  for (const event of favorited) {
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }

  const weeks = buildMonthGrid(view.year, view.month);
  const todayIso = new Date().toISOString().slice(0, 10);

  const cellsHtml = weeks
    .map(
      (week) => `
    <div class="cal-week">
      ${week
        .map((cell) => {
          if (!cell) return `<div class="cal-cell cal-cell--empty"></div>`;
          const hasEvents = byDate.has(cell.date);
          const classes = [
            "cal-cell",
            cell.date === todayIso ? "cal-cell--today" : "",
            cell.date === view.selectedDate ? "cal-cell--selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<button type="button" class="${classes}" data-cal-date="${cell.date}" ${hasEvents ? "" : "disabled"}>
            <span class="cal-cell__day">${cell.day}</span>
            ${hasEvents ? `<span class="cal-cell__dot"></span>` : ""}
          </button>`;
        })
        .join("")}
    </div>`,
    )
    .join("");

  const selectedEvents = view.selectedDate ? (byDate.get(view.selectedDate) ?? []) : [];

  calendarEl.innerHTML = `
    <div class="cal-header">
      <button type="button" class="icon-btn" data-cal-nav="-1" aria-label="上個月">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <div class="cal-header__label">${view.year} 年 ${view.month} 月</div>
      <button type="button" class="icon-btn" data-cal-nav="1" aria-label="下個月">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>
    <div class="cal-weekday-row">${CAL_WEEKDAYS.map((d) => `<div class="cal-weekday">${d}</div>`).join("")}</div>
    <div class="cal-grid">${cellsHtml}</div>
    <div class="cal-day-events" id="cal-day-events">
      ${
        view.selectedDate
          ? renderFavoritesList(selectedEvents) // a disabled (no-event) cell can't be clicked, so selectedEvents is never empty here
          : renderEmptyList("這個月沒有收藏的場次。")
      }
    </div>
  `;
}

async function initFavorites(container) {
  const calendarEl = document.getElementById("fav-calendar");
  let events;
  try {
    await reconcileSupabaseSync();
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  let favView = loadFavView();
  // Jumps to the month of the soonest favorited show the first time the
  // calendar has data to show; month/day navigation after that is left alone
  // across re-renders (e.g. after toggling a favorite) so the user doesn't
  // get yanked back to the "soonest show" month mid-browse.
  let calendarView = null;
  let favorited = [];

  // Re-renders just the calendar widget from the current calendarView state
  // (month nav, day selection) without re-reading prefs/events — those only
  // change via render() below, when a favorite is actually toggled.
  function renderCalendarView() {
    renderFavCalendar(calendarEl, favorited, calendarView);
    wireTicketButtons(calendarEl);
    wireRemindButtons(calendarEl);
    wireFavoriteToggle(calendarEl, render);
    calendarEl.querySelectorAll("[data-cal-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const { year, month } = addMonths(calendarView.year, calendarView.month, Number(btn.dataset.calNav));
        // The previously selected day almost certainly isn't in the new
        // month — keeping it would silently show a stale, different month's
        // event below a calendar that no longer has that day selected at
        // all (found in testing: navigating to October still showed
        // September's event with nothing on screen explaining why). Jump to
        // this month's first favorited day instead, or clear the selection
        // if it has none.
        const prefix = `${year}-${String(month).padStart(2, "0")}`;
        const firstInMonth = favorited.find((e) => e.date.startsWith(prefix));
        calendarView = { year, month, selectedDate: firstInMonth?.date ?? null };
        renderCalendarView();
      });
    });
    calendarEl.querySelectorAll("[data-cal-date]:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => {
        calendarView = { ...calendarView, selectedDate: btn.dataset.calDate };
        renderCalendarView();
      });
    });
  }

  function render() {
    const prefs = loadPrefs();
    const { visible } = partitionEvents(events, prefs, {});
    favorited = visible.filter((item) => item.pinned).map((item) => item.event);
    favorited.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const summary = document.getElementById("fav-summary");
    if (summary) summary.textContent = `共 ${favorited.length} 場 · 依日期排序`;

    if (!calendarView && favorited.length > 0) {
      const [year, month] = favorited[0].date.split("-").map(Number);
      calendarView = { year, month, selectedDate: favorited[0].date };
    } else if (!calendarView) {
      const today = new Date();
      calendarView = { year: today.getFullYear(), month: today.getMonth() + 1, selectedDate: null };
    } else if (calendarView.selectedDate && !favorited.some((e) => e.date === calendarView.selectedDate)) {
      // The selected day's only event(s) just got unfavorited (e.g. from the
      // exact card this calendar is showing) — the date it points at no
      // longer has anything, so re-render() would otherwise call
      // renderFavoritesList([]) and silently show nothing with no
      // explanation, same stale-state class of bug the month-nav case above
      // already had to handle.
      calendarView = { ...calendarView, selectedDate: null };
    }

    container.hidden = favView === "calendar";
    calendarEl.hidden = favView !== "calendar";

    if (favView === "calendar") {
      renderCalendarView();
      return;
    }

    container.innerHTML =
      favorited.length === 0
        ? renderEmptyList("還沒有收藏任何場次，去時間表逛逛吧。")
        : renderFavoritesList(favorited);

    wireTicketButtons(container);
    wireRemindButtons(container);
    wireFavoriteToggle(container, render);

    container.querySelectorAll("[data-updated-fields]").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        alert(`更新內容：${link.dataset.updatedFields}`);
      });
    });
  }

  document.querySelectorAll("[data-fav-view]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.favView === favView));
    btn.addEventListener("click", () => {
      favView = btn.dataset.favView;
      saveFavView(favView);
      document.querySelectorAll("[data-fav-view]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      render();
    });
  });

  render();
}

async function initHiddenManagement(container) {
  let events;
  try {
    await reconcileSupabaseSync();
    events = await loadEvents();
  } catch (err) {
    console.error("Failed to load events.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const prefs = loadPrefs();
    const rules = [];

    for (const name of prefs.excluded_artists) {
      rules.push({
        kind: "artist",
        label: "演出者",
        title: name,
        count: countHiddenByArtist(name, events, prefs),
        unhide: () => {
          unexcludeArtist(name);
          render();
        },
      });
    }
    for (const tag of prefs.excluded_types) {
      rules.push({
        kind: "type",
        label: "類型",
        title: tag,
        count: countHiddenByType(tag, events, prefs),
        unhide: () => {
          unexcludeType(tag);
          render();
        },
      });
    }
    for (const eventId of prefs.excluded_events) {
      const event = events.find((e) => e.id === eventId);
      rules.push({
        kind: "event",
        label: "單場次",
        title: event ? displayTitle(event) : eventId,
        count: 1,
        note: "不影響同演出者其他場次",
        unhide: () => {
          unexcludeEvent(eventId);
          render();
        },
      });
    }

    const totalHidden = rules.reduce((sum, r) => sum + r.count, 0);
    const summary = document.getElementById("rule-summary");
    if (summary) summary.textContent = `共 ${rules.length} 條規則 · 隱藏 ${totalHidden} 場未來場次`;

    container.innerHTML =
      rules.length === 0
        ? renderEmptyList("目前沒有任何排除規則。")
        : rules
            .map(
              (r, i) => `
        <div class="card" style="flex-direction:row;align-items:center;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:5px;min-width:0;">
            <span class="tag-perf" style="align-self:flex-start;">${escapeHtml(r.label)}</span>
            <div class="event-title" style="font-size:15px;">${r.kind === "artist" ? "封鎖：" : r.kind === "event" ? "隱藏：" : "封鎖類型："}${escapeHtml(r.title)}</div>
            <div style="font-size:12px;color:var(--muted);font-weight:700;">隱藏 ${r.count} 場未來場次${r.note ? `（${escapeHtml(r.note)}）` : ""}</div>
          </div>
          <button class="btn-dark" style="padding:9px 16px;font-size:12px;flex:0 0 auto;" data-unhide-index="${i}">解除</button>
        </div>
      `
            )
            .join("");

    container.querySelectorAll("[data-unhide-index]").forEach((btn) => {
      btn.addEventListener("click", () => rules[Number(btn.dataset.unhideIndex)].unhide());
    });
  }

  render();
}

function reviewReasonLabel(reason) {
  if (reason === "artist_unrecognized") return "無法辨識藝人是否已建檔";
  if (reason === "normalize_error") return "解析失敗（欄位格式異常）";
  return reason;
}

function yamlEntryFor({ canonical, aliases, tagsOrigin }) {
  const aliasList = aliases.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(", ");
  return `- canonical: ${canonical}\n  aliases: [${aliasList}]\n  tags_origin_default: ${tagsOrigin}`;
}

/** M8 (FR-16/61, US-16): 待整理頁 reads the real needs-review.json queue. */
async function initReview(container) {
  let items;
  try {
    const res = await fetch("./data/needs-review.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`GET data/needs-review.json -> ${res.status}`);
    const data = await res.json();
    items = data.items ?? [];
  } catch (err) {
    console.error("Failed to load needs-review.json:", err);
    container.innerHTML = renderEmptyList("資料載入失敗，請稍後再試。");
    return;
  }

  function render() {
    const dismissed = new Set(loadReviewDismissed());
    const pending = items.filter((item) => !dismissed.has(item.raw_id));

    const heading = document.getElementById("review-heading");
    if (heading) heading.textContent = `未識別藝人／日期（${pending.length}）`;

    container.innerHTML =
      pending.length === 0
        ? renderEmptyList("目前沒有待整理的場次，做得好。")
        : pending
            .map(
              (item, i) => `
        <div class="card">
          <div style="font-size:12px;color:var(--muted);font-family:ui-monospace,monospace;background:var(--surface-2);border-radius:10px;padding:9px 11px;">
            原始標題：「${escapeHtml(item.title_raw ?? "（無標題）")}」
          </div>
          <div style="font-size:11px;color:var(--muted);">
            來源：${escapeHtml(item.source)}　問題：${escapeHtml(reviewReasonLabel(item.reason))}${item.detail ? `（${escapeHtml(item.detail)}）` : ""}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-dark" style="flex:1;padding:9px;font-size:12px;" data-assign="${i}">指派藝人</button>
            <button class="btn-ghost" style="flex:1;padding:9px;font-size:12px;" data-ignore="${i}">忽略</button>
          </div>
        </div>
      `
            )
            .join("");

    container.querySelectorAll("[data-assign]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = pending[Number(btn.dataset.assign)];
        openAssignArtistDialog(item, (fields) => {
          showYamlSnippetDialog(yamlEntryFor(fields));
          dismissReviewItem(item.raw_id);
          render();
        });
      });
    });
    container.querySelectorAll("[data-ignore]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = pending[Number(btn.dataset.ignore)];
        dismissReviewItem(item.raw_id);
        render();
      });
    });
  }

  render();
}

function formatDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Account/Supabase sync (2026-09-20, replaces M9's Gist sync), FR-63/64 backup export/import. settings.html has no single container — this wires individual elements by id instead. */
function initSettings() {
  const backupLast = document.getElementById("backup-last");
  const accountLoggedOut = document.getElementById("account-logged-out");
  const accountLoggedIn = document.getElementById("account-logged-in");
  const accountEmail = document.getElementById("account-email");
  const googleSigninBtn = document.getElementById("google-signin-btn");
  const signoutBtn = document.getElementById("signout-btn");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFileInput = document.getElementById("import-file-input");
  const strictModeToggle = document.getElementById("strict-mode");
  const muteKeywordsContainer = document.getElementById("mute-keywords");
  const muteKeywordInput = document.getElementById("mute-keyword-input");
  const refetchBtn = document.getElementById("refetch-btn");
  const refetchStatus = document.getElementById("refetch-status");
  const reviewQueueLink = document.getElementById("review-queue-link");
  const hiddenManagementLink = document.getElementById("hidden-management-link");
  const themeButtons = document.querySelectorAll("[data-theme-value]");

  // Google's redirectTo always points back at this page (see the click
  // handler below), so an OAuth failure lands here too — but as a query
  // string Supabase appends, not a thrown JS error. Found live (2026-09-19):
  // a wrong Client Secret failed silently with zero UI feedback, and the
  // only way to see what went wrong was reading the URL bar by hand. Surface
  // it the same way every other failure in this file does, then clean the
  // URL so a reload doesn't keep re-alerting the same stale error.
  const oauthError = new URLSearchParams(window.location.search).get("error_description");
  if (oauthError) {
    alert(`Google 登入失敗：${decodeURIComponent(oauthError.replace(/\+/g, " "))}`);
    history.replaceState(null, "", window.location.pathname);
  }

  // 2026-09-20: was "renderSyncStatus" and also drove a separate "跨裝置同步"
  // status badge — dropped (Max: redundant once the 帳號 card already shows
  // logged in/out, that fact alone implies whether sync is active). Kept the
  // account-card and backup-date rendering under one function since both
  // still depend on the same loadPrefs()/getSession() round trip.
  async function renderAccountAndBackup() {
    const prefs = loadPrefs();
    const session = await getSession();
    const loggedIn = !!session;
    backupLast.textContent = `上次備份日期：${formatDateTime(prefs.last_backup_at) ?? "無"}`;
    accountLoggedOut.hidden = loggedIn;
    accountLoggedIn.hidden = !loggedIn;
    if (loggedIn) accountEmail.textContent = session.user.email ?? "";
  }

  function renderMuteKeywords() {
    const prefs = loadPrefs();
    muteKeywordsContainer.innerHTML = prefs.mute_keywords
      .map(
        (kw) => `
      <span class="tag-perf" style="display:inline-flex;align-items:center;gap:5px;">
        ${escapeHtml(kw)}
        <button type="button" data-remove-keyword="${escapeHtml(kw)}" style="border:none;background:transparent;color:inherit;cursor:pointer;font-size:11px;line-height:1;padding:0;">✕</button>
      </span>
    `
      )
      .join("");
    muteKeywordsContainer.querySelectorAll("[data-remove-keyword]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prefs = loadPrefs();
        prefs.mute_keywords = prefs.mute_keywords.filter((kw) => kw !== btn.dataset.removeKeyword);
        savePrefs(prefs);
        renderMuteKeywords();
      });
    });
  }

  strictModeToggle.checked = loadPrefs().strict_mode;
  strictModeToggle.addEventListener("change", () => {
    const prefs = loadPrefs();
    prefs.strict_mode = strictModeToggle.checked;
    savePrefs(prefs);
  });

  muteKeywordInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const kw = muteKeywordInput.value.trim();
    if (!kw) return;
    const prefs = loadPrefs();
    if (!prefs.mute_keywords.includes(kw)) {
      prefs.mute_keywords = [...prefs.mute_keywords, kw];
      savePrefs(prefs);
    }
    muteKeywordInput.value = "";
    renderMuteKeywords();
  });

  googleSigninBtn.addEventListener("click", async () => {
    googleSigninBtn.disabled = true;
    try {
      // Redirect back to this same page — simplest round-trip, matches
      // login.html's own Google button doing the same for itself.
      await signInWithGoogle(window.location.href);
    } catch (err) {
      console.error("Google sign-in failed:", err);
      alert("Google 登入失敗，請稍後再試。");
      googleSigninBtn.disabled = false;
    }
    // No further code runs here on success — signInWithGoogle() navigates
    // the whole page away to Google's consent screen.
  });

  signoutBtn.addEventListener("click", async () => {
    await signOut();
    await renderAccountAndBackup();
  });

  exportBtn.addEventListener("click", () => {
    const updated = savePrefs({ ...loadPrefs(), last_backup_at: new Date().toISOString() });
    const blob = new Blob([exportPrefsAsJson(updated)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liveradar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    renderAccountAndBackup();
  });

  importBtn.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", async () => {
    const file = importFileInput.files[0];
    if (!file) return;
    try {
      importPrefsFromJson(await file.text());
      renderAccountAndBackup();
      renderMuteKeywords();
      strictModeToggle.checked = loadPrefs().strict_mode;
      alert("匯入成功。");
    } catch (err) {
      console.error("Failed to import prefs:", err);
      alert("匯入失敗，請確認檔案格式是否正確。");
    } finally {
      importFileInput.value = "";
    }
  });

  // S5 (2026-09-17): only works when this page is served by scripts/dev-server.mjs
  // (npm run serve) — GitHub Pages is a static host with no /api/fetch to call.
  // Hide it outright on any other host (2026-09-21: a real visitor on the
  // deployed site has no way to run npm run serve, so showing a button that
  // can only ever fail there is just confusing, not a real option for them).
  const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!isLocalDev) {
    refetchBtn.hidden = true;
  }

  // 2026-09-22: 「待整理」是給維護者自己看的內部佇列（指派藝人會產生 YAML 片段
  // 要人工貼進 data/artists.yml，不是使用者操作）——部署版對一般訪客沒有意義，
  // 同樣只在本機顯示。拿掉後「已隱藏管理」變成清單最後一項，順便拿掉它的
  // border-bottom，不然會留一條沒有意義的分隔線。
  if (!isLocalDev) {
    reviewQueueLink.hidden = true;
    hiddenManagementLink.style.borderBottom = "none";
  }
  refetchBtn.addEventListener("click", async () => {
    refetchBtn.disabled = true;
    refetchBtn.textContent = "抓取中…（可能要幾分鐘）";
    refetchStatus.textContent = "";
    try {
      const res = await fetch("/api/fetch", { method: "POST" });
      const result = await res.json();
      if (result.ok) {
        refetchStatus.textContent = "抓取完成，資料已更新。";
        renderSourceStatus();
      } else {
        refetchStatus.textContent = `抓取失敗：${result.error ?? "詳見終端機輸出"}`;
      }
    } catch (err) {
      console.error("Refetch failed:", err);
      refetchStatus.textContent = "無法連線到本機伺服器——這個按鈕只在用 npm run serve 執行時有效，部署版的 GitHub Pages 沒有後端可以跑爬蟲。";
    } finally {
      refetchBtn.disabled = false;
      refetchBtn.textContent = "🔄 重新抓取最新演出";
    }
  });

  function renderThemeButtons() {
    const current = loadTheme();
    themeButtons.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.themeValue === current));
    });
  }

  themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      saveTheme(btn.dataset.themeValue);
      renderThemeButtons();
    });
  });

  renderThemeButtons();
  renderAccountAndBackup();
  renderMuteKeywords();
  renderSourceStatus();
}

/** FR-62/M10: 設定頁來源狀態儀表, reads the same sources.json fetch.mjs writes each run. */
async function renderSourceStatus() {
  const container = document.getElementById("source-status");
  if (!container) return;
  try {
    const res = await fetch("./data/sources.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`GET data/sources.json -> ${res.status}`);
    const data = await res.json();
    // "manual" is the pseudo-source for user-added events (scripts/adapters/manual.mjs) —
    // always 0 筆/ok, never a real scrape, so it's noise here rather than a status a user
    // needs to read. Debugging it directly means reading data/sources.json, not this UI.
    const sources = (data.sources ?? []).filter((s) => s.name !== "manual");

    // 2026-09-21: 一般使用者不需要看到 status 徽章（正常/抓到0筆/抓取失敗）或
    // last_error 那種給開發者看的原始錯誤字串（例如 "GET ... -> 403"）——只留
    // 「更新時間」跟「最近筆數」兩個資訊，其餘技術細節要查還是看 data/sources.json。
    container.innerHTML =
      sources.length === 0
        ? `<div style="font-size:12px;color:var(--muted);">尚無資料。</div>`
        : sources
            .map((s, i) => {
              const rowBorder = i < sources.length - 1 ? "border-bottom:1px solid var(--border);padding-bottom:10px;" : "";
              return `
        <div class="row" style="${rowBorder}">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${escapeHtml(s.name)}</div>
            <div style="font-size:11px;color:var(--muted);">更新時間：${formatDateTime(s.last_success) ?? "無"}　最近筆數：${s.last_count ?? 0}</div>
          </div>
        </div>
      `;
            })
            .join("");
  } catch (err) {
    console.error("Failed to load sources.json:", err);
    container.innerHTML = `<div style="font-size:12px;color:var(--muted);">資料載入失敗，請稍後再試。</div>`;
  }
}

function wireChipGroup(group) {
  group.querySelectorAll(".chip-selectable").forEach((chip) => {
    chip.addEventListener("click", () => {
      const pressed = chip.getAttribute("aria-pressed") === "true";
      chip.setAttribute("aria-pressed", pressed ? "false" : "true");
    });
  });
}

function selectedChips(group) {
  return Array.from(group.querySelectorAll('.chip-selectable[aria-pressed="true"]')).map((c) => c.textContent.trim());
}

function initManualAdd(form) {
  document.querySelectorAll("[data-chip-group]").forEach(wireChipGroup);

  const headlinerField = document.getElementById("f-headliner");
  const addCoartistBtn = document.getElementById("add-coartist");
  const coArtistInputs = [];

  addCoartistBtn?.addEventListener("click", () => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center;";
    const input = document.createElement("input");
    input.className = "field-input";
    input.type = "text";
    input.placeholder = "共演者名稱";
    input.style.flex = "1";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.style.cssText = "flex:0 0 auto;border:none;background:transparent;color:var(--muted);font-size:14px;";
    removeBtn.addEventListener("click", () => {
      row.remove();
      const idx = coArtistInputs.indexOf(input);
      if (idx !== -1) coArtistInputs.splice(idx, 1);
    });
    row.append(input, removeBtn);
    addCoartistBtn.before(row);
    coArtistInputs.push(input);
    input.focus();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const ticketUrl = document.getElementById("f-url").value.trim();
      if (ticketUrl && !isSafeUrl(ticketUrl)) {
        alert("售票／資訊連結必須是 http:// 或 https:// 開頭的網址。");
        submitBtn.disabled = false;
        return;
      }

      const headliners = [headlinerField.value.trim(), ...coArtistInputs.map((i) => i.value.trim())].filter(Boolean);
      await addManualEvent({
        date: document.getElementById("f-date").value,
        time: document.getElementById("f-time").value || null,
        headliners,
        venue: document.getElementById("f-venue").value.trim(),
        city: document.getElementById("f-city").value.trim(),
        ticketUrl,
        tagsType: selectedChips(document.querySelector('[data-chip-group="tags_type"]')),
        tagsOrigin: selectedChips(document.querySelector('[data-chip-group="tags_origin"]')),
        note: document.getElementById("f-note").value.trim(),
      });
      window.location.href = "./index.html";
    } catch (err) {
      console.error("Failed to save manual event:", err);
      alert("儲存失敗，請再試一次。");
      submitBtn.disabled = false;
    }
  });
}

const timelineContainer = document.querySelector('[data-page="timeline"]');
if (timelineContainer) {
  initTimeline(timelineContainer);
}

const searchContainer = document.querySelector('[data-page="search"]');
if (searchContainer) {
  initSearch(searchContainer);
}

const newArrivalsContainer = document.querySelector('[data-page="new-arrivals"]');
if (newArrivalsContainer) {
  initNewArrivals(newArrivalsContainer);
}

const favoritesContainer = document.querySelector('[data-page="favorites"]');
if (favoritesContainer) {
  initFavorites(favoritesContainer);
}

const hiddenContainer = document.querySelector('[data-page="hidden"]');
if (hiddenContainer) {
  initHiddenManagement(hiddenContainer);
}

const addForm = document.getElementById("add-form");
if (addForm) {
  initManualAdd(addForm);
}

const reviewContainer = document.querySelector('[data-page="review"]');
if (reviewContainer) {
  initReview(reviewContainer);
}

if (document.getElementById("backup-last")) {
  initSettings();
}
