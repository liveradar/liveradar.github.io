# 實作規格：新增 Billboard Live TAIPEI 來源

2026-09-25 寫（研究與實測做完，程式碼還沒動）。照這份實作，做完後這份檔案可以刪掉，重點併進 HANDOFF.md。

## 為什麼要加

- 單一場館（台北信義 ATT 4 FUN 7F），**自己賣票，不在現有 5 個平台上**。9/25 比對 `events.json`，所有場次零重疊。
- 內容跟 LiveRadar 定位吻合：fox capture plan、家入レオ、渋谷すばる、culenasm、adieu（上白石萌歌）、Furui Riho、TETSUYA、ALL THAT JAZZ、阮丹青，以及本地的伍悅／VOOID／海豚刑警／洪申豪。
- 目前約 10 檔活動、每檔通常分 1st/2nd 兩場。

## 資料從哪裡來（全部實測過）

### 活動清單：逐月查列表頁

```
https://www.billboardlivetaipei.tw/tw/events?query=&selectedMonth=YYYY-M
```

- 月份**不補零**：`2026-9`、`2026-10`、`2027-1`（網站前端就是這樣組的，實測可用）。
- **一定要逐月查**。不帶 `selectedMonth` 的預設頁面只給 7 檔，漏了家入レオ／渋谷すばる／culenasm（原因不明，它們沒有售完）。逐月查才完整。
- 查詢範圍：**台灣時間當月起，往後共 7 個月**（當月＋6）。網站前端的月份選單最遠也只到 6 個月後（`getMonthsFromServiceStart`）。
- 一檔活動可能跨月出現，要用 show `_id` 去重。
- 一般 HTTP GET＋瀏覽器 UA 就能抓，**不需要 Playwright**，沒有 Cloudflare。
- `robots.txt` 禁止 `/api/`，**不要打任何 `/api/` 端點**。`/tw/events` 是允許的。
- sitemap.xml 沒有列活動頁，不能拿來當清單。

### 結構化資料：頁面內嵌的 Next.js RSC payload

頁面 HTML 裡有多段 `self.__next_f.push([1,"..."])`。把每段第二個元素（JSON 字串字面值）用 `JSON.parse('"' + chunk + '"')` 解開後串起來，就得到 RSC 文字。每檔活動是一個 JSON 物件，裡面有 `"shows":[...]`。

擷取方式：找每個 `"shows":[`，往回找包住它的 `{`，再往前括號配對到結尾，對那段 `JSON.parse`（9/25 的 Python 原型這樣做，10 檔全部解析成功）。要注意 RSC 會把 `undefined` 寫成字串 `"$undefined"`，parse 沒問題，但使用時要當成沒有值。

活動物件（實測欄位，只列會用到的）：

```jsonc
{
  "title": "Billboard 4LIVE SHOWCASE：伍悅 & VOOID、海豚刑警 & 洪申豪",
  "slug": "Billboard4LIVESHOWCASE",            // 活動頁 URL：/tw/events/{slug}
  "artist": { "name": "伍悅 & VOOID & 海豚刑警 & 洪申豪", "country": "TW" },
  "status": "published",                       // 活動層級；前端會看 cancelled / sold-out / completed
  "salesChannel": "online",                    // 目前只看過 online；"onsite" = 僅限現場販售
  "salesPeriod": { "startDate": "...Z", "endDate": "...Z", "memberEarlyAccessStart": null },
  "shows": [ /* 見下 */ ]
}
```

show 物件：

```jsonc
{
  "_id": "jigancle8jbfek7eao214cnw",           // 穩定 id，拿來當 raw_id
  "name": "2026/10/04 Billboard 4LIVE SHOWCASE：... 1st",
  "startTime": "2026-10-04T09:00:00.000Z",     // UTC！台灣時間 = +8 → 17:00
  "openTime":  "2026-10-04T08:00:00.000Z",     // 不要用：阮丹青那檔的 openTime 比 startTime 還晚，資料本身有錯
  "status": "preparing",                       // CMS 欄位，實測幾乎都是 preparing，不能直接當販售狀態
  "salesPeriod": { "startDate": "2026-09-09T10:00:00.000Z", "endDate": "2026-10-04T09:00:00.000Z", "memberEarlyAccessStart": null },
  "availableCount": 88, "totalCount": 268,     // 整場剩餘／總數，可能是 null
  "ticketPrices": { "尊享席 (Deep Blue)": 1199, "pair-v2": 2398, ... },
  "productAvailability": { "尊享席 (Deep Blue)": { "total": 40, "available": 23 }, ... }  // 可能是 "$undefined"
}
```

## 販售狀態：照搬網站前端自己的判斷邏輯

從網站 JS bundle 挖出的 `getShowBadgeStatus`（逐場）判斷順序：

1. `show.status === "cancelled"` → cancelled
2. `show.status` 是 `"completed"` 或 `"sale_ended"` → sales-ended
3. 看 `salesPeriod`（台灣時間比較；直接比 UTC 時間戳效果一樣）：
   - 沒有 `startDate` → preparing
   - 現在 < `startDate` → preparing（若有 `memberEarlyAccessStart` 且現在 ≥ 它，則是 member-early-access）
   - 有 `endDate` 且現在 > `endDate` → sales-ended
4. `availableCount` 不是 null 時：`=== 0` → sold-out，`<= 20` → few-left
5. 其他 → available

活動層級另外先看：活動 `status` 是 `cancelled`／`sold-out`／`completed` 時，套到該活動所有場次。

**對應到 LiveRadar 既有的訊號詞彙**（`sale-signal.mjs` 開頭那張表）：

| 網站狀態 | 訊號 | 備註 |
|---|---|---|
| available、few-left | `IN_STOCK` | |
| salesChannel 是 `onsite` 且 available/few-left | `IN_STOCK` | 現場有票，還是買得到 |
| preparing、member-early-access | `COMING_SOON` | 開賣時間用 `salesPeriod.startDate`（一般開賣，不是會員搶先） |
| sold-out | `SOLD_OUT` | **用 `<= 0` 判斷**，不要照抄 `=== 0`：實測有席次的 quantity 是負數（-5） |
| sales-ended | `REGISTRATION_CLOSED` | normalize 會依日期轉成 sold_out 或 ended |
| cancelled | `REGISTRATION_CLOSED` | 跟 Ticket Plus 岡崎體育取消的處理一致，顯示「結束販售」 |

把這段寫成純函式（例如 `showSaleSignal(event, show, nowMs)` 回傳 `{ sale_signal, on_sale_at }`），方便測試。

## Adapter：`scripts/adapters/billboard.mjs`

仿照 `ticketplus.mjs` 的結構：

```js
export const name = "Billboard Live";
export const priority = 6;
export async function fetch(knownRawIds = new Map()) { ... }  // knownRawIds 用不到
```

- **不需要**做 incremental fetch／`reuse_previous`。整份清單只要 7 個請求，每次都回傳完整新資料、重新 normalize，狀態自然是最新的。`diff.mjs` 只有欄位真的改變時才標「已更新」，不會洗版。
- 每個月份請求之間 `sleep(1000)`。單一請求失敗重試一次（照 ticketplus 的 `fetchJson` 模式）。**任何一個月份重試後仍然失敗，就整個 `throw`**，讓 `fetch.mjs` 走「沿用上次資料」的 fallback。不要只回傳部分月份，否則沒抓到的那個月的場次會從網站上消失。
- 每個 show 轉成一筆 RawEvent：

```js
{
  raw_id: show._id,
  url: `https://www.billboardlivetaipei.tw/tw/events/${event.slug}`,
  title_raw: event.title,
  venue_raw: "Billboard Live TAIPEI / 台北市信義區松壽路12號7F",   // KKTIX 格式，parseKktixVenue 會從地址判斷台北
  date_raw: "2026-10-04 17:00",       // startTime 轉台灣時間，格式 YYYY-MM-DD HH:MM → 交給 parseTicketPlusDate
  tickets_raw: [...],                 // 見下
  register_status: signal.sale_signal, // 見下方 normalize 的說明
  price_text_raw: "",
  sale_status_text: "",
  source_name: name,
}
```

- 地址來源：`/tw/access` 頁面寫的「台北市信義區 松壽路 12 號 7F」（9/25 確認）。
- `tickets_raw` 每個席次一筆：`{ name, price, closed, waiting, on_sale_at_raw }`（`statusFromTickets`／`priceFromTickets` 讀的就是這些欄位）：
  - **排除名稱以 `pair` 開頭的席次**（`pair-v2` 是雙人席，價格是兩人份，放進來會讓 price_max 變成 4400 這種誤導數字）。
  - `waiting` = 訊號是 COMING_SOON；`on_sale_at_raw` = `salesPeriod.startDate` 轉成台灣時間 `"YYYY/MM/DD HH:MM"`（這是 `parseKktixTimestamp` 吃的格式）。
  - `closed` = 訊號是 SOLD_OUT／REGISTRATION_CLOSED，或該席次 `productAvailability[name].available <= 0`（`productAvailability` 是 `"$undefined"` 時就只看整場訊號）。
- `title_raw`：9/25 看到的標題都有包含藝人名稱，直接用 `event.title`。如果之後出現標題裡完全沒有藝人名稱的活動，再考慮把 `artist.name` 併進去。**這次不要預先處理**，因為會改到卡片上顯示的標題。

## 需要改的既有程式

1. **`scripts/fetch.mjs`**：import 新 adapter，加進 `adapters` 陣列（放在 `manual` 前面）。
2. **`scripts/dedup.mjs:16` `SOURCE_PRIORITY`**：加上 `"Billboard Live": 6`，`manual` 改成 7。沒加的話會落到 `?? 99`，雖然不會壞，但要明確登記。
3. **`scripts/normalize.mjs` `DATE_PARSERS`（約第 828 行）**：加上 `"Billboard Live": parseTicketPlusDate`。`VENUE_PARSERS` 不用改（預設就是 `parseKktixVenue`）。
4. **`scripts/normalize.mjs` 約第 994 行**。這是唯一需要改的邏輯：
   ```js
   if (status === "announced" && rawEvent.source_name !== "KKTIX") {
   ```
   這條規則是「非 KKTIX 來源沒有結構化票種資料，看到 announced 又沒有開賣日期，就預設成 on_sale」。Billboard **有**結構化票種資料，但照現在的寫法，它正確算出的「尚未開賣」會被這條規則蓋成「開賣中」。改成：
   ```js
   if (status === "announced" && rawEvent.source_name !== "KKTIX" && (rawEvent.tickets_raw ?? []).length === 0) {
   ```
   其他 4 個非 KKTIX 來源的 `tickets_raw` 一律是 `[]`，行為完全不變。要順手把那段註解補一句，說明條件是「有沒有結構化票種資料」，不是「是不是 KKTIX」。
5. **`statusFromTickets`（約第 642 行）不用改**：`register_status` 的 SOLD_OUT／REGISTRATION_CLOSED／IN_STOCK 已經會優先處理；COMING_SOON 會掉到 `waiting` 那段，用 `on_sale_at_raw` 算出 `announced` 加開賣時間。
6. **對外文案**（目前都寫「五個售票平台」）：`index.html:8`、`index.html:13`、`privacy.html:34`、`src/interactions.js:328`。Billboard 是場館不是售票平台，建議寫成「KKTIX、拓元、iNDIEVOX、FANSI GO、Ticket Plus 五個售票平台，以及 Billboard Live TAIPEI」。
7. `fetch-one.mjs` 目前只支援 KKTIX，`renormalize.mjs` 跟來源無關，**都不用改**。

## dedup／id 的預期行為（不用改，但要驗證）

- 1st/2nd 兩場會各自成為一張卡：例如 16:00／19:00 會分到 day／evening；17:00／20:00 兩場都是 evening，但相隔 180 分鐘，超過 90 分鐘，會被 `clusterWithinBucket` 拆開。這跟 HANAZAWA KANA 午場／晚場的現有行為一致。
- 場地字串固定是 `Billboard Live TAIPEI`，`computeId` 穩定。

## 測試（新增 `scripts/billboard.test.mjs`，並補 normalize 測試）

照專案慣例：匯出純函式、用 9/25 抓到的真實資料當測試案例、測試名稱寫出真實案例。

1. **RSC 解析**：用一小段真實 `self.__next_f.push` HTML 片段（可以從 fox capture plan 的頁面截一段，兩個 show 就好）→ 解析出 1 檔活動、2 個 show，欄位正確。
2. **`showSaleSignal`**（用固定 `nowMs`）：
   - 現在 < startDate → `COMING_SOON`，`on_sale_at` = startDate
   - 期間內、availableCount 88 → `IN_STOCK`
   - availableCount 9 → `IN_STOCK`（真實案例：家入レオ 12/13 1st，網站顯示「即將售罄」）
   - availableCount 0 → `SOLD_OUT`；**負數 → `SOLD_OUT`**
   - availableCount null → `IN_STOCK`
   - 現在 > endDate → `REGISTRATION_CLOSED`（真實案例：TETSUYA 9/12，網站顯示「販售結束」）
   - show.status cancelled → `REGISTRATION_CLOSED`
   - member-early-access 期間 → `COMING_SOON`，開賣時間是一般開賣的 startDate
3. **RawEvent 轉換**：`2026-10-24T07:00:00.000Z` → `date_raw` `2026-10-24 15:00`；跨日案例（UTC 16:00 以後 → 台灣隔天）；`pair-v2` 被排除；`on_sale_at_raw` 格式是 `YYYY/MM/DD HH:MM` 台灣時間。
4. **月份清單**：台灣時間 2026-09 → `["2026-9", …, "2027-3"]` 共 7 個；月份不補零；跨年正確。要用台灣時間判斷當月（UTC 9/30 20:00 已經是台灣 10/1）。
5. **normalize 回歸測試**（加在 `normalize.test.mjs`）：
   - Billboard raw：tickets 全部 `waiting`、`on_sale_at_raw` 是未來時間 → 維持 `announced`，`on_sale_at` 有值（這就是第 994 行要修的情況）。
   - 既有行為不變：Ticket Plus raw、`tickets_raw: []`、沒有開賣日期 → 仍然是 `on_sale`（應該已有類似測試，確認還會過）。
   - Billboard raw 的 city 解析成「台北」。

每次改完都要跑 `npm test`。

## 實作完的驗證

1. `npm test` 全過。
2. 寫一個一次性腳本，只跑 billboard adapter＋`normalize()`，印出每場的標題／日期時間／status／on_sale_at／價格區間／city，**跟網站頁面逐場對照**（至少對 fox capture plan、家入レオ 1st、TETSUYA 這三種狀態）。跑完刪掉腳本（專案慣例）。
3. 不要為了驗證跑整套 `npm run fetch`（要 30 分鐘，而且有 `.fetch.lock`）。等隔天上午 10 點的排程跑完，再看 `sources.json` 的 Billboard Live 項目和 `events.json` 是否新增了約 20 個場次。

## 藝人資料（adapter 做完後另外處理）

目前 `artists.yml` 只有 VOOID、洪申豪。其他藝人會照 D15 規則照樣顯示在網站上，並列入待整理清單（`needs-review.json`）。要補的有：fox capture plan、Furui Riho、TETSUYA、adieu（上白石萌歌）、ALL THAT JAZZ、LEO IEIRI（家入レオ）、SUBARU SHIBUTANI（渋谷すばる）、culenasm、阮丹青、伍悅、海豚刑警。

Billboard 的 `artist.country` 可以當作查證的起點，但**不能直接當結論**：規則是「看在哪個音樂圈成名，不是國籍」，見 HANDOFF「別再踩的坑」第 11~14 條。要照既有的查證流程補，補完用 `npm run renormalize` 套用。

## 文件

- HANDOFF.md「現在的狀態」改成 6 個來源，並在「近期重大變動」記一筆。
- LIVERADAR-SPEC.md 講來源清單的章節（§5）補上 Billboard Live 一節：資料來源、狀態判斷、為什麼不做 incremental fetch。
