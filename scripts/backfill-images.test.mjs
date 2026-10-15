import { test } from "node:test";
import assert from "node:assert/strict";
import { ogImage } from "./backfill-images.mjs";

test("ogImage reads property= and name= variants, any attribute order", () => {
  assert.equal(ogImage(`<meta property="og:image" content="https://a/x.jpg">`), "https://a/x.jpg");
  assert.equal(ogImage(`<meta name="og:image" content="https://b/y.jpg">`), "https://b/y.jpg");
  assert.equal(ogImage(`<meta data-hid="og:image" property="og:image" content="https://c/z.jpeg">`), "https://c/z.jpeg");
  assert.equal(ogImage(`<meta property="og:title" content="t">`), null);
  assert.equal(ogImage(`<meta property="og:image" content="https://assets.kktix.io/assets/kktix-og-image-d905.png">`), null);
});
