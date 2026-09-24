import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSyncAction } from "./state.js";

const remoteAt = (iso) => ({ prefs: { favorites: ["real-event"], updated_at: iso }, manual_events: [] });
const localAt = (iso) => ({ favorites: [], updated_at: iso });

test("decideSyncAction: no remote row at all -> seed (nothing to lose)", () => {
  assert.equal(decideSyncAction({ localIsFresh: false, local: localAt("2026-09-25T00:00:00Z"), remote: null }), "seed");
});

test("decideSyncAction real bug (Max, 2026-09-25: \"我指的是收藏的資料被清空喔\"): a device with no saved local prefs must NEVER push over real remote data, even though defaultPrefs() stamps updated_at as right now (which would otherwise look newer than an old real remote save)", () => {
  const action = decideSyncAction({
    localIsFresh: true, // no localStorage entry existed on this device
    local: localAt(new Date().toISOString()), // defaultPrefs()'s own "now" stamp
    remote: remoteAt("2026-09-10T00:00:00Z"), // a real save from 15 days ago — much "older" by naive comparison
  });
  assert.equal(action, "pull", "must pull the real remote data, not push the empty fresh-device default over it");
});

test("decideSyncAction: local genuinely edited more recently than remote -> push", () => {
  const action = decideSyncAction({
    localIsFresh: false,
    local: localAt("2026-09-25T00:00:00Z"),
    remote: remoteAt("2026-09-20T00:00:00Z"),
  });
  assert.equal(action, "push");
});

test("decideSyncAction: remote genuinely newer than a real (not fresh) local edit -> pull", () => {
  const action = decideSyncAction({
    localIsFresh: false,
    local: localAt("2026-09-10T00:00:00Z"),
    remote: remoteAt("2026-09-20T00:00:00Z"),
  });
  assert.equal(action, "pull");
});

test("decideSyncAction: identical timestamps -> none (nothing to do either way)", () => {
  const action = decideSyncAction({
    localIsFresh: false,
    local: localAt("2026-09-20T00:00:00Z"),
    remote: remoteAt("2026-09-20T00:00:00Z"),
  });
  assert.equal(action, "none");
});
