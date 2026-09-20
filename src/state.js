/**
 * UserPrefs persistence (SPEC §3.3, §8).
 * M1: localStorage read/write only. Supabase sync (2026-09-20, replaces the
 * original Gist/PAT mechanism from M9) plugs into pushToSupabase/
 * reconcileSupabaseSync below.
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
    mute_keywords: [],
    strict_mode: false,
    last_backup_at: null,
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

function persistPrefs(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function savePrefs(prefs) {
  const next = persistPrefs({ ...prefs, updated_at: new Date().toISOString() });
  scheduleSupabaseSync(next);
  return next;
}

// --- Favorites (US-06/07, FR-31) ---------------------------------------

export function isFavorited(prefs, eventId) {
  return prefs.favorites.includes(eventId);
}

export function toggleFavorite(eventId) {
  const prefs = loadPrefs();
  const idx = prefs.favorites.indexOf(eventId);
  if (idx === -1) prefs.favorites.push(eventId);
  else prefs.favorites.splice(idx, 1);
  return savePrefs(prefs);
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

export function excludeEvent(eventId) {
  const prefs = loadPrefs();
  prefs.excluded_events = addUnique(prefs.excluded_events, eventId);
  return savePrefs(prefs);
}
export function unexcludeEvent(eventId) {
  const prefs = loadPrefs();
  prefs.excluded_events = removeValue(prefs.excluded_events, eventId);
  return savePrefs(prefs);
}

export function excludeArtist(name) {
  const prefs = loadPrefs();
  prefs.excluded_artists = addUnique(prefs.excluded_artists, name);
  return savePrefs(prefs);
}
export function unexcludeArtist(name) {
  const prefs = loadPrefs();
  prefs.excluded_artists = removeValue(prefs.excluded_artists, name);
  return savePrefs(prefs);
}

export function excludeType(tag) {
  const prefs = loadPrefs();
  prefs.excluded_types = addUnique(prefs.excluded_types, tag);
  return savePrefs(prefs);
}
export function unexcludeType(tag) {
  const prefs = loadPrefs();
  prefs.excluded_types = removeValue(prefs.excluded_types, tag);
  return savePrefs(prefs);
}

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
      (prefs.strict_mode ? e.lineup.includes(artistName) : e.headliners.includes(artistName))
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

function saveManualEventsList(list) {
  persistManualEvents(list);
  // Manual events aren't part of UserPrefs, but they ride along in the same
  // user_prefs row (pushToSupabase below) — bumping prefs.updated_at here is
  // what makes another device's reconcileSupabaseSync() notice this change
  // and pull it.
  savePrefs(loadPrefs());
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

  const list = loadManualEvents();
  list.push(event);
  saveManualEventsList(list);
  return event;
}

export function removeManualEvent(id) {
  saveManualEventsList(loadManualEvents().filter((e) => e.id !== id));
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

// --- Timeline intro card dismissal (2026-09-20) --------------------------
// Same "screen state, not a rule" spirit as the two above — whether you've
// already read the intro/tutorial card isn't something that needs to sync
// across devices; a second device is a legitimate reason to see it again.

const INTRO_DISMISSED_KEY = "liveradar:intro_dismissed";

export function loadIntroDismissed() {
  try {
    return localStorage.getItem(INTRO_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissIntro() {
  localStorage.setItem(INTRO_DISMISSED_KEY, "1");
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

// --- Supabase sync (replaces Gist/PAT sync, 2026-09-20) -----------------
// One row per authenticated user in the `user_prefs` table (user_id, prefs,
// manual_events, updated_at), RLS-scoped so a user can only ever read/write
// their own row (see HANDOFF.md for the SQL). Sync is last-write-wins on
// UserPrefs.updated_at, same shape as the Gist mechanism it replaces:
// whichever side has the newer timestamp overwrites the other, no
// field-level merge. Manual events (US-17) aren't part of UserPrefs but ride
// along in the same row so they sync too (see saveManualEventsList).
// Login is additive, not required — every function here is a no-op (or
// returns a "not_authenticated" status) when there's no session, so the app
// keeps working fully offline/local exactly as it did before this existed.

async function pushToSupabase(prefs) {
  const session = await getSession();
  if (!session) return;
  const { error } = await supabase.from("user_prefs").upsert({
    user_id: session.user.id,
    prefs,
    manual_events: loadManualEvents(),
    updated_at: prefs.updated_at,
  });
  if (error) throw error;
}

let syncTimer = null;

function scheduleSupabaseSync(prefs) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushToSupabase(prefs).catch((err) => console.error("Supabase push failed:", err));
  }, 2000);
}

/**
 * Call once per page load. Not authenticated → no-op (matches the old Gist
 * "not_connected" early return, never makes a network request). First login
 * ever (no remote row yet) → seed the remote row from local data instead of
 * requiring a separate "migrate" step. Otherwise pulls the remote bundle and
 * keeps whichever side is newer; pushes back if local won so the two sides
 * converge. Never throws — any network failure just means "stay on local",
 * same spirit as AC-65's negative test for the old mechanism.
 * @returns {{status: "not_authenticated"|"error"|"ok", changed: boolean}}
 */
export async function reconcileSupabaseSync() {
  const session = await getSession();
  if (!session) return { status: "not_authenticated", changed: false };

  const local = loadPrefs();
  let remote;
  try {
    const { data, error } = await supabase
      .from("user_prefs")
      .select("prefs, manual_events")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    remote = data;
  } catch (err) {
    console.error("Supabase sync failed, staying on local data:", err);
    return { status: "error", changed: false };
  }

  if (!remote) {
    await pushToSupabase(local).catch((err) => console.error("Supabase push failed:", err));
    return { status: "ok", changed: false };
  }

  const remoteTime = new Date(remote.prefs.updated_at).getTime();
  const localTime = new Date(local.updated_at).getTime();

  if (remoteTime > localTime) {
    persistManualEvents(remote.manual_events ?? []);
    persistPrefs(remote.prefs);
    return { status: "ok", changed: true };
  }
  if (localTime > remoteTime) {
    await pushToSupabase(local).catch((err) => console.error("Supabase push failed:", err));
  }
  return { status: "ok", changed: false };
}

// --- Backup export/import (FR-63/64) -----------------------------------

export function exportPrefsAsJson(prefs) {
  return JSON.stringify(prefs, null, 2);
}

export function importPrefsFromJson(json) {
  const parsed = JSON.parse(json);
  return savePrefs({ ...defaultPrefs(), ...parsed, last_backup_at: new Date().toISOString() });
}
