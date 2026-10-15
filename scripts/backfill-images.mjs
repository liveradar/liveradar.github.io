/**
 * Cover-image backfill: data/events.json -> data/images.json ({ eventId: imageUrl }).
 *
 * Kept out of the adapters on purpose: images are cosmetic, so a failure here
 * must never touch events.json or the daily pipeline's correctness. fetch.mjs
 * calls this last, inside a try/catch. Only ids missing from images.json are
 * looked up, so a daily run costs a few requests. Also runnable on its own.
 *
 * Per-source strategy:
 * - tixcraft: listing page img (detail pages 401 without a browser)
 * - Ticket Plus: mainEvents.json picBigBanner (SPA, no og:image)
 * - everything else: og:image on the ticket page (property= or name=)
 * ponytail: 寬宏/年代 have no image in plain HTML — they stay on the placeholder.
 */
import { readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const IMAGES_PATH = new URL("../data/images.json", import.meta.url);
const EVENTS_PATH = new URL("../data/events.json", import.meta.url);
const SKIP_HOSTS = /kham\.com\.tw|ticket\.com\.tw/;
// Site-wide default og:images (organizer didn't upload one) — not a real cover.
const GENERIC_IMAGE = /kktix-og-image/;

async function get(url, referer) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", ...(referer && { Referer: referer }) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res;
}

export function ogImage(html) {
  const tag = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]*>/i)?.[0];
  const url = tag?.match(/content=["']([^"']+)["']/i)?.[1];
  return url && !GENERIC_IMAGE.test(url) ? url : null;
}

async function tixcraftMap() {
  const html = await (await get("https://tixcraft.com/activity", "https://tixcraft.com/")).text();
  const map = {};
  for (const [, href, src] of html.matchAll(/<a href="(\/activity\/detail\/[^"]+)"><img[^>]+src="([^"]+)"/g)) {
    map[href.split("/").pop()] ??= src;
  }
  return map;
}

async function ticketPlusMap() {
  const json = await (await get("https://apis.ticketplus.com.tw/config/api/v1/getS3?path=main/mainEvents.json")).json();
  const map = {};
  for (const [id, info] of Object.entries(json.allEventMainPageInfo ?? {})) {
    map[id] = info.picBigBanner || info.picTabletBanner || info.picBigHomeThumbnail;
  }
  return map;
}

function lazy(fn) {
  let p;
  return () => (p ??= fn().catch((err) => (console.warn(err.message), {})));
}

export async function backfillImages() {
  const events = JSON.parse(await readFile(EVENTS_PATH, "utf8"));
  const list = Array.isArray(events) ? events : events.events;
  let images = {};
  try { images = JSON.parse(await readFile(IMAGES_PATH, "utf8")); } catch {}

  const tix = lazy(tixcraftMap);
  const tp = lazy(ticketPlusMap);
  const todo = list.filter((e) => !(e.id in images));
  console.log(`${todo.length} event(s) without a cover lookup`);

  let found = 0;
  for (const e of todo) {
    let img = null;
    for (const { url } of e.sources) {
      try {
        if (/tixcraft\.com\/activity\/detail\//.test(url)) img = (await tix())[url.split("/").pop()];
        else if (/ticketplus\.com\.tw\/activity\//.test(url)) img = (await tp())[url.split("/").pop()];
        else if (!SKIP_HOSTS.test(url)) img = ogImage(await (await get(url)).text());
      } catch (err) {
        console.warn(`  ${e.id} ${url}: ${err.message}`);
      }
      if (img) break;
    }
    // null is recorded too so misses aren't retried daily; delete the key to retry.
    images[e.id] = img ? new URL(img, e.sources[0].url).href : null;
    if (img) found++;
    await new Promise((r) => setTimeout(r, 300));
  }

  // Drop ids no longer in events.json so the file doesn't grow forever.
  const live = new Set(list.map((e) => e.id));
  for (const id of Object.keys(images)) if (!live.has(id)) delete images[id];

  await writeFile(IMAGES_PATH, JSON.stringify(images, null, 1) + "\n");
  console.log(`found ${found}/${todo.length}; total with cover ${Object.values(images).filter(Boolean).length}/${list.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) backfillImages();
