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
 * - 寬宏/年代 (kham.com.tw/ticket.com.tw, same underlying utiki.com.tw
 *   platform): see erakhamImage() below — real case.
 * - everything else: og:image on the ticket page (property= or name=)
 */
import { readFile, writeFile } from "node:fs/promises";
import { extractItems } from "./adapters/kpmc.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const IMAGES_PATH = new URL("../data/images.json", import.meta.url);
const EVENTS_PATH = new URL("../data/events.json", import.meta.url);
// Site-wide default og:images (organizer didn't upload one) — not a real cover.
const GENERIC_IMAGE = /kktix-og-image/;

async function getOnce(url, referer) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", ...(referer && { Referer: referer }) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res;
}

// 2026-10-28 real bug (Max 回報, 2026 FREEDOM NOW 台灣場): a transient
// fetch error (one bad request out of hundreds) got caught, logged, and then
// silently recorded as `images[e.id] = null` same as a genuine "no cover
// found" — and since null is never retried (see the comment at its
// call site below), one network blip permanently hid a cover that was
// there the whole time. One retry, same shape as kktix.mjs's fetchHtml(),
// costs nothing on the common case and fixes the rare one.
async function get(url, referer) {
  try {
    return await getOnce(url, referer);
  } catch (err) {
    console.warn(`backfill-images retry: ${url} - ${err.message}`);
    return await getOnce(url, referer);
  }
}

export function ogImage(html) {
  const tag = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]*>/i)?.[0];
  const url = tag?.match(/content=["']([^"']+)["']/i)?.[1];
  return url && !GENERIC_IMAGE.test(url) ? url : null;
}

// 2026-10-28 real bug (Max 回報, 年代《2026和風 頌 風華演唱會》跟一般寬宏
// 場次): `UTK0201_00.aspx` — the URL every 寬宏/年代 event stores — is a
// booking subpage with no cover image at all; the same PRODUCT_ID's main
// info page, `UTK0201_.aspx` (one less "00"), is where the real cover
// lives. On 年代 (ticket.com.tw) that page's own og:image tag has a real
// filename and just works; on 寬宏 (kham.com.tw) the same tag is present
// but broken — its content ends right at the image folder with no filename
// at all ("…/UTK2401/?v=202610271136" instead of "…/UTK2401/P1F4200H_Large.
// JPG?v=…") — so fall back to the page's own `<img id='bookingimg'
// src='…PRODUCT_ID_Large.ext'>` tag, which is what the ticket page itself
// actually renders as the cover.
export function erakhamImage(html, productId) {
  const og = ogImage(html);
  if (og && !/\/UTK2401\/\?/.test(og)) return og;
  return html.match(new RegExp(`src=['"]([^'"]*${productId}_Large\\.[A-Za-z]+[^'"]*)['"]`, "i"))?.[1] ?? null;
}

// Blue Note (Wix) serves og:image at the upload's full size ("w_4267,h_4267");
// the cards need a few hundred px, so ask Wix's own resizer for 600.
export function wixSized(url) {
  return url.replace(/(static\.wixstatic\.com\/.*\/fill\/)w_\d+,h_\d+/, "$1w_600,h_600");
}

// 高流 (kpmc.com.tw): a show page has no og:image at all, but the list page's
// embedded `var items` gives every show its own `background` image.
async function kpmcMap() {
  const items = extractItems(await (await get("https://kpmc.com.tw/program/")).text());
  const map = {};
  for (const month of Object.values(items ?? {})) {
    for (const item of month ?? []) if (item.link && item.background) map[item.link] = item.background;
  }
  return map;
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
  const kp = lazy(kpmcMap);
  const todo = list.filter((e) => !(e.id in images));
  console.log(`${todo.length} event(s) without a cover lookup`);

  let found = 0;
  for (const e of todo) {
    let img = null;
    for (const { url } of e.sources) {
      try {
        if (/tixcraft\.com\/activity\/detail\//.test(url)) img = (await tix())[url.split("/").pop()];
        else if (/ticketplus\.com\.tw\/activity\//.test(url)) img = (await tp())[url.split("/").pop()];
        else if (/kpmc\.com\.tw\/program\//.test(url)) img = (await kp())[url];
        else if (/bluenotetaipei\.com\//.test(url)) img = wixSized(ogImage(await (await get(url)).text()) ?? "") || null;
        else if (/kham\.com\.tw|ticket\.com\.tw/.test(url)) {
          const productId = new URL(url).searchParams.get("PRODUCT_ID");
          const infoUrl = url.replace("UTK0201_00.aspx", "UTK0201_.aspx");
          if (productId) img = erakhamImage(await (await get(infoUrl)).text(), productId);
        } else img = ogImage(await (await get(url)).text());
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
