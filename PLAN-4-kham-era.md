# 實作規格 4／4：新增寬宏售票＋年代售票（共用一套 adapter）

2026-09-25 寫，研究與實測都做完了，程式碼還沒動。**必須在 PLAN-1（戲劇分類＋同場館合併卡片）完成之後才能做**。做完後把重點併進 HANDOFF.md 和 LIVERADAR-SPEC.md（§5 新增一節），然後刪掉這份檔案。

## Max 已經拍板的範圍（2026-09-25）

只收「演唱會」「音樂劇」「戲劇」這三類。**不收**「音樂」類：9/25 年代的「音樂」類 32 檔幾乎都是古典樂、合唱團、社區音樂會。

## 兩站是同一套售票系統

寬宏（kham.com.tw）和年代（ticket.com.tw）的網址結構完全一樣（`UTK0101_06.aspx`、`UTK0201_00.aspx`），但 **HTML 模板不同**，所以要一個共用模組加上兩種寫法的解析。兩站都沒有 robots.txt（網址會直接回首頁），一般 HTTP 就能抓，不需要 Playwright。

- `scripts/adapters/utk.mjs`：共用邏輯，匯出 `createUtkAdapter({ name, host, categories })` 和所有可測試的純函式。
- `scripts/adapters/kham.mjs`：`export const { name, priority, fetch } = createUtkAdapter({ name: "寬宏", host: "kham.com.tw", ... })`，或用等效寫法，讓 fetch.mjs 可以照其他 adapter 的方式 import。
- `scripts/adapters/era.mjs`：年代，同上。
- 來源名稱用「寬宏」和「年代」，卡片上才會顯示正確的平台。priority 各給 9 和 10（Billboard Live 6、ibon 7、OPENTIX 8），`dedup.mjs` 的 `SOURCE_PRIORITY` 同步加上，manual 往後移。

## 分類編號（兩站不一樣，9/25 實測）

| 站 | 演唱會 | 音樂劇 | 戲劇 | 親子（只用來排除） |
|---|---|---|---|---|
| 寬宏 | 205 | 80 | 116 | 129 |
| 年代 | 205 | （沒有這個分類） | 116 | 129 |

- 分類對應：80 → `category: "音樂劇"`；116 → `category: "舞台劇"`；205 → 音樂（不設 category）。同一個商品出現在多個分類時，優先順序是 80 > 116 > 205。
- **排除同時列在親子分類（129）的商品**。9/25 年代的戲劇類 7 檔裡，正好有 4 檔同時是親子：巧虎英語舞台劇、超人力霸王舞台劇、蝴蝶大變、《再一次！唱歌旅行去》親子演唱會。用這個結構化條件就能排除，不用靠標題關鍵字。

## 端點

### 1. 分類清單

```
GET https://{host}/application/UTK01/UTK0101_06.aspx?TYPE=1&CATEGORY={編號}
```

用 regex `PRODUCT_ID=([A-Z0-9]+)` 從頁面取出商品 id 並去重。9/25 實測一頁就包含全部（年代頁面上寫的「共找到 N 筆」跟抓到的 id 數一致）。

### 2. 商品的場次表

```
GET https://{host}/application/UTK02/UTK0201_00.aspx?PRODUCT_ID={id}
```

兩站都是伺服器端輸出的 HTML 表格（用 cheerio 解析，專案已經有這個依賴）：

| 項目 | 寬宏 | 年代 |
|---|---|---|
| 商品標題 | `div.eventTitle` | `#ctl00_ContentPlaceHolder1_NAME` |
| 場次表格 | `table.eventTABLE` | `table.itable` |
| 日期時間 | 第 1 格的文字 `2026/11/21(六)15:00`；多日活動是 `A ~ B`，取 A | `time[datetime]` 屬性（`2026-11-02`）＋ `span.time` 文字（`19:30`） |
| 場館名稱 | `#PLACE_NAME` | id 結尾是 `PLACE_NAME` 的 span（前面有 `ctl00_…` 前綴） |
| 地址 | `a[id$=PLACE_ADDRESS]` 的 href 裡 `q=` 參數，URL-decode 後就是完整地址，例如 `台中市西屯區安和路117號` | 同左 |
| 附註文字 | 場館 span 後面的文字，例如「【輪椅場】…」「【VIP門票】…」 | 同左 |
| 票價 | 第 3 格的數字；**包在 `<s>` 裡的是已售完票價** | 同左，但售完是 `<del>` |
| 場次 id | 第 4 格按鈕 onclick 裡的 `PERFORMANCE_ID=` | 同左 |

建議用一個能容忍兩種模板的解析函式，例如 `[id$=PLACE_NAME]`、`s, del`，而不是寫兩套。

## 9/25 實測到的關鍵行為（一定要照著處理）

1. **一場演出常拆成很多列**：BIGBANG 高雄場是「每個票價一列」，各有不同的 PERFORMANCE_ID；很多演唱會另外有「【輪椅場】」「【身障輪椅場】」列。所以要**依（日期時間, 場館名稱）合併成一場**，再產生一筆 RawEvent。
2. **按鈕文字永遠是「立即訂購」**，連 BIGBANG 全部票價都劃掉了也一樣。**售完只能用刪除線判斷**：一場裡所有（非輪椅／身障列的）票價都劃掉 → 售完。
3. 輪椅／身障列（附註文字符合 `/輪椅|身障/`）**不計入票價和售完判斷**，否則最低票價會變成 800 這種輪椅席價格。只有當一場全部都是這種列時才用它們。
4. **還沒開賣的商品，場次表是空的**。例如寬宏「三個不老擊敗之人生跑馬燈 LIVE SHOW」，詳細頁寫「開賣時間：2026年09月28日(一)中午12點」，但場次頁 0 列，日期和場館要等開賣才會出現。**這種商品直接跳過**（記一行 log 就好），開賣當天的排程就會自然抓到。所以這兩站**沒有「尚未開賣」狀態**，只有開賣中和售完。
5. 已經演完的場次會自動從表格消失，所以不需要處理過去的場次。

## RawEvent（沿用 Billboard Live 的「結構化 tickets_raw」模式）

每個合併後的場次一筆：

```js
{
  raw_id: `${productId}_${YYYYMMDDHHMM}`,
  url: `https://${host}/application/UTK02/UTK0201_00.aspx?PRODUCT_ID=${productId}`,
  title_raw: productTitle,
  venue_raw: `${venueName} / ${address}`,       // parseKktixVenue 會從地址判斷城市
  date_raw: "2026-11-21 15:00",                 // 交給 parseTicketPlusDate
  tickets_raw: [ { name: "3680", price: 3680, closed: <是否劃掉>, waiting: false, on_sale_at_raw: null }, ... ],
  register_status: allStruck ? "SOLD_OUT" : "IN_STOCK",
  price_text_raw: "",
  sale_status_text: "",
  category,                                     // "音樂劇" / "舞台劇" / undefined
  run_key: category ? `${name}:${productId}:${venueName}` : undefined,
  source_name: name,
}
```

- `normalize.mjs` 的 `DATE_PARSERS` 加上 `"寬宏": parseTicketPlusDate` 和 `"年代": parseTicketPlusDate`。
- 同一個場次的多列合併時，tickets_raw 是這些列的票價聯集（相同價格去重），不包含輪椅／身障列。
- 不需要 incremental fetch：寬宏約 3 個清單＋約 20 個商品頁，年代約 3 個清單＋約 17 個商品頁，每次都完整重抓。請求之間 `sleep(500)`。
- 清單頁重試一次後仍失敗就 `throw`（走 fallback）；單一商品頁失敗只跳過那個商品並記 log。

## 測試（`scripts/utk.test.mjs`，用 9/25 抓到的真實 HTML 片段）

- 寬宏模板和年代模板各解析出正確的 日期時間／場館／地址／票價（含哪些劃掉）／PERFORMANCE_ID。
- BIGBANG 型：同一時間多列不同票價 → 合併成一場，票價是聯集。
- 輪椅列：不影響最低票價；主要列全部劃掉、只有輪椅列有票 → 仍判定為售完。
- 全部劃掉 → `SOLD_OUT`；部分劃掉 → `IN_STOCK`，劃掉的票種 closed。
- 多日活動 `2026/11/07(六)13:00 ~ 2026/11/08(日)13:00` 取開始時間。
- 空場次表 → 不產生 RawEvent。
- 分類優先順序與親子排除。

## 還要改的地方

- `fetch.mjs` 的 adapters（兩個）、`dedup.mjs` 的 `SOURCE_PRIORITY`。
- 對外文案 4 處加上寬宏、年代。

## 實作完的驗證

寫一次性腳本：跑兩個 adapter → normalize → groupRuns，印出每張卡。至少跟網頁對照：

- 寬宏 BIGBANG 高雄 2/27、2/28：售完。
- 寬宏《WILD WILD》音樂劇：Legacy Taichung、LIVE WAREHOUSE（高雄）、Legacy MAX（台北）**三張 run 卡**，城市分別是台中、高雄、台北。
- 寬宏 XG 台北：一張卡，票價不含輪椅席的 800。
- 年代 Jason Mraz：票價與劃掉的票種正確。
- 年代的兒童劇沒有出現。

跑完刪掉腳本。**不要**跑整套 `npm run fetch`，等排程。

## 已知限制（寫進 HANDOFF）

- 同一場演出如果同時在寬宏和另一個平台賣，場館寫法可能不同（例如「臺北小巨蛋」和「台北小巨蛋」），`computeId` 可能不會把它們合併成一張卡。這是現有跨平台合併的通病，不是這次造成的，這次不處理。
- 年代戲劇類的「2026火神祭搖滾區席位 - 星火計畫」「英雄傳 武聖關公」不確定是不是戲劇演出，實作時打開頁面看一下；如果不是，加進 `NOISE_KEYWORDS`。
