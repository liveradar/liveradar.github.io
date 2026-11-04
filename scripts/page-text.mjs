import { withPage } from "./browser.mjs";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/page-text.mjs <url>");
  process.exit(1);
}

const text = await withPage(async (page) => {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  return page.evaluate(() => document.body.innerText);
});

console.log(text);
