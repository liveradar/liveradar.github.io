import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVenueLine } from "./adapters/indievox.mjs";

test("parseVenueLine: a normal '場地：X' line still resolves", () => {
  const html = "<div>場地：迴響音樂展演空間</div>";
  assert.equal(parseVenueLine(html), "迴響音樂展演空間");
});

test("parseVenueLine real bug (Max 回報, X-Formosa 2026 彩虹音樂節): a page's own in-page nav bar '場地交通住宿｜活動時程｜表演者｜注意事項' must NOT be read as a venue field — '場地' here is the start of an unrelated compound word ('場地交通住宿' = venue/transport/lodging), not a field label", () => {
  const html = "<div>場地交通住宿｜活動時程｜表演者｜注意事項</div><div>場地：真正的場地名稱</div>";
  assert.equal(parseVenueLine(html), "真正的場地名稱");
});
