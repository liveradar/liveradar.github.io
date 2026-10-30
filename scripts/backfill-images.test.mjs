import { test } from "node:test";
import assert from "node:assert/strict";
import { ogImage, erakhamImage, wixSized } from "./backfill-images.mjs";

test("ogImage reads property= and name= variants, any attribute order", () => {
  assert.equal(ogImage(`<meta property="og:image" content="https://a/x.jpg">`), "https://a/x.jpg");
  assert.equal(ogImage(`<meta name="og:image" content="https://b/y.jpg">`), "https://b/y.jpg");
  assert.equal(ogImage(`<meta data-hid="og:image" property="og:image" content="https://c/z.jpeg">`), "https://c/z.jpeg");
  assert.equal(ogImage(`<meta property="og:title" content="t">`), null);
  assert.equal(ogImage(`<meta property="og:image" content="https://assets.kktix.io/assets/kktix-og-image-d905.png">`), null);
});

// 2026-10-28 real bug (Max 回報): backfill-images.mjs used to skip
// kham.com.tw/ticket.com.tw entirely, assuming neither source ever has a
// cover image at all — wrong, see erakhamImage()'s own doc comment for the
// real pages this was checked against.
test("erakhamImage: 年代's own og:image has a real filename and is used directly (real case: P1DQZ6W2)", () => {
  const html = `<meta property='og:image' content='https://imgs2.utiki.com.tw/Data/ERA/Images/UTK2401/P1DQZ6W2_Other.JPG?v=202608031409' />`;
  assert.equal(erakhamImage(html, "P1DQZ6W2"), "https://imgs2.utiki.com.tw/Data/ERA/Images/UTK2401/P1DQZ6W2_Other.JPG?v=202608031409");
});

test("erakhamImage: 寬宏's own og:image is broken (no filename before the query string) — falls back to the page's own <img> tag (real case: P1F4200H)", () => {
  const html = `<meta property='og:image' content='https://imgs2.utiki.com.tw/Data/KHAM/Images/UTK2401/?v=202610271136' />
    <img id='bookingimg' src='https://imgs2.utiki.com.tw/Data/KHAM/Images/UTK2401/P1F4200H_Large.JPG?v=202610271136' alt='節目圖檔'>`;
  assert.equal(erakhamImage(html, "P1F4200H"), "https://imgs2.utiki.com.tw/Data/KHAM/Images/UTK2401/P1F4200H_Large.JPG?v=202610271136");
});

test("erakhamImage: neither a usable og:image nor the PRODUCT_ID's own <img> tag is null, not a broken URL", () => {
  const html = `<meta property='og:image' content='https://imgs2.utiki.com.tw/Data/KHAM/Images/UTK2401/?v=202610271136' />`;
  assert.equal(erakhamImage(html, "P1F4200H"), null);
});

test("wixSized shrinks a Blue Note (Wix) cover from 4267px to 600px and leaves other URLs alone", () => {
  assert.equal(
    wixSized("https://static.wixstatic.com/media/973c52_4ad54c55b9f0440e8085daf59b301ce3~mv2.png/v1/fill/w_4267,h_4267,al_c/973c52_4ad54c55b9f0440e8085daf59b301ce3~mv2.png"),
    "https://static.wixstatic.com/media/973c52_4ad54c55b9f0440e8085daf59b301ce3~mv2.png/v1/fill/w_600,h_600,al_c/973c52_4ad54c55b9f0440e8085daf59b301ce3~mv2.png",
  );
  assert.equal(wixSized("https://example.com/a.jpg"), "https://example.com/a.jpg");
});
