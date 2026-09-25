# 實作規格 2／4：新增 ibon 售票（只收「娛樂」類）

2026-09-25 寫，研究與實測都做完了，程式碼還沒動。不依賴 PLAN-1，可以先做或後做。做完後把重點併進 HANDOFF.md 和 LIVERADAR-SPEC.md（§5 新增一節），然後刪掉這份檔案。

## 為什麼要加

9/25 實測 ibon「娛樂」類共 30 個活動，跟現有 `events.json` **零重疊**。其中跟 LiveRadar 定位相關的有：KANA-BOON（Legacy Taipei）、時速36公里（PIPE）、厄倫蒂兒（Zepp New Taipei）、青春群像錄（野地方）、山岡晃（SUB LIVE）、Pami（The Wall）、秋Out 音樂節，另外還有一些韓團和見面會。

## 端點（全部都能用一般 HTTP 請求，不需要 Playwright）

robots.txt 只禁止 `/Home/TicketflowControl`、`/UnderControl*`、`/trafpage/`，下面用到的 `/api/*` 都允許。

### 1. 活動清單

```
POST https://ticket.ibon.com.tw/api/Result/GetResultData
Content-Type: application/json
{"id":"","Location":"","CategoryCode":"entertainment","StartDate":"","EndDate":"","ATAP":"","ATAPW":"","PageIndex":0,"PageSize":50}
```

- 回傳 `Item.Total` 和 `Item.Rows`。一直翻頁（PageIndex+1），直到累計的列數 ≥ Total 或某頁是空的。9/25 實測 Total=30，一頁就拿完。
- **每個活動只會有一筆代表場次**：例如藤本洸大只列出「午場」，晚場不會出現。所以完整場次一定要走下面第 2 步。
- 每筆 row 會用到的欄位：`ActivityID`、`ActivityName`（標題用這個）、`ActivityCategoryCode`、`ActivityContent`（活動說明的 HTML，但**被 HTML-escape 過一次**，例如 `&lt;p&gt;`，要先把 `&lt; &gt; &quot; &#39; &amp;` 解回來）。
- 首頁的 `GetIndexData` 不要用，它混了 362 筆旅遊票，這支才是依分類的完整清單。

### 2. 每個活動的完整場次

```
POST https://ticket.ibon.com.tw/api/ActivityInfo/GetGameInfoList
Content-Type: application/json
{"id":<ActivityID>,"hasDeadline":true,"SystemBrowseType":0}
```

回傳 `Item.GIHtmls` 陣列，每筆是一個「game」：

```jsonc
{
  "ShowSaleDate": "2026/11/15(日) 18:00\r\n",   // 演出日期時間；展覽類會是「A ~ B」的區間，取前面
  "GameInfoName": "…（午場）",
  "VenueRegion": "Legacy Taipei",               // 場館名稱，可能是 null
  "StartDT": "2026-08-14T12:00:00",             // 開賣時間，台灣時間、沒有時區 → 補上 "+08:00"
  "EndDT": "2026-11-14T23:59:00",               // 截止時間
  "SoldOut": false,
  "CanBuy": true
}
```

**同一個演出常被拆成多個 game**，因為票種或預售階段不同。例如 BANG YONGGUK 在同一時間有 4 個 game，GR嘉年華另外有一個「企業優惠票」game。所以要**依 (ShowSaleDate 的開頭日期時間, VenueRegion) 合併**成一場，再轉成一筆 RawEvent。

## 每場的販售狀態

先對每個 game 算訊號，再用 `sale-signal.mjs` 的 `combineSaleSignals` 合併同一場的多個 game。合併前先把 game 依 StartDT 排序，這樣挑出來的 COMING_SOON 會是最早的開賣時間。

| 條件（依序判斷） | 訊號 |
|---|---|
| `SoldOut === true` | `SOLD_OUT` |
| 現在 < StartDT | `COMING_SOON`，`on_sale_at` = StartDT + `"+08:00"` |
| EndDT 存在且現在 > EndDT | `REGISTRATION_CLOSED` |
| `CanBuy === true` | `IN_STOCK` |
| 其他 | `null`（沒有訊號） |

9/25 的實測對照：山岡晃是 `SoldOut:true`；MAMAMOO（9/26 開賣）和都敬秀（10/4 開賣）都是 `CanBuy:false` 且 StartDT 在未來，所以是 COMING_SOON。

## normalize.mjs 需要的改動

### A. 支援「沒有票種資料、但有結構化開賣時間」的來源

ibon 沒有結構化票價，`tickets_raw` 會是 `[]`，只有結構化的狀態訊號。照現在的邏輯：`register_status` 是 COMING_SOON 會掉進 `statusFromTickets` 的「沒票種 → announced、on_sale_at: null」，接著又被第 994 行那段「非 KKTIX、沒票種資料 → 預設 on_sale」蓋掉。結果「尚未開賣」會錯標成「開賣中」。

1. RawEvent 新增選填欄位 `on_sale_at`（ISO 字串，含 `+08:00`）。
2. `statusFromTickets` 多收這個值：當 `registerStatus === "COMING_SOON"` 且 `ticketsRaw.length === 0` 時，回傳 `{ status: "announced", on_sale_at: rawOnSaleAt ?? null }`。
   - 這對 KKTIX 不會改變行為：KKTIX 沒票種時本來就是 announced，而且 KKTIX 不會帶 `on_sale_at`。
   - 既有測試「register_status IN_STOCK/COMING_SOON/null 不會蓋掉 ticket table」仍然成立，因為那個測試有票種資料。
3. 那段「預設 on_sale」的條件，Billboard Live 上線時（commit 261a5ec）已經改成 `status === "announced" && rawEvent.source_name !== "KKTIX" && (rawEvent.tickets_raw ?? []).length === 0`。這次再加上 `&& !rawEvent.register_status`：有結構化訊號時，就不需要「沒證據就預設開賣中」這條推測規則。其他 4 個非 KKTIX 來源的全新 RawEvent 都不帶 `register_status`（已用 grep 確認只有 kktix.mjs 會設），行為不變。註解要一起更新。

### B. 修 `parsePriceFromText` 的兩個真實 bug（用 ibon 內文實測出來的，會一起改善所有來源）

1. **「票價｜」後面同一行是空的，票種寫在下面幾行**（真實案例：KANA-BOON）：
   ```
   票價｜
   👑 VIP 票 NT$2,400
   ⚡ 一般預售票 NT$1,800
   ❤️ 愛心票 NT$1,100
   🎫 現場票 NT$2,200
   ```
   `PRICE_LABEL_RE` 分隔符號後面的 `\s*` 會吃掉換行，所以只抓到下一行的「VIP 2,400」。`labelBlockText` 原本就有「往下讀 5 行」的備援，但因此永遠不會執行，結果算出 2400–2400（正確應該是 1800–2400，愛心票會被 `DISCOUNT_TIER_RE` 排除）。
   **修法**：把 `PRICE_LABEL_RE` 裡分隔符號後的 `\s*` 改成 `[ \t]*`，讓空的同行不算命中，改走往下讀的邏輯。

2. **標籤名稱太長**（真實案例：青春群像錄 `票價資訊 Ticket Price：預售票 NT$ 1,400 | 現場票 NT$ 1,600 | 身障票 NT$ 700`）：
   「票價」和冒號之間有 16 個字，超過 `[^\n｜:：]{0,10}` 的上限，所以沒命中。接著「往下讀 5 行」的備援又**跳過標題行本身**，把後面某個年份 2026 當成票價，算出 2026–2026。
   **修法**：
   - 上限改成 `{0,20}`。
   - `labelBlockText` 的標題行迴圈要把**標題行本身**冒號後面的內容也算進去。
   - 正確結果應該是 1400–1600（身障票被 `DISCOUNT_TIER_RE` 排除）。

兩個都要加回歸測試，文字直接用上面的真實內容。改完跑完整 `npm test`，因為這會影響所有來源的票價解析。

## Adapter：`scripts/adapters/ibon.mjs`

```js
export const name = "ibon";
export const priority = 7;   // 排在 Billboard Live(6) 之後；dedup.mjs SOURCE_PRIORITY 同步加上，manual 往後移
export async function fetch() { ... }
```

- 不需要 incremental fetch：總共約 31 個請求（1 個清單＋每個活動 1 個），每次都完整重抓（理由同 Billboard Live）。請求之間 `sleep(500)`。
- 清單請求失敗（重試一次後仍失敗）就整個 `throw`，讓 fetch.mjs 沿用上次的資料。單一活動的 GetGameInfoList 失敗，只跳過那個活動並記 log。
- **排除**：`ActivityCategoryCode` 含 `exhibition` 的 row。
- 每個合併後的場次產生一筆 RawEvent：

```js
{
  raw_id: `${ActivityID}_${YYYYMMDDHHMM}`,        // 演出開始時間；穩定，不受 game 增減影響
  url: `https://ticket.ibon.com.tw/ActivityInfo/Details/${ActivityID}`,
  title_raw: row.ActivityName,
  venue_raw: `${VenueRegion ?? ""} / ${parseVenueLine(contentHtml) ?? ""}`,  // parseVenueLine 從 indievox.mjs import；兩邊都空就給 ""
  date_raw: "2026-11-15 18:00",                 // 由 ShowSaleDate 轉成，交給 parseTicketPlusDate
  tickets_raw: [],
  price_text_raw: contentHtml,                  // 解 escape 後的 HTML，交給 parsePriceFromText
  sale_status_text: "",
  register_status: signal?.sale_signal ?? null,
  on_sale_at: signal?.on_sale_at ?? null,
  source_name: name,
}
```

- `normalize.mjs` 的 `DATE_PARSERS` 加上 `"ibon": parseTicketPlusDate`。
- 城市判斷：`parseKktixVenue` 會先從內文的場地行找地址（例如「野地方Wildlab （臺北市中正區…）」），再把 VenueRegion 本身當地址（例如「高雄市文化中心 至德堂」本身含高雄），最後才查 venues.yml。9/25 實測用現有函式跑 30 筆，只有**花漾展演空間 HANASPACE、MOONDOG、台大綜合體育館**三個判斷不出城市。先用 WebSearch 查證地址，再補進 `data/venues.yml`，**不要猜**。

## normalize.mjs 的 `NOISE_KEYWORDS` 要加

都是 9/25 在 ibon 娛樂類看到的非音樂項目：

- `"玩具創作大展"`、`"toy festival"`：台北國際玩具創作大展，共 3 筆 row。
- `"大銀幕"`：《危城兄弟》電影首映場。
- `"總決賽"`：GCS 電競總決賽。
- `"gr嘉年華"`：TOYOTA GR 賽車展演活動。

## 測試（`scripts/ibon.test.mjs`，照專案慣例匯出純函式、用真實資料）

- ShowSaleDate 解析：`"2026/11/15(日) 18:00\r\n"` → `2026-11-15 18:00`；展覽區間 `"2026/10/08(四) 10:00\r\n ~ 2026/10/11(日) 18:00"` 取前面。
- game 合併：BANG YONGGUK 同一時間 4 個 game → 1 場；藤本洸大午場／晚場 → 2 場。
- 訊號：上表每一列各一個測試（用固定 nowMs），並測多個 game 的合併：一個 SoldOut、一個 CanBuy → IN_STOCK。
- ActivityContent 解 escape。
- normalize 回歸：`register_status: "COMING_SOON"`、`tickets_raw: []`、帶 `on_sale_at` → `announced` 且保留 on_sale_at（這正是 A 段要修的情況）；不帶 register_status 的非 KKTIX 來源仍然預設 on_sale（既有測試要照樣通過）。
- 票價兩個 bug 的回歸測試（B 段）。

## 還要改的地方

- `fetch.mjs`：import 並加進 `adapters`（放在 billboard 之後、manual 之前）。
- `dedup.mjs` 的 `SOURCE_PRIORITY`。
- 對外文案 `index.html`（2 處）、`privacy.html`、`src/interactions.js`：把 ibon 加進來源清單。

## 實作完的驗證

寫一次性腳本 `scripts/_verify-ibon.mjs`：只跑 adapter＋normalize，印出每場的標題／日期時間／status／on_sale_at／票價／城市。至少跟 ibon 網頁逐一對照 **KANA-BOON（票價 1800–2400）、山岡晃（sold_out）、MAMAMOO（announced＋開賣時間）、藤本洸大（兩場）、青春群像錄（票價 1400–1600）**。跑完刪掉腳本。

不要為了驗證跑整套 `npm run fetch`，等隔天排程跑完再看 `sources.json`。
