# 實作規格 3／4：新增 OPENTIX（兩廳院文化生活）

2026-09-25 寫，研究與實測都做完了，程式碼還沒動。**必須在 PLAN-1（戲劇分類＋同場館合併卡片）完成之後才能做**。做完後把重點併進 HANDOFF.md 和 LIVERADAR-SPEC.md（§5 新增一節），然後刪掉這份檔案。

## Max 已經拍板的範圍（2026-09-25）

- 戲劇只收「戲劇-音樂劇」和「戲劇-現代戲劇」。
- 音樂只收「音樂-流行音樂」、「音樂-爵士樂」、「音樂-世界/民族」。**不收**古典（管絃、室內樂、獨奏、合唱等）。
- 兒童劇、親子節目一律不收。

9/25 實測：這 5 個分類合計 208 檔節目、744 個場次，排除親子後約 184 檔。音樂類跟現有資料幾乎不重疊。

## 端點（一般 HTTP 就能用；opentix.life 的 robots.txt 是 `Allow: /`）

### 1. 搜尋 API（節目清單＋每一場的結構化資料）

```
POST https://search.opentix.life/search
Content-Type: application/json
Origin: https://www.opentix.life
{"language":"zh-CHT","categoryFilter":["戲劇-音樂劇"],"sortBy":"ABOUT_TO_BEGIN","offset":15}
```

- **`language` 一定要帶**，少了會回 422 `"language" is required`。
- 每頁 15 筆，回傳 `result.hitsCount`、`result.found[]`、`result.nextOffset`。第一頁不帶 `offset`，之後帶上一頁的 `nextOffset`，直到 `found` 是空的或累計數 ≥ hitsCount。
- 5 個分類逐一查，9/25 總共 18 個請求。**同一檔節目可能同時出現在好幾個分類**，要用 `source.id` 去重。
- 只會回傳未來的場次（9/25 實測 744 場裡沒有任何一場已過去）。

`found[].source` 會用到的欄位：

```jsonc
{
  "id": "2067174521020350465",          // 節目 id；活動頁網址 https://www.opentix.life/event/{id}
  "title": "果陀劇場《Crash, Boom Boom Love!》演唱會音樂劇",
  "categories": ["戲劇-音樂劇", "音樂-流行音樂"],   // 可能有好幾個，也可能重複
  "eventVenues": [
    {
      "name": "臺北市藝文推廣處城市舞台",
      "city": "臺北",                   // 通常是城市名，但實測有一筆是 "GLOBALVILLAGEONEARTH"（池上的活動）
      "times": [
        {
          "start": 1793359800000,       // epoch 毫秒（UTC）
          "onlineStart": 1785898800000, // 開賣時間
          "onlineEnd": 1793363400000,   // 停售時間
          "minPrice": 700, "maxPrice": 3500,   // 免費活動兩個都是 0
          "status": 4,
          "hasPublicSection": true
        }
      ]
    }
  ]
}
```

**`times[].status` 不是售完狀態**。它的意思是從 OPENTIX 前端 JS 找到的對照表：`0 正常、1 暫停銷售、2 取消演出、3 延期、4 變更演出者`。9/25 實測：`2` 的節目標題真的寫著「（取消）」；`4` 的果陀《Crash, Boom Boom Love!》頁面也真的公告有演員退出。

### 2. 售完狀態：活動頁的 JSON-LD

搜尋 API 沒有剩餘票數。活動頁 `https://www.opentix.life/event/{id}` 是伺服器端輸出的，裡面每一場都有一段 `<script type="application/ld+json">`，`@type: "Event"`：

```jsonc
{
  "@type": "Event",
  "startDate": "2026-10-24T14:30:00",   // 台灣時間，沒有時區
  "location": { "name": "臺北市藝文推廣處城市舞台", "address": { "addressLocality": "臺北市" } },
  "offers": { "availability": "InStock" }   // 或 "SoldOut"
}
```

- 這個 `availability` 是 OPENTIX 自己用剩餘票數算出來的（`remainingQuantity > 0 || unlimited ? "InStock" : "SoldOut"`）。
- 9/25 抓了全部 208 頁：InStock 694 場、**SoldOut 47 場**，所以這個訊號真的有在用。
- **對應方式**：用「開演時間（到分鐘）＋場館名稱」對應 API 的場次，**不要按順序對**。9/25 有 2 檔節目兩邊的場次數不一樣。
- 成本：208 頁花了約 5.4 分鐘（含每頁 0.3 秒的間隔）。所有 adapter 是平行跑的，KKTIX 本來就更久，所以不會拉長整體時間。
- 可以省的請求：節目裡**每一場**都還沒開賣時（現在 < onlineStart），不用抓活動頁，因為還沒開賣不可能售完。

## 篩選與分類

1. 排除 `categories` 裡有任何一個以 `親子-` 開頭的節目。9/25 實測排除 24 檔，例如親子音樂劇《月亮雪酪》、九歌兒童劇團、朱宗慶「豆莢寶寶」；沒有任何標題寫「親子／兒童」卻沒帶這個分類的漏網之魚。
2. 分類（依序判斷）：
   - `categories` 含 `戲劇-音樂劇` → `category: "音樂劇"`
   - 否則含 `戲劇-現代戲劇` → `category: "舞台劇"`
   - 否則 → 音樂類（不設 `category`，走一般「一場一張卡」）
   - 例如「寶塚OG夢幻舞台」同時帶 `戲劇-音樂劇` 和 `音樂-流行音樂`，照規則會變成音樂劇。這是刻意的：規則簡單可預期，比逐檔判斷好。

## 每一場的販售訊號

| 條件（依序判斷） | 訊號 |
|---|---|
| `status` 是 2（取消演出）或 1（暫停銷售） | `REGISTRATION_CLOSED`（卡片顯示「結束販售」；如果之後恢復販售，隔天重抓就會更新） |
| JSON-LD 的 `availability === "SoldOut"` | `SOLD_OUT` |
| 現在 < `onlineStart` | `COMING_SOON`，開賣時間 = onlineStart |
| 現在 > `onlineEnd` | `REGISTRATION_CLOSED` |
| 其他 | `IN_STOCK` |

status 3（延期）和 4（變更演出者）照正常處理。活動頁抓失敗時，當作「沒有售完資訊」，**不要**標成售完，並記一筆 log。

## Adapter：`scripts/adapters/opentix.mjs`

```js
export const name = "OPENTIX";
export const priority = 8;   // Billboard Live 6、ibon 7；dedup.mjs SOURCE_PRIORITY 同步加上，manual 往後移
export async function fetch() { ... }
```

- 不需要 incremental fetch，每次都完整重抓（理由同 Billboard Live）。
- 搜尋 API 請求之間 `sleep(300)`，活動頁之間 `sleep(500)`。
- 搜尋 API 重試一次後仍失敗就整個 `throw`，讓 fetch.mjs 沿用上次的資料。活動頁失敗只影響那一檔的售完判斷。
- **先把時區工具抽成共用模組**：把 `billboard.mjs` 裡的 `taiwanParts`、`toTaiwanDateTimeDash`、`toTaiwanTimestampSlash` 搬到新的 `scripts/taiwan-time.mjs`，billboard.mjs 改成 import。**`billboard.test.mjs` 要照樣全部通過**。OPENTIX 用 `toTaiwanDateTimeDash(new Date(ms).toISOString())`。
- 每一場產生一筆 RawEvent（票價和狀態沿用 Billboard Live 的「結構化 tickets_raw」模式）：

```js
{
  raw_id: `${program.id}_${time.start}`,
  url: `https://www.opentix.life/event/${program.id}`,
  title_raw: program.title,
  venue_raw: `${venue.name} / ${venue.city ?? ""}`,   // parseKktixVenue：先看 city（臺北→台北），不行就把場館名當地址
  date_raw: toTaiwanDateTimeDash(new Date(time.start).toISOString()),
  tickets_raw: [...],        // 見下
  register_status: signal.sale_signal,
  price_text_raw: "",
  sale_status_text: "",
  category,                  // "音樂劇" / "舞台劇" / undefined
  run_key: category ? `opentix:${program.id}:${venue.name}` : undefined,
  source_name: name,
}
```

- `tickets_raw`：`maxPrice > 0` 時放兩筆 `{ name: "最低票價", price: minPrice }` 和 `{ name: "最高票價", price: maxPrice }`；免費活動（兩個都是 0）放一筆 `{ name: "免費", price: null }`，這樣卡片不會顯示「NT$0 up」。每筆都要帶 `closed`（訊號是 SOLD_OUT／REGISTRATION_CLOSED 時為 true）、`waiting`（COMING_SOON 時為 true）、`on_sale_at_raw`（COMING_SOON 時是 onlineStart 的 `toTaiwanTimestampSlash` 格式）。做法跟 billboard.mjs 的 `buildTicketsRaw` 一樣。
- `normalize.mjs` 的 `DATE_PARSERS` 加上 `"OPENTIX": parseTicketPlusDate`。
- `hasPublicSection: false` 的場次（9/25 只有 2 場）照正常處理，不特別排除，在程式碼註解記一筆就好。

## 測試（`scripts/opentix.test.mjs`）

- 分頁邏輯：用假的回應，確認會照 nextOffset 翻頁並用 id 去重。
- 親子排除；分類規則三種情況，包含「寶塚OG」這種跨分類節目。
- 販售訊號：上表每一列各一個測試，包含 SoldOut 與 status=2 同時出現時以取消優先。
- JSON-LD 解析與對應：用真實片段（startDate 沒有時區）配對 API 的 epoch 毫秒，並測「兩邊場次數不一樣」的情況。
- RawEvent：時區轉換、免費活動、戲劇有 run_key、音樂沒有 run_key。
- normalize＋groupRuns 整合：同一檔戲在同一場館 3 場 → 1 張卡；另一個場館 → 另一張卡。

## 還要改的地方

- `fetch.mjs` 的 adapters、`dedup.mjs` 的 `SOURCE_PRIORITY`。
- 對外文案 4 處（index.html 2 處、privacy.html、interactions.js）加上 OPENTIX。

## 實作完的驗證

寫一次性腳本 `scripts/_verify-opentix.mjs`：跑 adapter → normalize → groupRuns，印出統計：音樂幾場、音樂劇幾張 run 卡、舞台劇幾張 run 卡、SoldOut 幾場。至少跟網頁對照：

- 果陀《三個傻瓜》：多個場館，**每個場館各一張卡**，有部分場次售完。
- 《神隱少女》舞台劇：一張卡，約 50 場。
- 《鶯鶯》（取消）：結束販售。
- 任一檔「尚未開賣」的節目：announced，開賣時間正確。

跑完刪掉腳本。**不要**跑整套 `npm run fetch`，等排程。

最後用 dev server 看一次時間表：合併卡片的外觀、「舞台劇」篩選、月份篩選。截圖給 Max。
