/**
 * UserPrefs persistence (SPEC §3.3, §8).
 * localStorage is only a cache of the logged-in user's cloud row (Supabase
 * `user_prefs`) — the cloud is the source of truth (SRS v1.1, 2026-10-02).
 * Every change is applied locally right away (so render() stays synchronous)
 * and then re-applied on top of the freshest cloud copy, one item at a time,
 * so two devices editing at once can't overwrite each other's changes.
 */

import { computeEventId, computePossibleEventIds } from "./id.js";
import { isPast } from "./filter.js";
import { supabase, getSession } from "./supabase.js";

const STORAGE_KEY = "liveradar:prefs";

export function defaultPrefs() {
  return {
    favorites: [],
    excluded_events: [],
    excluded_artists: [],
    excluded_types: [],
    excluded_venues: [],
    updated_at: new Date().toISOString(),
  };
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs();
    return { ...defaultPrefs(), ...JSON.parse(raw) };
  } catch {
    // Corrupt localStorage should never wipe the user out — fall back, don't throw.
    return defaultPrefs();
  }
}

// 2026-09-25 real bug (Max: "我發現我收藏的場次不見了...我指的是收藏的資料
// 被清空喔"): defaultPrefs() stamps updated_at as "right now" even when
// there's NO saved localStorage entry at all — a brand new browser,
// incognito window, or just cleared storage. reconcileSupabaseSync() below
// compares that fresh "now" against the real remote save time and, being
// newer, pushed the EMPTY defaults to Supabase, overwriting the user's real
// favorites there. This happens on literally every page load for a logged-
// in user on a device with no local prefs yet (see src/app.js: it's called
// once per page render). hasStoredPrefs() lets reconcileSupabaseSync tell
// "genuinely fresh, nothing to push" apart from "just edited, push me" —
// loadPrefs()'s own stamped updated_at can't do that on its own.
function hasStoredPrefs() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function persistPrefs(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/**
 * @param {(prefs: object) => object} fn - pure, idempotent edit of one item;
 *   applied to the local cache now and again to the cloud copy in the background.
 */
function changePrefs(fn) {
  const next = persistPrefs({ ...fn(loadPrefs()), updated_at: new Date().toISOString() });
  queuePush({ prefsFn: fn });
  return next;
}

// --- Favorites (US-06/07, FR-31) ---------------------------------------

export function isFavorited(prefs, eventId) {
  return prefs.favorites.includes(eventId);
}

export function toggleFavorite(eventId) {
  const adding = !loadPrefs().favorites.includes(eventId);
  return changePrefs((p) => ({ ...p, favorites: adding ? addUnique(p.favorites, eventId) : removeValue(p.favorites, eventId) }));
}

// --- Exclude rules (US-09/10/11, FR-41~44) ------------------------------
// Each rule list holds plain values (event id / canonical artist name / tag
// string). Adding is idempotent; removing just filters it out — this is what
// makes "解除規則後立即恢復" (AC-44) work without waiting for next fetch,
// since filter.js re-evaluates every event against the CURRENT prefs on every
// render, it never caches a "hidden" verdict per event.

function addUnique(list, value) {
  return list.includes(value) ? list : [...list, value];
}
function removeValue(list, value) {
  return list.filter((v) => v !== value);
}

const ruleAdder = (key) => (value) => changePrefs((p) => ({ ...p, [key]: addUnique(p[key], value) }));
const ruleRemover = (key) => (value) => changePrefs((p) => ({ ...p, [key]: removeValue(p[key], value) }));

export const excludeEvent = ruleAdder("excluded_events");
export const unexcludeEvent = ruleRemover("excluded_events");
export const excludeArtist = ruleAdder("excluded_artists");
export const unexcludeArtist = ruleRemover("excluded_artists");
export const excludeType = ruleAdder("excluded_types");
export const unexcludeType = ruleRemover("excluded_types");

/** FR-48: how many of the user's already-favorited events would this artist-block affect? */
export function countFavoritedByArtist(artistName, events, prefs) {
  return events.filter(
    (e) => prefs.favorites.includes(e.id) && (e.headliners.includes(artistName) || e.lineup.includes(artistName))
  ).length;
}

/** For 已隱藏管理 (FR-46): how many currently-visible-if-not-excluded future events each rule hides. */
export function countHiddenByArtist(artistName, events, prefs) {
  return events.filter(
    (e) =>
      !isPast(e.date) &&
      !prefs.favorites.includes(e.id) &&
      e.headliners.includes(artistName)
  ).length;
}
export function countHiddenByType(tag, events, prefs) {
  return events.filter((e) => !isPast(e.date) && !prefs.favorites.includes(e.id) && e.tags_type.includes(tag)).length;
}

// --- Manual events (US-17, FR-17, SPEC §7 / decision S1) ----------------
// These never touch the backend pipeline — the "manual" adapter always
// returns [] (decision S1). They live only here, merged into the real
// events.json list at render time (src/app.js's loadEvents), and dropped
// automatically once a real scrape produces the same id (AC-17).

const MANUAL_EVENTS_KEY = "liveradar:manual_events";

export function loadManualEvents() {
  try {
    const raw = localStorage.getItem(MANUAL_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistManualEvents(list) {
  localStorage.setItem(MANUAL_EVENTS_KEY, JSON.stringify(list));
}

// Manual events ride along in the same user_prefs row as the prefs.
function changeManualEvents(fn) {
  persistManualEvents(fn(loadManualEvents()));
  queuePush({ manualFn: fn });
}

/**
 * @param {object} fields - { date, time, headliners: string[], venue, city,
 *   ticketUrl, tagsType: string[], tagsOrigin: string[], note }
 */
export async function addManualEvent(fields) {
  const headliners = fields.headliners.filter(Boolean);
  const id = await computeEventId(headliners[0], fields.date, fields.venue);
  // AC-17: if this show turns out to have both a matinee and evening real
  // scrape later, dedup.mjs gives THOSE a bucket-suffixed id, not this bare
  // one — record every id a future scrape could produce so loadEvents() can
  // recognize either outcome and drop this manual copy (see src/id.js).
  const possibleRealIds = await computePossibleEventIds(headliners[0], fields.date, fields.venue, fields.time);
  const now = new Date().toISOString();

  const event = {
    id,
    merged_ids: [id],
    possible_real_ids: possibleRealIds,
    title_raw: headliners.join(" / "),
    headliners,
    lineup: headliners,
    is_festival: false,
    venue: fields.venue,
    city: fields.city || "未知",
    date: fields.date,
    time: fields.time || null,
    on_sale_at: null,
    price_min: null,
    price_max: null,
    status: "announced",
    tags_type: fields.tagsType ?? [],
    tags_origin: fields.tagsOrigin ?? [],
    ticket_url: fields.ticketUrl || "",
    sources: [{ name: "manual", url: fields.ticketUrl || "", raw_id: id }],
    first_seen_at: now,
    updated_at: now,
    note: fields.note || "",
  };

  changeManualEvents((list) => [...list.filter((e) => e.id !== id), event]);
  return event;
}

export function removeManualEvent(id) {
  changeManualEvents((list) => list.filter((e) => e.id !== id));
}

// --- 待整理 dismissals (US-16, FR-16/61, SPEC M8) ------------------------
// "指派藝人"/"忽略" only ever produce a YAML snippet the user pastes into
// data/artists.yml by hand (SPEC §11 M8: writing that file back is a manual
// dev/commit action, not something this static frontend can do). This list
// just declutters the queue in THIS browser until the next `npm run fetch`
// naturally drops the item from needs-review.json — it's not synced anywhere.

const REVIEW_DISMISSED_KEY = "liveradar:review_dismissed";

export function loadReviewDismissed() {
  try {
    const raw = localStorage.getItem(REVIEW_DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function dismissReviewItem(rawId) {
  const list = loadReviewDismissed();
  if (!list.includes(rawId)) {
    list.push(rawId);
    localStorage.setItem(REVIEW_DISMISSED_KEY, JSON.stringify(list));
  }
}

// --- Timeline view filters (city/month/priceMax chips, SPEC §6) --------
// Deliberately NOT part of UserPrefs (§3.3) and never synced to the account —
// these are "what am I currently looking at" view state, not a durable
// rule like excluded_artists, so they stay local to this browser.

const VIEW_FILTERS_KEY = "liveradar:view_filters";

export function loadViewFilters() {
  try {
    const raw = localStorage.getItem(VIEW_FILTERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveViewFilters(filters) {
  localStorage.setItem(VIEW_FILTERS_KEY, JSON.stringify(filters));
}

// --- Favorites page view mode (list vs. calendar, 2026-09-18) -----------
// Same "screen state, not a rule" spirit as the view filters above — which
// view you last had open isn't something that needs to sync across devices.

const FAV_VIEW_KEY = "liveradar:fav_view";

export function loadFavView() {
  try {
    return localStorage.getItem(FAV_VIEW_KEY) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
}

export function saveFavView(view) {
  localStorage.setItem(FAV_VIEW_KEY, view);
}

// --- Light/dark theme override (FR-27, 2026-09-18) ----------------------
// Dark mode was purely automatic (prefers-color-scheme) until it turned out
// to strain Max's eyes with no way to force light regardless of the OS
// setting. "system" (the default, no override) isn't stored as a literal
// value — an absent/invalid key means "follow the OS", matching how
// tokens.css's :not([data-theme="light"]) guard works. Never synced to the
// account — a display preference tied to one screen/eyes, not a rule.
const THEME_KEY = "liveradar:theme";

export function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

/** @param {"system"|"light"|"dark"} theme */
export function saveTheme(theme) {
  if (theme === "system") {
    localStorage.removeItem(THEME_KEY);
    delete document.documentElement.dataset.theme;
  } else {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }
}

// --- Cloud sync (Supabase `user_prefs`, one RLS-scoped row per user) -----

let pushChain = Promise.resolve();

/** Pushes run one after another so a later change never races an earlier one. */
function queuePush(change) {
  pushChain = pushChain.then(() => pushChange(change)).catch((err) => {
    console.error("Supabase push failed:", err);
    globalThis.alert?.("同步失敗：這次修改不會出現在其他裝置，請確認網路後重試。");
  });
  return pushChain;
}

/** Resolves once every queued change has reached the cloud (call before navigating away / signing out). */
export function flushPending() {
  return pushChain;
}

async function fetchRemote(userId) {
  const { data, error } = await supabase
    .from("user_prefs")
    .select("prefs, manual_events")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Not logged in -> no-op. Logged in -> re-apply just this change onto the
// freshest cloud copy (not the whole local copy), so edits from other
// devices survive. No cloud row yet -> seed it from the local cache.
async function pushChange({ prefsFn, manualFn }) {
  const session = await getSession();
  if (!session) return;
  const remote = await fetchRemote(session.user.id);
  const prefs = { ...defaultPrefs(), ...(remote?.prefs ?? loadPrefs()) };
  const manual = remote?.manual_events ?? loadManualEvents();
  const nextPrefs = { ...(prefsFn ? prefsFn(prefs) : prefs), updated_at: new Date().toISOString() };
  const { error } = await supabase.from("user_prefs").upsert({
    user_id: session.user.id,
    prefs: nextPrefs,
    manual_events: manualFn ? manualFn(manual) : manual,
    updated_at: nextPrefs.updated_at,
  });
  if (error) throw error;
}

const contentOf = (prefs, manual) => JSON.stringify([{ ...prefs, updated_at: null }, manual]);

/** Logout: this device must not keep the account's favorites/exclusions around. */
export function clearPersonalCache() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(MANUAL_EVENTS_KEY);
}

/**
 * Cloud wins: pull the user's row into the local cache (call on page load and
 * when a hidden tab becomes visible again). Never throws — a network failure
 * just means "stay on the cached copy".
 * @returns {{status: "not_authenticated"|"error"|"ok", changed: boolean}}
 *   changed = the cloud copy differs from what this page was rendered with.
 */
export async function reconcileSupabaseSync() {
  const session = await getSession();
  if (!session) return { status: "not_authenticated", changed: false };

  await flushPending(); // our own unsent changes must reach the cloud before we read it back
  let remote;
  try {
    remote = await fetchRemote(session.user.id);
  } catch (err) {
    console.error("Supabase sync failed, staying on cached data:", err);
    return { status: "error", changed: false };
  }

  if (!remote) {
    // First login ever: seed the cloud from whatever this device already has.
    if (hasStoredPrefs()) await queuePush({});
    return { status: "ok", changed: false };
  }

  const prefs = { ...defaultPrefs(), ...remote.prefs };
  const manual = remote.manual_events ?? [];
  const changed = contentOf(loadPrefs(), loadManualEvents()) !== contentOf(prefs, manual);
  persistPrefs(prefs);
  persistManualEvents(manual);
  return { status: "ok", changed };
}
