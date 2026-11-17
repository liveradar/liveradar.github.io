# LiveRadar 專案檢視：可優化／調整項目（2026-11-17）

檢視範圍：抓取管線（`scripts/`）、前端（`src/`、`*.html`、`styles/`）、靜態頁與 SEO、Supabase、設定與文件、repo 本身。
方法：讀程式碼與設定、跑 `npm test`（417 個全過，1.2 秒）、`npm audit`（0 漏洞）、`npm outdated`。**沒有**開瀏覽器實測畫面，也沒有量測實際載入時間——標「先量再做」的項目代表我只從程式碼推論。

每項標註：**效益**（高／中／低）與**工**（小＝幾行、中＝半天內、大＝要設計）。

---

## 總覽（建議先做的 8 項）

| # | 項目 | 效益 | 工 |
|---|------|------|----|
| A1 | dev server 只綁 127.0.0.1 | 高（安全） | 小（1 行） |
| A2 | `events.json` 壞掉時不要當成「第一次跑」 | 高（資料正確性） | 小 |
| B1 | `report-stats.mjs`、`.claude/settings.json` 沒進 git | 高（排程會壞） | 小 |
| B2 | 加一個 push 觸發的 `npm test` workflow；舊的 daily-update workflow 修或刪 | 中 | 小 |
| C1 | 前端 `cache: "no-store"` 改 `"no-cache"` | 中（每次換頁省 ~100KB） | 小（3 處） |
| C2 | Supabase SDK 改成需要時才載入 | 中（每頁省 58KB gzip） | 小～中 |
| D1 | `event_reports` 加長度限制 | 中（防洗版） | 小（後台 SQL） |
| E1 | README／註解／workflow 說明已過時 | 中（接手成本） | 小 |

---

## A. 抓取管線的正確性與安全

### A1. dev server 對整個區網開放，且可被任何網頁觸發抓取 — 高／小
`scripts/dev-server.mjs` 最後 `server.listen(PORT)` 沒指定 host，會綁到所有網卡：
- 同一個 Wi-Fi 上的人可以讀到專案根目錄的任何檔案，包含 `.git/`、`.env`（若有）。
- `POST /api/fetch` 沒有檢查來源，你瀏覽的任何網站都能用一個表單送出觸發完整抓取（對售票平台多打一輪請求，違反「一天最多一次 full fetch」）。

修法：`server.listen(PORT, "127.0.0.1", …)`，另外 `/api/fetch` 檢查 `Origin` 是否為 localhost。
順帶：`filePath.startsWith(ROOT)` 少了結尾分隔符（`/…/liveradar-x` 也會通過），改成 `ROOT + path.sep`。

### A2. `events.json` 讀取失敗會被當成「第一次跑」 — 高／小
`scripts/fetch.mjs` 的 `loadPreviousEvents()`／`loadPreviousSources()`／`loadPreviousNeedsReview()` 一律 `catch { return [] }`。若檔案是**壞掉**（上次寫到一半被中斷、合併衝突標記）而不是不存在：
- 所有場次 `first_seen_at` 重置 → 全部變「新上架」；
- 增量抓取失效 → 所有詳情頁重抓一次；
- 來源異常時的 fallback 沒有舊資料可用 → 該來源的場次直接消失。

修法：只有 `ENOENT` 才回 `[]`，JSON 解析失敗直接中止並印出原因。
同場加映：四個資料檔是依序 `writeFileSync`，中途當掉會留下彼此不一致的檔案。寫到暫存檔再 `renameSync` 即可（各多一行）。因為有 git 可以還原，這部分優先度低於上面那項。

### A3. 雜訊規則寫死在 `normalize.mjs` — 中／中
`scripts/normalize.mjs` 1,452 行，其中 `NOISE_KEYWORDS`（約 100 行）、`CLASSICAL_KEYWORDS`、`MEET_AND_GREET_KEYWORDS`、`MANUALLY_EXCLUDED_URLS`、排除帳號清單都是資料不是邏輯。每日排程因此需要「編輯程式碼」的權限（`.claude/settings.json` 允許 `Edit(scripts/normalize.mjs)`）。
建議搬到 `data/noise.yml`（已經有 js-yaml 與 `loadArtists()` 同樣的讀法），排程就只改 `data/`，程式檔不再每天有被改壞的風險，allowlist 也能收窄。

### A4. 大檔案拆分 — 低／中（不急）
`scripts/adapters/kktix.mjs` 1,318 行、`scripts/normalize.mjs` 1,452 行、`src/app.js` 1,560 行。目前有測試保護且運作正常，**不建議為拆而拆**；等下次要大改其中一塊時再順手把那一塊抽出去（例如 normalize 裡各平台的 `parse*Date`/`parse*Venue` 移到各自 adapter 旁）。

### A5. 測試缺口 — 低／小
- `kham.mjs`、`era.mjs`（各 5 行，包 `utk.mjs`）沒有自己的測試，但 utk 有；可接受。
- `src/app.js`、`src/interactions.js`（DOM 相關，共約 1,900 行）沒有測試。純函式都已抽到 `filter.js`/`render.js`/`state.js` 並有測試，剩下是接線。要補的話，最划算的是一支 Playwright 冒煙測試（開首頁 → 有卡片 → 點一個篩選 → 數量變少），不需要測試框架。

### A6. Playwright UA 寫死 Chrome 128 — 低／小
`scripts/browser.mjs` 的 UA 是 `Chrome/128`，但實際 Chromium 會隨 Playwright 升級（目前 1.63，最新 1.65）。UA 與真實瀏覽器版本不一致本身就是一種 bot 訊號。可以不傳 `userAgent` 讓 Playwright 用自己的（需把 `HeadlessChrome` 字樣處理掉），或升級時同步改。**這項會動到被擋的機率，要改請用 fetch-one 對拓元／KKTIX 個別驗證，不要用 full fetch 試。**

---

## B. 排程、CI 與 repo 衛生

### B1. 排程依賴的檔案沒有進 git — 高／小
`git status` 顯示未追蹤：
- `scripts/report-stats.mjs` — allowlist 裡有、每日報告在用，但不在 git 裡；換機器或重新 clone 就沒了。
- `.claude/settings.json` — 排程「不跳權限詢問」完全靠它，同樣沒進 git。

建議兩個都 commit。（如果不想公開 settings.json，至少把 report-stats.mjs 進版控。）

其他未追蹤的雜物：`archive/`、`gigradar-design-comp/`、`mockups/`、`.impeccable/`、`image-1789972124064.png`、`image-1789973222073.png`。這是公開的 GitHub Pages repo，commit 進去就會被公開服務——建議加進 `.gitignore`，或搬出專案資料夾。

### B2. CI — 中／小
- 目前沒有任何 push 時自動跑的檢查。加一個 10 行的 workflow（`on: push` → `npm ci` → `npm test`）就能在手動改動推上去時擋住壞掉的 commit。測試只要 1.2 秒，不需要裝 Chromium。
- `.github/workflows/daily-update.yml` 是「備用」的手動觸發流程，但現在已經不能用：只 `git add data/`（不含 `e/`、`schedule.html`、`sitemap.xml`），也沒有 `npx playwright install chromium`。加上 GitHub IP 會被拓元／Ticket Plus 擋，實際上不會有人按它。**建議直接刪掉**，換成上面那個測試 workflow；`scripts/notify.mjs`（開 GitHub issue）也只有在 Actions 環境才會動，可一併檢討是否還需要。

### B3. `.git` 有 4,088 個鬆散物件、44MB — 低／小
打包後只有 0.9MB。跑一次即可：

```bash
git gc
```

### B4. 每日 commit 的 diff 很大 — 低／先觀察
最近一次 daily commit 動了 170 個檔、+4,031／−10,466 行，主要是 `e/*.html` 增刪。目前 repo 還很小，不用處理；若一年後 clone 變慢，再考慮把 `e/` 改成部署時產生（GitHub Actions build → Pages artifact）而不是 commit 進 main。

### B5. `e/` 有 20 個檔名含冒號 — 低／小
例如 `e/3227eaa8c247ef4c-17:00.html`。網址上合法、macOS／Linux 沒問題，但 Windows 無法 checkout 這個 repo。若沒有 Windows 需求可忽略；要修的話在 `generate-static.mjs` 產檔名時把 `:` 換成 `-`（id 本身不動），同時要注意舊網址會 404。

### B6. 相依套件 — 低／小
`js-yaml` 5.4.2 → 5.5.0、`playwright` 1.63.0 → 1.65.1，都是小版本。`package.json` 沒有 `engines` 欄位；目前本機是 Node v26.12.1，建議寫上最低版本避免換機器時用到太舊的 Node。

---

## C. 前端效能

### C1. `cache: "no-store"` → `"no-cache"` — 中／小
`src/app.js` 對 `events.json`（900KB，gzip 後 98KB）、`images.json`、`sources.json`、`needs-review.json` 都用 `no-store`。這是多頁式網站，**每次**在 時間表／新上架／收藏／搜尋 之間切換都會整包重新下載。
`no-cache` 一樣保證拿到最新版（每次都跟伺服器驗證），但沒變時伺服器回 304、不重傳內容。GitHub Pages 有送 ETag，所以改一個字就有效。原本註解擔心的「看到舊資料」問題 `no-cache` 同樣能避免。

### C2. Supabase SDK 每頁都載入 — 中／小～中
`src/app.js` 頂層 `import … from "./supabase.js"`，所以 `vendor/supabase-js.min.mjs`（224KB，gzip 58KB）對所有訪客、所有頁面都會下載並執行，包含從沒登入過的人。
改成動態 `import()`：只有在 localStorage 已有 session、或使用者按登入／回報時才載入。未登入訪客的 JS 量大約減半。

### C3. `events.json` 瘦身 — 低／先量再做
801 筆、900KB。可行的方向：前端用不到的欄位（`merged_ids`、`run_key`、`lineup` 與 `headliners` 重複時）另存、或輸出不縮排版本給前端。但 gzip 後才 98KB，做完 C1 之後重複下載的問題就消失了，**除非實測首頁載入有感，否則不建議做**。

### C4. 一次渲染全部卡片 — 低／先量再做
時間表看起來是一次 `innerHTML` 寫入全部場次（圖片有 `loading="lazy"`）。800 筆在手機上應該還行；若實測捲動或篩選卡頓，再考慮先渲染前 N 天、捲到底再補。沒量到問題前不要做。

### C5. 行內樣式 — 低／小
`settings.html` 15 處、`index.html` 12 處、`add.html` 12 處 `style="…"`。不影響功能，但深色模式或改版時容易漏改。下次動到這些頁面時順手移進 `styles/main.css`。

---

## D. Supabase／回報功能

### D1. `event_reports` 沒有任何輸入限制 — 中／小
policy 是 `with check (true)`，匿名可寫入，欄位沒有長度上限。任何人拿公開的 anon key 就能用迴圈灌資料，而且每一筆都會經 webhook 轉發到你的 Discord 頻道。
最小修法（Supabase SQL Editor）：加 check constraint 限制 `description` 與 `event_title` 長度（例如 ≤ 1000／≤ 300）。若真的被洗版，再加「同一 `event_id` 每分鐘限 N 筆」的 trigger。前端的 textarea 也順便加 `maxlength`。

### D2. Edge Function 小問題 — 低／小
`supabase/functions/notify-report/index.ts`：
- Discord 訊息上限 2,000 字，超過會回 400 → function 回 502。組訊息時截斷 `description`。
- `description` 原文直接貼進 Discord，內含 `@everyone` 會真的 tag 人。payload 加 `allowed_mentions: { parse: [] }`。

---

## E. SEO／可發現性

### E1. 首頁沒有 `og:image` — 中／小
`index.html` 與 `schedule.html` 只有 `twitter:card=summary`、沒有圖。分享到 LINE／Threads／Discord 時是一張沒有圖的卡片。做一張 1200×630 的靜態圖放 repo 即可。

### E2. 場次下架後頁面直接消失 — 低～中／中
`generateStatic()` 會刪掉不在 `events.json` 裡的 `e/*.html`。場次演完或平台下架後，已被搜尋引擎收錄或被人分享出去的連結變 404。
選項：(a) 維持現狀（最簡單，Google 會自己移除）；(b) 保留已結束場次的頁面 N 天，JSON-LD 不變、頁面標示「已結束」。這是產品取捨，不是 bug——如果搜尋流量不是目標，維持 (a)。

### E3. 場次頁的小改進 — 低／小
`scripts/generate-static.mjs`：
- `performer` 一律標 `PerformingGroup`，個人歌手應為 `Person`。`artists.yml` 若沒有這個資訊就不用硬做。
- 場次頁只有純文字樣式，沒有連回 SPA 中該場次的入口（只有回首頁）。若 SPA 支援用 id 定位，可以加一個「在 LiveRadar 中查看」。
- 沒有 `BreadcrumbList`、`schedule.html` 沒有 `ItemList` 結構化資料——有空再做。

### E4. PWA 基本項目 — 低／小
沒有 `manifest.json`、`theme-color`、`apple-touch-icon`，只有 SVG favicon（iOS 加到主畫面會是截圖）。這個站主要是手機在用，加一個 manifest 與一張 180×180 圖示就能「加到主畫面」有正常圖示與名稱。不需要 service worker。

---

## F. 無障礙

### F1. 沒有 `prefers-reduced-motion` — 低／小
`styles/main.css` 有 5 處 animation／transition（含骨架載入動畫），沒有對應的 reduced-motion 規則。加一段全域的即可：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

### F2. 其他（未實測）
CSS 沒有覆寫 `outline`，所以鍵盤焦點框是瀏覽器預設值，這是好的。對比度、觸控目標大小、螢幕閱讀器流程我沒有實際測，需要的話可以另外做一次完整的 a11y 檢查。

---

## G. 文件

### G1. 過時的說明 — 中／小
- `README.md` 寫「M1~M5 已完成」，`HANDOFF.md` 寫 M1~M12 全部完成。
- `README.md` 沒提到每日排程、`fetch-one`／`renormalize`／`health-check` 這幾個日常指令。
- `src/app.js` 第 92 行註解說 events.json「由 Actions job 每日覆寫」，實際是本機 Claude 排程。
- `daily-update.yml` 註解說抓取是「manual-only」，實際已有每日排程。
- `index.html` 的 description 寫「九個售票平台」，加上 Billboard Live 共 10 個；`fetch.mjs` 目前有 12 個來源 adapter（不含 manual），多出的 `kpmc`、`bluenote` 沒列進去，名單該對一次。

### G2. `HANDOFF.md` 187KB、`LIVERADAR-SPEC.md` 113KB — 中／中
HANDOFF 是按時間累加的工作日誌，新的 session 要讀完才能接手，成本很高，而且這個 repo 是公開的。建議：
- HANDOFF 只留「現況＋日常流程＋已知限制」（目標 < 10KB），歷史紀錄搬到 `archive/handoff-history.md` 或直接靠 git log。
- 這也會讓 Claude 排程每天啟動時少讀很多內容。

---

## 我刻意沒列的

- **加打包工具／框架／TypeScript**：違反 D14，目前規模也不需要。
- **把 `events.json` 換成資料庫或 API**：靜態 JSON + GitHub Pages 對這個規模是對的。
- **重寫 adapter 架構**：13 個 adapter 介面一致（`fetch()` + 選用的 `runStats()`），沒有可抽的共同層。
- **KKTIX `register_info` 的 403**：`sources.json` 今天顯示 checked 9／failed 5／blocked_403 8，屬於已記錄的已知限制，不重複列為問題。
