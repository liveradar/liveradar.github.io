import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal in-memory localStorage; set before state.js touches it. Not logged
// in, so background pushes are no-ops — this checks the local-cache edits.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { toggleFavorite, excludeArtist, unexcludeArtist, loadPrefs, clearPersonalCache, flushPending } =
  await import("./state.js");

test("toggleFavorite adds then removes; exclusions are idempotent", async () => {
  toggleFavorite("e1");
  assert.deepEqual(loadPrefs().favorites, ["e1"]);
  toggleFavorite("e1");
  assert.deepEqual(loadPrefs().favorites, []);

  excludeArtist("A");
  assert.deepEqual(loadPrefs().excluded_artists, ["A"]);
  unexcludeArtist("A");
  assert.deepEqual(loadPrefs().excluded_artists, []);
  await flushPending();
});

test("clearPersonalCache (logout) leaves nothing behind", async () => {
  toggleFavorite("e2");
  await flushPending();
  clearPersonalCache();
  assert.deepEqual(loadPrefs().favorites, []);
});
