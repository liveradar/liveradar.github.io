import { chromium } from "playwright";

/**
 * Headless Chromium's default UA says "HeadlessChrome", so it has to be
 * overridden — but with the version the browser REALLY is. It used to be a
 * hard-coded "Chrome/128" while Playwright had moved on to Chromium 153: the
 * client-hint headers (sec-ch-ua) still told the site the true version, so
 * every request carried a self-contradicting identity. Derived from
 * browser.version() so it can never drift again on a Playwright upgrade.
 * (Real Chrome reports only the major version: "Chrome/153.0.0.0".)
 */
export function userAgentFor(browserVersion) {
  const major = String(browserVersion).split(".")[0];
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Shared Playwright launch/close boilerplate for adapters that need a real
 * browser instead of plain fetch() — either because the site is protected by
 * a Cloudflare JS challenge (KKTIX's search endpoint) or renders content
 * client-side after load (FANSI GO, a Next.js app with no server-rendered
 * event data at all). Added 2026-09-17 alongside those two adapters.
 *
 * @param {(page: import("playwright").Page) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withPage(fn) {
  return withBrowser(async (browser) => fn(await newPage(browser)));
}

/**
 * Launches one browser for the CALLER to open multiple pages against, e.g.
 * one per event when scraping detail pages for price text (tixcraft, FANSI
 * GO, added 2026-09-18). Launching a fresh browser per event the way
 * `withPage` does is fine for a handful of calls (4 KKTIX search keywords,
 * 1 FANSI GO listing page) but far too slow once "per event" means 80-140
 * events — reusing one browser process and opening a new tab per event cuts
 * that overhead down to just the page navigations themselves.
 * @param {(browser: import("playwright").Browser) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * New tab in an existing browser (see withBrowser) — same UA/locale withPage
 * uses.
 *
 * 2026-09-18 investigation note: tixcraft's detail page routinely took 5-9s
 * between domcontentloaded and its own "#intro" tab content actually
 * appearing (measured directly — goto() itself was consistently under 1s, so
 * the delay is real client-side rendering time, not network latency). Tried
 * blocking images/fonts/media and known ad/analytics hosts via page.route()
 * to speed that up — a small 5-event sample looked genuinely faster (~4s vs
 * ~7-9s), but a full 79-event run right after came back SLOWER overall with
 * far more 20s timeouts than any previous run (18/79 vs a handful before).
 * The likely cause isn't the blocking itself: by that point this debugging
 * session had made 150+ rapid detail-page requests to tixcraft within about
 * half an hour (several full-adapter test runs back to back), which plausibly
 * tripped some session-based bot-suspicion scoring on their end (the adapter
 * comment above already documents this being an Akamai/PerimeterX-style JS
 * challenge) — blocking ad/analytics requests is also a known bot-detection
 * signal some sites specifically watch for, so it may have made things worse
 * on top of that, or may be unrelated; the two effects couldn't be told apart
 * from a single noisy run. Reverted rather than ship an unconfirmed change
 * with a plausible downside — not worth risking degrading a real data source
 * over a speed optimization that isn't verified to actually help. If
 * revisited, retest on a fresh day/session with real gaps between runs so a
 * single test isn't itself the confound.
 */
export async function newPage(browser) {
  return browser.newPage({ userAgent: userAgentFor(browser.version()), locale: "zh-TW" });
}
