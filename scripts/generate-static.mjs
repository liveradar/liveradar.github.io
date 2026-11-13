/**
 * SEO/GEO static pages (no build step for the frontend — this just writes
 * plain HTML next to the SPA, run at the end of fetch/renormalize).
 *
 * Outputs (all committed, so GitHub Pages serves them as-is):
 *   e/<id>.html     one crawlable page per event, with Event JSON-LD
 *   schedule.html   every event grouped by month, links to each e/ page
 *   sitemap.xml     home + schedule + privacy + every event page
 *
 * Deterministic on purpose: no "generated at" stamps, no dependence on
 * today's date — files only change when events.json changes, so the daily
 * routine's tree stays clean when there is no new data. Files are rewritten
 * only when content differs, and orphaned e/*.html are deleted.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatOnSaleDateTime } from "../src/format.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = "https://liveradar.github.io";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const STATUS_LABEL = { on_sale: "售票中", sold_out: "結束販售", announced: "尚未開賣", ended: "已結束" };
const AVAILABILITY = { on_sale: "InStock", sold_out: "SoldOut", announced: "PreOrder" };

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// JSON inside <script>: "<" must not be able to close the tag.
const jsonLd = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const dateLabel = (date, time) => {
  const wd = WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()];
  return `${date.replace(/-/g, "/")}（${wd}）${time ?? ""}`.trim();
};
const isoStart = (date, time) => (time ? `${date}T${time}:00+08:00` : date);
const place = (venue, city) => ({
  "@type": "Place",
  name: venue || city,
  address: { "@type": "PostalAddress", addressCountry: "TW", ...(city && city !== "未知" ? { addressLocality: city } : {}) },
});
const sessionsOf = (e) => (e.sessions?.length > 1 ? e.sessions : []);
const price = (e) => (e.price_min != null ? `NT$${e.price_min.toLocaleString("en-US")} 起` : "票價未公布");

export function eventJsonLd(e, image) {
  const o = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title_raw,
    url: `${SITE}/e/${e.id}.html`,
    startDate: isoStart(e.date, e.time),
    ...(e.date_end && e.date_end !== e.date ? { endDate: e.date_end } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: place(e.venue, e.city),
    ...(e.headliners?.length ? { performer: e.headliners.map((n) => ({ "@type": "PerformingGroup", name: n })) } : {}),
    ...(image ? { image } : {}),
  };
  const subs = sessionsOf(e);
  if (subs.length)
    o.subEvent = subs.map((s) => ({
      "@type": "Event",
      name: e.title_raw,
      startDate: isoStart(s.date, s.time),
      location: place(s.venue, s.city),
    }));
  // Offers need a price; skip when unknown or the event is over rather than guess.
  if (e.price_min != null && AVAILABILITY[e.status]) {
    o.offers = {
      "@type": "Offer",
      url: e.ticket_url,
      price: e.price_min,
      priceCurrency: "TWD",
      availability: `https://schema.org/${AVAILABILITY[e.status]}`,
      ...(e.status === "announced" && e.on_sale_at ? { validFrom: e.on_sale_at } : {}),
    };
  }
  return o;
}

export function eventPage(e, image) {
  const url = `${SITE}/e/${e.id}.html`;
  const where = [e.city !== "未知" ? e.city : null, e.venue].filter(Boolean).join(" ");
  const status = STATUS_LABEL[e.status] ?? "";
  const onSale = e.status === "announced" ? formatOnSaleDateTime(e.on_sale_at) : null;
  const sources = [...new Set(e.sources.map((s) => s.name))].join("、");
  const tags = [...(e.tags_type ?? []), ...(e.tags_origin ?? [])];
  const desc = `${e.title_raw}｜${dateLabel(e.date, e.time)}${where ? ` 於${where}` : ""}，${price(e)}，${status}。資料來源：${sources}。`;
  const title = `${e.title_raw}｜${e.date}${e.venue ? ` ${e.venue}` : ""}｜LiveRadar`;
  const subs = sessionsOf(e);
  const rows = [
    ["日期", subs.length ? "" : dateLabel(e.date, e.time)],
    ["地點", subs.length ? "" : where],
    ["票價", price(e)],
    ["狀態", status + (onSale ? `（${onSale} 開賣）` : "")],
    ["演出者", (e.headliners ?? []).join("、")],
    ["分類", tags.join("、")],
    ["售票平台", sources],
  ].filter(([, v]) => v);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<link rel="icon" href="../favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="LiveRadar" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
${image ? `<meta property="og:image" content="${esc(image)}" />\n` : ""}<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
<script type="application/ld+json">${jsonLd(eventJsonLd(e, image))}</script>
<style>body{font:16px/1.7 system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1rem}dt{font-weight:600;margin-top:.6rem}dd{margin:0}img{max-width:100%;height:auto}</style>
</head>
<body>
<nav><a href="../index.html">← LiveRadar 時間表</a> · <a href="../schedule.html">全部演出</a></nav>
<main>
<h1>${esc(e.title_raw)}</h1>
${image ? `<img src="${esc(image)}" alt="${esc(e.title_raw)}" loading="lazy" />\n` : ""}<dl>
${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("\n")}
</dl>
${
  subs.length
    ? `<h2>場次</h2>\n<ul>\n${subs
        .map((s) => `<li>${esc(dateLabel(s.date, s.time))} ${esc([s.city !== "未知" ? s.city : null, s.venue].filter(Boolean).join(" "))}${s.status === "sold_out" ? "（結束販售）" : ""}</li>`)
        .join("\n")}\n</ul>\n`
    : ""
}<p><a href="${esc(e.ticket_url)}" rel="noopener">前往售票頁面</a></p>
<p><small>LiveRadar 每日彙整台灣各售票平台的演出資訊，實際場次與票價以售票頁面為準。</small></p>
</main>
</body>
</html>
`;
}

export function schedulePage(events) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const months = new Map();
  for (const e of sorted) {
    const m = e.date.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(e);
  }
  const body = [...months]
    .map(
      ([m, list]) =>
        `<h2>${m.replace("-", " 年 ")} 月</h2>\n<ul>\n${list
          .map((e) => {
            const where = [e.city !== "未知" ? e.city : null, e.venue].filter(Boolean).join(" ");
            return `<li>${esc(dateLabel(e.date, e.time))} <a href="e/${e.id}.html">${esc(e.title_raw)}</a>${where ? `｜${esc(where)}` : ""}｜${STATUS_LABEL[e.status] ?? ""}</li>`;
          })
          .join("\n")}\n</ul>`
    )
    .join("\n");
  const desc = `LiveRadar 彙整的台灣演唱會與 Live 演出清單，共 ${events.length} 場，依月份排列，附日期、場館與售票狀態。`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LiveRadar · 全部演出清單</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${SITE}/schedule.html" />
<link rel="icon" href="./favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="LiveRadar" />
<meta property="og:title" content="LiveRadar · 全部演出清單" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${SITE}/schedule.html" />
<meta name="twitter:card" content="summary" />
<style>body{font:16px/1.7 system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem}</style>
</head>
<body>
<nav><a href="./index.html">← LiveRadar 時間表</a></nav>
<main>
<h1>全部演出清單</h1>
<p>${esc(desc)}</p>
${body}
</main>
</body>
</html>
`;
}

export function sitemap(events) {
  const latest = events.map((e) => e.updated_at.slice(0, 10)).sort().at(-1);
  const url = (loc, lastmod) => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[
  url(`${SITE}/`, latest),
  url(`${SITE}/schedule.html`, latest),
  url(`${SITE}/privacy.html`, "2026-11-13"),
  ...[...events].sort((a, b) => a.id.localeCompare(b.id)).map((e) => url(`${SITE}/e/${e.id}.html`, e.updated_at.slice(0, 10))),
].join("\n")}
</urlset>
`;
}

function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return false;
  writeFileSync(file, content);
  return true;
}

export function generateStatic(root = ROOT) {
  const { events } = JSON.parse(readFileSync(path.join(root, "data/events.json"), "utf8"));
  const imgFile = path.join(root, "data/images.json");
  const images = existsSync(imgFile) ? JSON.parse(readFileSync(imgFile, "utf8")) : {};
  const dir = path.join(root, "e");
  mkdirSync(dir, { recursive: true });
  const keep = new Set();
  let changed = 0;
  for (const e of events) {
    keep.add(`${e.id}.html`);
    if (writeIfChanged(path.join(dir, `${e.id}.html`), eventPage(e, images[e.id] ?? null))) changed++;
  }
  let removed = 0;
  for (const f of readdirSync(dir)) if (f.endsWith(".html") && !keep.has(f)) (unlinkSync(path.join(dir, f)), removed++);
  writeIfChanged(path.join(root, "schedule.html"), schedulePage(events));
  writeIfChanged(path.join(root, "sitemap.xml"), sitemap(events));
  return { total: events.length, changed, removed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = generateStatic();
  console.log(`static pages: ${r.total} events (${r.changed} written, ${r.removed} removed)`);
}
