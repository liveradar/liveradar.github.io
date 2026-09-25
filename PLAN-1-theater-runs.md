# 實作規格 1／4：舞台劇／音樂劇分類＋「同場館合併一張卡」

2026-09-25 寫（研究完成，程式碼還沒動）。**這份是共同基礎，要最先做**：PLAN-3（OPENTIX）和 PLAN-4（寬宏／年代）都依賴它。PLAN-2（ibon）不依賴它，順序可以對調。做完後把重點併進 HANDOFF.md、LIVERADAR-SPEC.md，然後刪掉這份檔案。

## Max 已經拍板的決定（2026-09-25）

- 戲劇卡片：**同一檔戲在同一個場館的所有場次合併成一張卡**，顯示檔期區間和場次數；巡演到不同場館（不同城市）仍然分開成不同卡。
- 戲劇範圍：**音樂劇＋現代戲劇**（前台叫「舞台劇」）。不收戲曲、歌仔戲、布袋戲、偶戲、脫口秀、兒童劇。
- 音樂類的演出維持現有的「一場一張卡」，完全不受影響。

## 為什麼不能直接沿用「一場一張卡」

OPENTIX 目前光音樂劇就有 176 個場次、現代戲劇 557 個，其中《神隱少女》舞台劇一檔就演 50 場；網站現在全部才 465 張卡。

## 資料模型

### RawEvent 新增兩個選填欄位（adapter 填，normalize 帶過去）

| 欄位 | 說明 |
|---|---|
| `category` | `"音樂劇"` 或 `"舞台劇"`，由 adapter 依平台自己的分類決定。音樂類演出不要設（`undefined`）。 |
| `run_key` | 同一檔戲＋同一個場館的穩定識別字串，例如 `opentix:2067174521020350465:臺北市藝文推廣處城市舞台`。**不能包含日期**。有 `category` 的 RawEvent 一定要有 `run_key`。 |

### normalize.mjs

- `tags_type`：有 `rawEvent.category` 時直接用 `[rawEvent.category]`，**不要**再跑 `guessTagsType`（例如「…巡演」的音樂劇會被猜成「巡迴」）。
- 輸出的 event 帶上 `category`、`run_key`（沒有就不要出現這兩個 key）。

### 新模組 `scripts/runs.mjs`：`groupRuns(events, todayStr = taiwanTodayDateStr())`

純函式。在 `fetch.mjs` 裡，**所有 adapter 的 normalize 結果收集完之後、`dedupe()` 之前**呼叫。

- 沒有 `run_key` 的 event，以及已經有 `sessions` 的 event（前一次的資料透過 source-fallback 原封不動回來的），直接原樣回傳。
- 其餘依 `run_key` 分組，每組合併成**一個** run event：
  - `sessions`：該組所有場次，依 (date, time) 排序，每筆 `{ date, time, status }`。
  - 「即將到來的場次」＝ `date >= todayStr` 的 sessions；如果一場都沒有，就用全部 sessions（讓它自然變成已結束）。
  - `date`／`time`：即將到來的第一場。`date_end`：最後一場的日期。
  - 標題、場館、城市、headliners、lineup、tags、ticket_url、category、run_key、is_lottery：取即將到來第一場那筆。
  - `status`（只看即將到來的場次）：任一場 `on_sale` → `on_sale`；否則任一場 `announced` → `announced`，`on_sale_at` 取這些場次裡最早的；否則任一場 `sold_out` → `sold_out`；都沒有就 `ended`。其他狀態時 `on_sale_at` 為 `null`。
  - `price_min`／`price_max`：所有場次非 null 值的最小／最大。
  - `sources`：只放一筆 `{ name: <來源名稱>, url: ticket_url, raw_id: run_key }`。raw_id 用 run_key，`diff.mjs` 的 raw_id→id 反查才會穩定。
  - `id`：`computeId("run", run_key, "")` 或直接取 `run_key` 的 sha1 前 16 碼。**不能含日期**，因為前面的場次演完後日期會一直往後移，id 一變收藏就會消失（見 HANDOFF 9/25 收藏消失事件）。
  - `first_seen_at`／`updated_at`：沿用第一場那筆。

### dedup.mjs

`dedupe()` 開頭把有 `sessions` 的 event 分出來原樣放進結果，**不參與**跨平台合併，也不跑時段拆分。

**已知限制**（寫進 HANDOFF）：同一檔戲如果同時在 OPENTIX 和寬宏／年代賣，會出現兩張卡。要自動合併必須比對「標題相似＋同場館＋日期區間重疊」，這次先不做。

### diff.mjs

run event 的 `date`／`time` 會隨場次演完自然往後移。照現在的 `WATCHED_FIELDS`，收藏頁會每隔幾天冒出假的「已更新」。`fieldsChanged` 遇到有 `sessions` 的 event，改看 `["date_end", "venue", "status", "price_min", "price_max", "on_sale_at"]`，**不看** date／time。

### fetch.mjs

- 在 `dedupe(normalizedEvents)` 前面插入 `groupRuns()`。
- `runAdapter` 裡 `headliners.length === 0` 會寫進 needs-review（`artist_unrecognized`）。有 `category` 的 event **不要寫**：劇團和製作單位不在 `artists.yml` 的範圍裡，否則約 150 檔戲會灌爆待整理清單。

### renormalize.mjs

它會對沒有 headliners 的 event 重算 `tags_type = guessTagsType(...)`。有 `category` 的 event 要跳過，否則「音樂劇／舞台劇」會被覆蓋掉。

## 前端

所有頁面都透過 `src/app.js` 的 `loadEvents()` 讀資料，只要在那裡處理一次。

### 新模組 `src/runs.js`（純函式，附 `src/runs.test.js`）

- `localTodayIso()`：瀏覽器**本地**日期 `YYYY-MM-DD`。不要用 `toISOString()`（那是 UTC，台灣早上 8 點前會差一天，跟 `filter.js` 的 `isPast` 同一個坑）。
- `upcomingSessions(event, todayIso)`：`event.sessions` 裡 `date >= todayIso` 的場次。
- `materializeRun(event, todayIso)`：有 `sessions` 時回傳新物件，`date`／`time` 改成即將到來的第一場；一場都沒有就用最後一場，讓 `isPast` 自然把它歸到已結束。沒有 `sessions` 的 event 原樣回傳。
  - 為什麼要在前端算：資料一天只更新一次，但場次每天都在演完。例如一檔 10/1～10/31 的戲，10/2 早上打開網站時，不該還掛在 10/1 底下。
- `eventDates(event, todayIso)`：run 就回傳即將到來各場的日期，否則回傳 `[event.date]`。月份篩選和收藏月曆會用到。

### `app.js` 的 `loadEvents()`

`realEvents` 回傳前先 `.map((e) => materializeRun(e, localTodayIso()))`。之後的 isPast、依日期分組、排序、搜尋、新上架、收藏的「距今 N 天」都自動正確，不用改。

### 月份篩選

- `filter.js` 的 `passesViewFilters`：月份條件改成「`eventDates(event)` 裡任一個日期落在這個月」。一檔 10/20～11/10 的戲，選 10 月或 11 月都要看得到。
- `app.js` 的 `monthFilterOptions`：選項要涵蓋所有即將到來場次的月份，不能只看 `e.date`。

### 收藏月曆（`renderFavCalendar` 和它附近的 `firstInMonth`、`selectedDate` 檢查）

run 在每一個即將到來的場次日期都要有點點，點任何一天都要列出這張卡。凡是用到 `e.date` 的判斷都改用 `eventDates(e)`。

### 卡片（`render.js` 的 `renderEventCard`）

即將到來的場次**大於 1 場**時：

- 多一行 `🎭 檔期 10/16–10/25・共 6 場`（日期用 `M/D`，場次數只算即將到來的）。
- 時間那一段改成 `🕐 下一場 19:30`。
- 只剩 1 場時，外觀和一般卡完全一樣。

不用新增 CSS class，照現有的 inline style 慣例；真的需要再補。

### 類型篩選

`app.js` 的 `TYPE_DISPLAY_ORDER` 加上 `"舞台劇"`（放在 `"音樂劇"` 後面）。使用者既有的「排除類型」功能會自動支援音樂劇和舞台劇。

## 測試

- `scripts/runs.test.mjs`：
  - 3 場合併成 1 張卡：date、date_end、sessions、price 都正確。
  - 狀態彙整的四種情況；announced 時取最早的 on_sale_at。
  - 已經過去的場次不影響 date／status。
  - id 不隨日期改變：同一個 run_key，拿掉第一場之後 id 不變。
  - 沒有 run_key 的 event 原樣通過；已經有 sessions 的 event 原樣通過。
  - 不同場館是不同的 run。
- `dedup.test.mjs`：有 sessions 的 event 不被合併、id 不被改。
- `diff.test.mjs`：run 的 date 往後移、其他欄位都沒變，**不算**更新；date_end 改變則算更新。
- `normalize.test.mjs`：有 category 時 tags_type 等於 `[category]`，即使標題含「巡演」；run_key／category 會被帶到輸出。
- `src/runs.test.js`：materializeRun（第一場已過、全部已過、沒有 sessions）、eventDates。
- `src/filter.test.js`：月份篩選能命中 run 的第二個月。
- `src/render.test.js`：多場 run 會顯示檔期行和「下一場」；只剩 1 場時不顯示。

每改一步都跑 `npm test`。

## 前端實際驗證（這份規格沒有 adapter，所以要手動造資料）

1. 用 `npm run serve`，或 `.claude/launch.json` 設好後用 preview 起 dev server。
2. **暫時**在本機 `data/events.json` 加 2 筆假的 run event：一筆 3 場、第一場是昨天；一筆只剩 1 場。
3. 確認：時間表的日期、檔期行、月份篩選跨月命中、收藏後月曆每個場次日期都有點點、「舞台劇」出現在類型篩選。
4. 截圖給 Max 看。**驗證完一定要把 `events.json` 還原**（用 `git checkout data/events.json`，先 `git status` 確認只有你的改動）。
