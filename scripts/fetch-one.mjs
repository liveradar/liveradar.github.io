/**
 * Single-event verification: runs ONE event page through the real adapter +
 * normalize() pipeline and prints what LiveRadar would store for it, next to
 * what data/events.json currently has. Writes nothing.
 *
 * 2026-09-24: the only way to check a scraping change used to be a full
 * `npm run fetch` (~25-30 minutes, hundreds of requests). Across 9/23-9/24
 * that meant ~14 full runs, most of them just to confirm one fix on one or
 * two events — and the repeated runs themselves were a likely cause of the
 * Cloudflare 403 spike on register_info. Use this instead: pick the handful
 * of real events a change is supposed to affect (a sold-out one, a new
 * template, a reported miss) and check them in seconds.
 *
 * Usage:
 *   node scripts/fetch-one.mjs <event-url> [<event-url> ...]
 *   node scripts/fetch-one.mjs --no-browser <event-url>   # skip the register_info fallback
 *
 * Currently KKTIX only — the other adapters don't have a standalone
 * per-event function yet (their per-event work is inline in fetch()).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as kktix from "./adapters/kktix.mjs";
import { withBrowser } from "./browser.mjs";
import { loadArtists, loadVenues, normalize } from "./normalize.mjs";

const args = process.argv.slice(2);
const noBrowser = args.includes("--no-browser");
const urls = args.filter((a) => !a.startsWith("--"));
if (urls.length === 0) {
  console.error("usage: node scripts/fetch-one.mjs [--no-browser] <event-url> [<event-url> ...]");
  process.exit(1);
}

const FIELDS = [
  "title_raw", "headliners", "tags_origin", "tags_type", "date", "time", "venue", "city",
  "price_min", "price_max", "status", "on_sale_at", "is_lottery",
];

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const storedEvents = JSON.parse(readFileSync(path.join(DATA_DIR, "events.json"), "utf-8")).events;
const artistsYml = loadArtists();
const venuesYml = loadVenues();

function isKktix(url) {
  const host = new URL(url).hostname;
  return host.endsWith("kktix.cc") || host.endsWith("kktix.com");
}

function show(value) {
  return value === undefined ? "—" : JSON.stringify(value);
}

async function checkOne(url, browser) {
  console.log(`\n=== ${url}`);
  if (!isKktix(url)) {
    console.log("  ⚠️ 目前只支援 KKTIX（其他平台還沒有獨立的單場抓取函式）");
    return;
  }
  const started = Date.now();
  const raw = await kktix.fetchEventDetail(url, browser);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  抓取 ${seconds}s | register_status=${raw.register_status ?? "null"} | 票種 ${raw.tickets_raw.length} 個`);
  console.log(`  stats: ${JSON.stringify(kktix.runStats().register_info)}`);

  const result = normalize(raw, artistsYml, venuesYml);
  if (result.excluded) {
    console.log(`  → 會被排除：${result.excluded.reason}`);
    return;
  }
  if (result.needsReview) {
    console.log(`  → 會進待整理：${result.needsReview.reason} ${result.needsReview.detail ?? ""}`);
    return;
  }
  const fresh = result.event;
  if (fresh.headliners.length === 0) console.log("  → 會進待整理：artist_unrecognized（場次本身仍會上架）");

  const stored = storedEvents.find((e) =>
    e.sources.some((s) => s.name === raw.source_name && s.raw_id === raw.raw_id),
  );
  if (!stored) console.log("  （events.json 目前沒有這場）");
  for (const field of FIELDS) {
    const now = show(fresh[field]);
    const before = stored ? show(stored[field]) : null;
    const mark = stored && now !== before ? `   ← 現有資料：${before}` : "";
    console.log(`  ${field.padEnd(12)} ${now}${mark}`);
  }
}

async function run(browser) {
  for (const url of urls) {
    try {
      await checkOne(url, browser);
    } catch (err) {
      console.log(`  ❌ ${err.message}`);
    }
  }
}

if (noBrowser) {
  await run(null);
} else {
  await withBrowser(run);
}
