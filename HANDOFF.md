# 交接文件 — 換電腦/換 session 接續開發前先看這份

寫於 2026-09-15，2026-09-20 更新，2026-09-21 再更新，2026-09-22 再更新。**2026-09-22 最新狀態**：上班電腦那台的 Claude 排程任務（`liveradar-daily-fetch`）已經上線並實測跑過，資料每天會自動更新，不用 Max 手動觸發；上班電腦那次的 session 也順便做了大量真實 bug 修復（售票狀態偵測、票價/日期擷取、逆轉 D15「未辨識藝人擋場次上架」的產品決策）。這台 Mac 這邊清空了待整理佇列（修好 KKTIX 新版頁面模板的解析 bug、needs-review 去重、補齊 9 位真實藝人資料），還新增了兩個使用者功能：每張卡片可以「回報這場資訊有誤」（寫進 Supabase `event_reports` 表，**這張表的 SQL 還沒在 Supabase 後台真的執行過**，看 `supabase/schema.sql` 尾端）、以及「尚未開賣」場次可以「🔔 開賣提醒加入行事曆」匯出 .ics（含開賣前 15 分鐘＋開賣當下兩個鬧鐘）。細節見文件尾端對應章節。**2026-09-21 最新狀態**：專案全面改名 GigRadar → LiveRadar（含 GitHub org/repo/文件/UI，網址換成乾淨的 `https://liveradar.github.io`），新增首頁介紹卡/基本 SEO，修掉 FAB 擋住設定分頁的版面 bug，設定頁拿掉多餘的同步狀態顯示，部署版隱藏只有本機才動得了的「重新抓取」按鈕；另外實測驗證了恢復 GitHub Actions 自動排程會讓拓元／Ticket Plus 兩個來源持續被擋（403），正在規劃改用 Max 上班電腦的 Claude 排程任務代替，細節見文件尾端對應章節。M1~M12 全部跑完一輪，覆蓋率抽樣（M12）結果不好，過程中還發現 KKTIX 的搜尋策略被 Cloudflare 擋住。**2026-09-20 最新狀態**：Gist token 同步已經整個換成 Supabase 帳號登入，**已經動工完成並實測過**（真的登入成功、資料庫真的寫入資料）——只留 Google 登入，email/密碼那條路做完後又拿掉了，細節見文件尾端「Supabase 帳號登入上線」章節。2026-09-19 待整理清單也從 71 筆清到只剩 1 筆（見「待整理清單大清理」章節）。**同一天稍晚，Max 帶了一份參考實作過來（另一個 Claude 對話產出、已經有人實際跑起來的 Python/Flask 版本），示範了用 Playwright 真瀏覽器繞過 Cloudflare、外加幾個新來源的做法，因此：(1) 資料抓取改成純手動觸發（決策 S5，取消 GitHub Actions 排程），(2) 新增 iNDIEVOX、FANSI GO、Ticket Plus 三個 adapter（Max 一開始要求的完整來源清單全部做完了），(3) 用 Playwright 真的修好了 KKTIX 搜尋策略被 Cloudflare 擋住的問題，覆蓋率抽樣從 3.4% 一路推到 51.7%**——看下方各來源對應章節跟 `reports/coverage-sample-2026-09-17.md` 的完整過程。這份文件的目的：讓一個完全沒看過這個對話紀錄的人（包含未來的你，或另一台電腦上全新開的 Claude Code session）能在 5 分鐘內知道現在做到哪、能不能信任目前的程式碼、下一步該做什麼。

## 這是什麼專案

個人用的獨立/地下音樂演出雷達。**完整需求**看 [`LIVERADAR-SRS.md`](./LIVERADAR-SRS.md)，**技術架構與所有踩過的坑**看 [`LIVERADAR-SPEC.md`](./LIVERADAR-SPEC.md)——這兩份是唯一該信任的來源，這份 HANDOFF 只是導覽，內容有衝突以那兩份為準。

## 現在的狀態：M1~M12 全部完成，都在瀏覽器裡實測過，不是只寫完沒測（一個例外見下方 M9 那一列）；抓取一律手動觸發（決策 S5，沒有自動排程），五個來源（KKTIX/拓元/iNDIEVOX/FANSI GO/Ticket Plus，Max 要求的完整清單）都在運作，覆蓋率抽樣 51.7%，離 80% 目標更近了但還沒到

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| M1 | 專案骨架、7 個頁面殼、`styles/tokens.css` 設計系統 | ✅ |
| M2 | KKTIX adapter（org 頁 + 全站搜尋兩種策略）＋ normalize | ✅ 實測抓到真實資料 |
| M3 | 拓元 adapter ＋ dedup 跨來源合併（含午/晚場不誤併） | ✅ 有單元測試 `scripts/dedup.test.mjs` |
| M4 | 時間表首頁讀真實 `data/events.json` 渲染 | ✅ |
| M5 | 收藏／排除規則／復原 toast／已隱藏管理頁 | ✅ |
| M6 | `diff.mjs` 產生 `digest.json`＋修正 `first_seen_at` 只在真的新事件才重設；新上架頁；順便把 FR-34「已更新」badge 接到收藏頁 | ✅ 有單元測試 `scripts/diff.test.mjs` |
| M7 | 手動新增場次實際存檔到 localStorage（決策 S1：不寫回 repo），跟 `events.json` 合併顯示，真的被抓到後自動去重 | ✅ 有跨環境雜湊一致性測試 `scripts/id-consistency.test.mjs` |
| M8 | 待整理頁讀真實 `data/needs-review.json`；「指派藝人」產生 YAML 片段供人工貼到 `artists.yml`（見下方說明，不是自動寫檔） | ✅ |
| M9 | Gist 同步（連接/斷開/雙向同步/離線 fallback）＋ FR-63/64 匯出匯入、設定頁的嚴格模式與靜音關鍵字順便一起接上 | ⚠️ 見下方說明 |
| M10 | 來源異常告警（GitHub issue）、設定頁來源狀態儀表、時間表異常 banner | ✅（真的開 issue 那段沒有跑過真實 CI，見下方說明） |
| M11 | GitHub Actions 排程上線 | ✅ 排程已重新打開，每天 08:00 CST 自動跑；過程中發現並修好一個真實的資料損毀問題，見下方「M11 的重大發現」 |
| M12 | 覆蓋率抽樣 | ✅ 抽樣做完了，結果不理想（見下方），但這正是 G4 這一步該做的事——找出真正的缺口 |

完整里程碑定義見 `LIVERADAR-SPEC.md` §11。

## 你打開這個 repo 應該先做的事

```bash
npm install                       # cheerio, js-yaml, playwright 這些相依套件不會進 git
npx playwright install chromium    # 只需要跑一次；下載約 280MB 到 ~/Library/Caches/ms-playwright，也不進 git
npm run serve                      # 開本機伺服器（scripts/dev-server.mjs，2026-09-17 起不是 python http.server 了）
# 瀏覽器開 http://localhost:8000
```

⚠️ 忘記跑 `npx playwright install chromium` 的話，`npm run fetch`／設定頁的「重新抓取」按鈕會在 KKTIX 或 FANSI GO 那步直接噴錯（`browserType.launch: Executable doesn't exist...`）——這不是程式碼的 bug，是瀏覽器引擎沒下載，照錯誤訊息裡的指令跑一次就好。

`npm run serve` 現在是一個小型 Node 伺服器（決策 S5），不只是靜態檔案伺服器——設定頁的「🔄 重新抓取最新演出」按鈕只有透過它才會動作（呼叫 `POST /api/fetch` 執行 `fetch.mjs`）。**這個按鈕只在本機用 `npm run serve` 開的時候有效**，部署在 GitHub Pages 上的正式網站沒有後端，按了會顯示「無法連線到本機伺服器」的提示，這是預期行為不是 bug。

想看爬蟲 pipeline 真的動起來：

```bash
npm run fetch          # 會打真的 KKTIX / 拓元網站，跑完會覆寫 data/*.json
npm test                # 跑全部單元測試（見下方「測試怎麼跑」）
```

⚠️ **`npm run fetch` 目前一定會讓 `data/events.json` 變回空的**——不是 bug，是因為 `data/artists.yml` 現在只有兩筆示範資料（深海系樂團、ABC Band），跟真實抓到的樂團名字對不上，所有場次都會被歸類到「待整理」而不是正式清單。如果你想在畫面上看到真的資料流動，兩個選項：
1. 打開 `data/needs-review.json` 看看今天抓到哪些真實藝人，挑幾個手動加進 `data/artists.yml`，再跑一次 `npm run fetch`。
2. 或直接把假資料寫進 `data/events.json` 測 UI（我在做 M4/M5 時就是這樣測的，格式照抄現有的 `events` 陣列結構就好，測完記得換回 `npm run fetch` 產生的真資料，不要把假資料 commit 上去）。

## 開發時踩過、別再踩一次的坑

1. **絕對不要在一個 `export async function fetch()` 的檔案裡呼叫裸的 `fetch(...)`**——會遮蔽全域 Fetch API，變成無窮遞迴呼叫自己（花了很久才抓出來）。一律用 `globalThis.fetch(...)`。見 `scripts/adapters/kktix.mjs` 開頭的註解。
2. **拓元 tixcraft 的活動詳情頁抓不到**——有 JS 反爬蟲挑戰，一般 fetch 會被擋（`{"response":"identify"}`）。目前拓元 adapter 只抓列表頁（標題/日期/場館，沒有價格）。這是刻意的取捨（見 SPEC D16），不是沒做完。
3. **本機測試用瀏覽器開發時，如果改了 `.js` 檔案但畫面沒反應**，通常是瀏覽器快取住舊的 module 檔案，換個 port（例如 `python3 -m http.server 8001`）重開就會抓到新的，比硬重整可靠。
4. **背景執行長時間指令時，Node 的 `console.log` 在 stdout 被導向檔案時是全緩衝的**，不會即時寫入，會看起來像卡住。要看即時進度得用 `fs.appendFileSync` 寫檔（`scripts/progress-log.mjs` 已經這樣做了，看 `fetch-progress.log`，這個檔案不會進 git）。
5. **前端 `fetch("./data/events.json")` 一定要加 `{ cache: "no-store" }`**——不加的話瀏覽器分頁開著、或同一個 session 內重複導覽，會一直吃到舊的快取版本，即使檔案內容已經在磁碟上更新了。M7 測「手動新增場次被真實抓到後應該消失」時就是被這個絆住，才發現這個問題，已經修在 `src/app.js` 的 `loadEvents()`。
6. **日期比較不要用 `new Date(dateStr) > new Date()`**——`new Date("2026-10-15")` 會被當成 UTC 午夜，跟本地/台灣時間的「現在」比較時，同一天的場次在某些時段會被誤判成「已過期」。`scripts/normalize.mjs` 的 `statusFromTickets` 和 `src/filter.js` 的 `isPast()` 都踩過這個坑，兩處都已經改成用日期字串（`YYYY-MM-DD`）直接比較，不要再改回 Date 物件比較。
7. **`normalize()`（或任何 per-item 的 pipeline 處理函式）處理陣列時一定要包 try/catch**——單一筆原始資料格式異常就丟例外的話，會讓整個 pipeline run 中斷，當天完全不會更新，而不是只把那一筆丟進待整理。`scripts/fetch.mjs` 已經修好，之後新增 per-item 處理邏輯要延續這個模式。

## M11 的重大發現：GitHub Actions 的 IP 會被來源網站部分擋掉（已修好，且 2026-09-17 起這個問題本身不再相關）

⚠️ **2026-09-17 更新**：決策 S5 把資料抓取改成手動觸發（設定頁按鈕，見上面「你打開這個 repo 應該先做的事」），不再依賴 GitHub Actions 排程，所以下面這個「GitHub Actions IP 被擋」的問題已經**不會再發生**（因為根本不會再從 GitHub Actions 的 IP 發出抓取請求）。保留這段記錄是因為：(1) `scripts/source-fallback.mjs` 這個資料安全網仍然有用，本機手動抓取一樣可能遇到 KKTIX 搜尋被 Cloudflare 擋（見下面 KKTIX 搜尋策略那段），一樣需要它防止資料被洗掉；(2) 了解這段歷史有助於理解為什麼會有 S5 這個決策。

2026-09-16 手動觸發了一次 `workflow_dispatch`（在真的 GitHub Actions 環境跑，不是本機），結果：
- **拓元直接 403**（`GET https://tixcraft.com/activity -> 403`）——`notify.mjs` 正確地自動開了 [issue #1](https://github.com/Max-side/liveradar/issues/1)，這不是誤判，是真的被擋。
- **KKTIX 的全站搜尋策略（4 個場館：Legacy Taipei/Taichung、Revolver、Clapper Studio）也全部 403**，只有 org 頁策略還抓得到東西。

最可能的原因：這兩個網站的反爬蟲機制會擋掉常見的雲端/機房 IP 段（GitHub Actions runner 的 IP 就是這種），但放行一般家用/公司網路的 IP——這正好解釋了為什麼本機一直測都正常，只有在 Actions 上才出事。這個封鎖本身**沒有解決**，往後每次排程執行拓元和 KKTIX 搜尋大概率都還是會失敗，這是要接受的現實，不是一次性的意外。

**造成的損害**：因為 `fetch.mjs` 當時來源失敗時不會沿用舊資料（SPEC §4.2 步驟 3 那個已知缺口，原本以為只是「還沒做」，這次證實是「真的會出事」），那次執行直接把 `needs-review.json` 的 79 筆真實資料洗成 4 筆，而且自動 commit 推上了 `main`。已經用 `git revert`（583fe35）復原。

**已經修好的部分**：新增 `scripts/source-fallback.mjs`——來源異常時，把上一輪屬於這個來源的 `events.json`/`needs-review.json` 資料重新餵回這輪的處理流程（而不是讓它們憑空消失），再讓 `dedupe()` 用同一套邏輯跟其他來源這輪抓到的新資料合併。**已經在真實 GitHub Actions 環境重跑一次驗證**：同樣的 403 又發生了，但這次 needs-review 維持在 79 筆，commit 只改了 6 行 metadata，不再洗掉真實資料（對照組：修好前 vs 修好後的兩次真實執行紀錄都在 [Actions 頁面](https://github.com/Max-side/liveradar/actions/workflows/daily-update.yml)上）。排程已經重新打開。

**這個 fallback 解決的是「不要洗掉資料」，不是「解決封鎖」本身**——拓元/KKTIX 搜尋策略只要一直被擋，`needs-review.json`/`events.json` 就會一直停在 2026-09-16 這批舊資料，不會有新場次進來，只是不會再變得比現在更差。如果之後想真的解決封鎖（換執行環境、代理、或接受混合模式改成本機手動跑那兩個來源），是下一個獨立的產品/架構決定，不算 M11 的範圍。

## M10 的告警：本機不會打 API，但已經在真實 GitHub Actions 上驗證過

`scripts/notify.mjs`（FR-14/AC-14，來源抓到 0 筆但上次 >0，或直接 fetch 失敗時開 GitHub issue）只在有 `GITHUB_TOKEN`＋`GITHUB_REPOSITORY` 環境變數時才會真的打 API，本機 `npm run fetch` 沒有這兩個變數，所以永遠是「印一行 log 就跳過」，這是刻意設計成不會擋住本機開發。已經驗證過的：
- `scripts/source-status.mjs`（純函式，決定 sources.json 每個來源的 `status`/`last_success`/`last_count` 該怎麼算）有完整單元測試，包含「連續兩天都抓到 0 筆要一直維持異常，不能第一天過後自己「痊癒」」這條容易漏掉的規則。
- 前端兩處讀 `sources.json` 的地方（時間表的異常 banner、設定頁的來源狀態儀表）都在瀏覽器裡塞了假的 `ok`/`anomaly`/`error` 三種狀態實測過，畫面正確。
- M11 實際觸發真實 GitHub Actions 執行時，`notify.mjs` 真的成功開了 [issue #1](https://github.com/Max-side/liveradar/issues/1)，第二次執行時也正確認出 issue 已存在、沒有重複開新的——這部分已經不是「沒測到」了，見下方「M11 的重大發現」。

## M9 沒有真的用 GitHub PAT 測過

沒有可以用的 real token，所以 Gist 同步的「連接→抓現有 gist 或建立新的→雙向同步」整條路徑**沒有打過真的 GitHub API**。已經在瀏覽器裡實測、行為正確的部分：
- 貼假的/失效的 token 按「連接同步」→ 收到 401 → 顯示失敗提示 → 本機的收藏/排除/靜音關鍵字/嚴格模式**完全沒被清空或覆蓋**（這是 AC-65 的負向測試，最重要的一條）。
- 沒連接時（`gist_id` 是 `null`），`reconcileGistSync()` 在每個頁面載入時是純同步的 early return，完全不會發網路請求——不會拖慢或弄壞現有頁面。
- FR-63 匯出／匯入：匯出時會即時抓 `localStorage` 目前的 prefs，模擬「換一台空白瀏覽器」匯入後 favorites/excluded_artists/excluded_types/mute_keywords/strict_mode 全部正確還原（AC-63）。

**沒測到的**：真的拿一組 GitHub PAT 連接、在兩台裝置間實際互推/互拉一次。如果你要驗證這塊，去 GitHub Settings → Developer settings → Personal access tokens 開一個只有 `gist` 權限的 token，貼到設定頁試連接；連上後第二台裝置貼**同一組 token**應該會自動找到同一個 gist（用 description 比對，見 `LIVERADAR-SPEC.md` §8 實作備註）。

## M8「指派藝人」為什麼不會真的寫 `artists.yml`

這是刻意的（SPEC §11 M8 那一列寫得很明白：「本機開發時手動 commit，非使用者操作」）。這個專案是純靜態前端（決策 D14），沒有後端可以接受寫檔請求，瀏覽器本身也不能直接改動 repo 裡的檔案。所以 `review.html` 的「指派藝人」按鈕做的事情是：跳出一個小表單（正式藝人名稱／別名／來源地），送出後產生一段格式跟 `data/artists.yml` 一致的 YAML 片段，顯示在可複製的文字框裡——由你自己貼進檔案、存檔、commit。按下「指派藝人」或「忽略」都會把該筆記錄從畫面上的待整理佇列裡移除（存在 `localStorage` 的 `liveradar:review_dismissed`，只影響這個瀏覽器，不會跨裝置同步，也不會改到 `needs-review.json` 本身——那個檔案要等下一次 `npm run fetch` 讀到更新後的 `artists.yml` 才會自然瘦身）。

## 測試怎麼跑

```bash
npm test    # 等同 node --test scripts/*.test.mjs src/*.test.js
```

目前 23 個測試全過。`scripts/*.test.mjs` 測 pipeline（dedup/normalize/diff/id 一致性），`src/*.test.js` 測前端純邏輯（目前只有 `filter.js`）——兩邊都用 Node 內建的 `node:test`，沒有額外測試框架依賴。新增前端純函式時比照 `src/filter.test.js` 加測試就好。

## 決策紀錄在哪裡

所有「為什麼這樣做」的決定都寫在 `LIVERADAR-SPEC.md` 對應章節，不要用猜的或憑記憶——尤其是：
- §5.1 KKTIX 兩種抓取策略（org 頁 vs 全站搜尋）的原因
- §5.3 拓元只抓列表頁不抓詳情頁的原因（D16）
- §7 手動新增場次為什麼只存 Gist 不寫回 repo（S1）
- §12 三個開發前拍板的決策（S1/S2/S3）

## 設計稿

見 `README.md` 裡的連結（Claude Design 畫布，跟帳號綁定，不是本機檔案）。

## M12 覆蓋率抽樣結果：3.4%，遠低於 80% 目標——但根因很明確

完整報告在 [`reports/coverage-sample-2026-09-17.md`](./reports/coverage-sample-2026-09-17.md)。方法：拿獨立的彙整站
[Artists.tw](https://www.artists.tw/gigs) 當基準（SRS 決策 D11），抽最近期 29 場音樂演出人工比對，只中了 1 場。

**根因不是 adapter 壞掉，是追蹤的場館清單本來就只有 9 個**（The Wall、海邊的卡夫卡、pipelivemusic、Emerge Livehouse ×2、Legacy Taipei、Legacy Taichung、Revolver、Clapper Studio），而 Artists.tw 光是「近期至少 3 場演出」的場館就有 44 個——女巫店、Zepp、Blue Note、SUB Live House、FINAL、文昌號、Legacy TERA、野地方、凝聚力等等全部不在清單裡，抓不到完全是預期中的事，不是 bug。

## KKTIX 搜尋策略現況更新（2026-09-17）：比 M11 記錄的還嚴重

嘗試擴充場館清單時發現：`kktix.com/events?search=...` 這個全站搜尋端點**現在會被 Cloudflare 的機器人驗證擋下（403 + JS challenge 頁）**，而且用跟 adapter 完全一樣的 `fetch()` 方式、換上真的瀏覽器 User-Agent，**在本機也一樣被擋**——不是像 M11 記錄的那樣「只有 GitHub Actions 的機房 IP 才會被擋」，是這個端點本身現在對所有非瀏覽器的 HTTP 請求都擋。

**代表現有的 4 個 `SEARCH_VENUES`（Legacy Taipei、Legacy Taichung、Revolver、Clapper Studio）現在其實完全抓不到新資料，不分執行環境**，跟 `ORG_PAGE_VENUES`（The Wall 那 5 個）用的是完全不同、目前還正常的端點（`<org>.kktix.cc/`，plain fetch 直接 200）。

這對「擴充場館」這件事的影響：新場館如果是像 Zepp、Blue Note 那種「租場地給不同主辦方」的類型（親自查證過 Blue Note 一場演出的主辦帳號是 `romanticoffice`，不是 Blue Note 自己），本來就得靠現在壞掉的搜尋策略才能抓，**目前技術上就是抓不到，不是清單沒加**。唯一還可行的擴充路徑是找「自己開 KKTIX 帳號、自己辦自己所有場次」的自營場館（跟 The Wall 同一類），但連這條路都不保證——例如查證過女巫店雖然在 KKTIX 上有帳號，但帳號完全沒有活動（「目前沒有公開活動」），代表它主要根本不是用 KKTIX 賣票。

要真的修好搜尋策略，得考慮換成能執行 JS、通過 Cloudflare 驗證的做法（例如 headless 瀏覽器），這是比「加場館」更大的架構改動，也要考慮這樣做算不算在鑽網站反爬蟲機制的漏洞——**沒有在這次順手做，留給你決定要不要投入**。

## 追蹤名單巡檢怎麼運作（FR-19 的免費/手動版本，2026-09-17 起）

跟自動化 pipeline 分開的另一條路：`data/watchlist.yml` 存你想追蹤的藝人/場館/主辦名字，但**這份檔案不會被任何程式自動讀取**——用法是你直接在 Claude Code 對話裡跟我說「照追蹤名單查一次」，我就會像做 M12 抽樣時一樣，用瀏覽器工具實際去搜尋、瀏覽、彙整每個名字最近的台灣演出公告給你看。

這個模式完全免費（用你既有的 Claude 方案，不需要另外申請 API key），但代價是**不會自動發生**——沒有排程會自己每天幫你查，你要記得主動開口。跟 FR-19 原本設計的「每週自動巡檢」不同，是刻意的取捨：自動化那個版本需要串一個會計費的 AI API，這個手動版本不用，細節見這次對話紀錄裡跟 Max 討論的權衡（GitHub Actions 排程 vs 自己常駐機器 vs 手動觸發，三種都不能讓 AI 搜尋本身免費，只有「你在對話裡主動問」才不用另外付費）。

## 參考實作：另一個 Claude 對話產出的 Python/Flask 版本（2026-09-17）

Max 帶來一份別人已經實際用起來的參考專案（zip 檔，內容不在這個 repo 裡，只用來借鏡技巧）。跟現在的 LiveRadar 比，功能簡單很多（沒有 PWA、沒有跨裝置同步、沒有 artist 正規化/去重、單機 Flask app），但解決了兩個關鍵技術問題：

1. **用 Playwright（真的 Chromium 引擎）繞過 Cloudflare**——對 KKTIX、FANSI GO 用真瀏覽器載入頁面，讓 Cloudflare 的驗證正常跑完，跟 `fetch()`/`curl` 完全不同層級。理論上可以拿來修好現在壞掉的 `SEARCH_VENUES`。
2. **多兩個沒有 Cloudflare、覆蓋率很高的來源**：
   - **iNDIEVOX**——伺服器端直接渲染，plain fetch 就能抓，不需要 Playwright，全站抓不用像 KKTIX 一樣一個場館一個場館試。
   - **FANSI GO**（go.fansi.me）——需要 Playwright（Cloudflare + 前端渲染），但涵蓋不少 LiveRadar現在碰不到的場館。

實測：拿它跑出來的 98 筆資料對照 M12 的 29 場覆蓋率樣本，**直接多中 5 場**（Suming@SUB Live House、P!SCO-16@Legacy Taichung、乙水@LIVE WAREHOUSE、虎小島@野地方、《https://》@百樂門酒館），覆蓋率估計可以從 10.3% 推到 27.6%——比繼續一個一個查證 KKTIX 自營場館的投報率高很多。

## iNDIEVOX 完成了（2026-09-17）

新增 `scripts/adapters/indievox.mjs`，沒有 Cloudflare、plain fetch 直接可用。實測一次真的跑了 75 筆場次進 `needs-review.json`（意料中的事——`artists.yml` 只有 2 筆示範資料，這些都還沒被辨識，等你補 artists.yml 或用待整理頁指派後才會變成正式場次）。

**過程中修的幾個真實 bug（都在 `normalize.mjs` 的 `parseIndievoxDate`）**：iNDIEVOX 的日期是主辦方自己貼的自由格式文字，不是固定欄位，實測到至少三種寫法要分別處理（`2026.09.19`、`2026 / 10 / 2` 帶空白、`2026年10月3日` 純中文單位），還有一個有趣的坑：某些活動頁面除了介紹文字的日期，下面訂購表單還有第二個「日期：9/19」（沒有年份），原本的 regex 會不小心抓到後者，改成「解析結果必須含 4 位數年份才採用，不然退回列表頁的日期」才穩定。細節見 `LIVERADAR-SPEC.md` §5.4，測試在 `scripts/normalize.test.mjs`。

場館/城市：多數活動有「場館名稱（地址）」可以直接判斷城市；少數只寫裸名稱的（例如「野地方 Wildlab」）退回 `data/venues.yml` 查表；個位數活動完全沒填地點，只能留空，不強求。價格解析沒做（跟拓元一樣的取捨，D16 精神），`price_min/max` 一律 `null`。

## FANSI GO 完成了，KKTIX 搜尋策略也真的修好了（同日稍晚）

新增 `scripts/adapters/fansi.mjs` + 共用的 `scripts/browser.mjs`（Playwright 啟動/關閉邏輯，`kktix.mjs` 也在用）。FANSI GO 是純 client-side render（Next.js），伺服器回應的 HTML 完全沒有場次資料，跟 Cloudflare 無關，一定要真的執行 JS——這跟 KKTIX 的情況不一樣，但解法一樣（真瀏覽器）。沒有任何結構化場館欄位，用列表卡片的「organizer」欄位頂替 venue（常常是真的場館，但有時是廠牌/主辦方名稱），跟拓元共用同一套 `parseTixcraftDate`/`parseTixcraftVenue`（格式剛好一樣：`YYYY/MM/DD` 無時間、裸場館名稱查 `venues.yml`）。

**順便把 KKTIX 的 `SEARCH_VENUES`（M11/M12 記錄的 Cloudflare 擋爬蟲問題）也改用 Playwright 修好了**——`fetchSearchResultUrls` 現在透過 `scripts/browser.mjs` 的 `withPage()` 執行，實測 4 個搜尋場館（Legacy Taipei/Taichung、Revolver、Clapper Studio）**這次全部成功，0 個失敗**，不是像之前複查覆蓋率時那樣「這次剛好沒被擋」的運氣。`fetchOrgListing`／`fetchEventDetail` 沒有改，這兩個端點本來就沒被擋，維持 plain fetch。

用同一份 M12 的 29 場覆蓋率樣本再測一次：**8/29 ≈ 27.6%**，而且這次每一場都是穩定可重現的結果。完整記錄見 `reports/coverage-sample-2026-09-17.md` 的「再次追蹤」段落。

**新增相依套件注意**：`npm install` 之後還要跑一次 `npx playwright install chromium`（見上面「你打開這個 repo 應該先做的事」），忘記跑的話 KKTIX/FANSI GO 那兩步會直接報錯說找不到瀏覽器執行檔。

## Ticket Plus 也完成了——五個來源全部做完（同日晚上）

新增 `scripts/adapters/ticketplus.mjs`。**這是五個來源裡資料品質最好的一個**：整個平台是靠一個公開、不需要登入/API key 的 JSON API 運作（`apis.ticketplus.com.tw/config/api/v1/getS3?path=...`），`date`/`time`/`location`/`address` 全部是乾淨的結構化欄位，不用像 iNDIEVOX/FANSI GO 那樣解析自由格式文字，也不用 Playwright。`location`/`address` 兩個欄位組成的字串跟 KKTIX 的 `venue_raw` 格式完全一樣，直接重用 `parseKktixVenue`；日期新寫了 `parseTicketPlusDate`。細節見 `LIVERADAR-SPEC.md` §5.6。

**這次追加對覆蓋率的貢獻最大**：用同一份 29 場樣本再測一次，**15/29 ≈ 51.7%**（原始 3.4% 一路推到現在），單是加入 Ticket Plus 就多命中 7 場（溫室雜草、Mili、呂杰達、RUSH BALL ×2、巴賴、JIAHN），因為它剛好覆蓋了女巫店、Zepp New Taipei、The Wall 這幾個先前五個來源都碰不到的場館——這些場館主要就是透過 Ticket Plus 賣票。完整記錄見 `reports/coverage-sample-2026-09-17.md`「第三次追蹤」段落。

至此 **Max 一開始要求的完整來源清單（KKTIX、拓元、iNDIEVOX、FANSI GO、Ticket Plus）全部做完了**。

## artists.yml 第一批補完——events.json 從 0 筆變成 244 筆（同日深夜）

`data/artists.yml` 原本只有 2 筆示範資料，342 筆待整理裡幾乎全部卡在「無法辨識藝人」，`events.json` 一直是 0 筆。照 D15 的精神（AI 先草擬，人工確認）做了第一批補完：

- 逐一看過全部 342 筆原始標題，手動判斷每一筆的主秀藝人，草稿先寫進 `data/artists.yml`（沒有直接 commit，讓 Max 用 `git diff` 審過一輪）加了約 230 筆新條目。
- **同時發現並排除了混進資料裡的非音樂雜訊**——拓元／Ticket Plus 什麼票都賣，`needs-review.json` 裡混了棒球票（福岡軟銀鷹、北海道日本火腿鬥士隊）、籃球季票（TPBL 新竹攻城獅）、按摩課程（Feedback Fascial Tools，出現 13 次！）、角色展覽（CHIIKAWA DAYS）、紋身藝術節、甚至一顆蛋黃酥（「陳耀訓・麵包埠」）。這些**故意沒有**加進 `artists.yml`——加了也不該被辨識成音樂演出，它們會繼續留在待整理頁，用「忽略」按鈕手動清掉就好，不需要改程式。
- 過程中用 `matchArtists()` 直接對照全部 342 筆原始標題驗證（不用真的重新爬網），抓到**一個真實的 bug**：加的「IVE」（韓國女團）當 canonical 太短，會是英文單字「LIVE」的子字串，造成 36 筆完全不相關的場次被誤判成也有 IVE 參演（例如「Kiefer LIVE IN TAIPEI」）——改成用更完整的「IVE WORLD TOUR」修好。這是子字串比對這種簡單機制的通病，往後新增短的英文藝人名字（3-4 個字母內）都要小心做這種交叉檢查。
- 真的跑一次 pipeline 驗證：**`events.json` 從 0 筆變成 244 筆**，`needs-review.json` 從 342 筆降到 64 筆（剩下的大多是上面提到的非音樂雜訊，或拼盤演出真的看不出主秀是誰的情況）。

**過程中又抓到第二個真實 bug（跟 artists.yml 無關，是既有的城市判斷邏輯）**：`normalize.mjs` 的 `CITY_NAMES` 只認「台北/台中/台南/台東」的簡化字，Ticket Plus 的地址欄位卻一律用「臺北/臺中/臺南/臺東」正體字，導致將近 40% 促銷成正式場次的活動 `city` 變成「未知」——跟 M12 追場館時在 `kktix.mjs` 修過的同一種坑，這次改成在 `normalize.mjs` 集中修（`CITY_NAMES` 從純字串陣列改成 `{match正規表示式, city}`），KKTIX/iNDIEVOX/Ticket Plus 都吃得到這個修正，不用每個來源各修一次。順便修了地址前面帶郵遞區號（例如「100台北市中正區...」）也認不出來的問題。修完後 `city: 未知` 的比例從 96/243 降到 50/244——剩下的大多是 FANSI GO 用主辦方/廠牌名稱頂替場館（例如「夢迴夜行有限公司」「兜圈策展工作室」，這些真的不是場館，查不到城市是預期中的事）跟少數場館名稱在 `venues.yml` 裡還沒收錄，兩者都不是新 bug，是已知、可以之後再慢慢補的缺口。

**這一批標了 ⚠️ 的短字/常見字 canonical 值得之後留意**（在 `data/artists.yml` 裡搜尋 `⚠️` 可以找到），例如 `Cowman`、`yeti`、`Kaya`、`SIGH`、`王立`——目前在這批資料裡沒有造成誤判，但如果之後新抓到的場次標題剛好包含這些字，要留意是不是又是一次 IVE/LIVE 那種假陽性。

## artists.yml 補完後重新 review 一次，抓到 10 個問題，全部修掉了（2026-09-17 再晚一點）

補完 230 筆藝人資料、程式碼量變大之後，Max 要求「再重頭 review 一次看有沒有 bug」——用 `code-review` skill 高強度模式（8 個角度平行找、逐一驗證）過一次目前還沒 commit 的變更，抓到 10 個問題，確認後全部修掉：

- **真的又有一組 IVE/LIVE 等級的子字串誤判**：canonical `ASCA` 是 `派偉俊` 的別名 `Patrick Brasca` 的子字串（不分大小寫："brASCA" 包含 "asca"）。實測 `matchArtists('派偉俊《愛火山的人》PATRICK BRASCA 專場', ...)` 真的多標了一個不該有的 `ASCA` tag。修法：直接把 `Patrick Brasca` 這個別名拿掉——現有 342 筆原始資料沒有任何一筆真的需要它，是我當初憑常識加的，不是照實際資料加的。
- **`venues.yml` 完全沒吃到台/臺正體字修正**：M12 那次的修法只改了 `normalize.mjs` 的 `cityFromAddress`（給地址欄位判斷城市用），`parseTixcraftVenue()` 拿 `venue_raw` 去對 `venues.yml` 的比對邏輯完全沒改到——`parseTixcraftVenue('臺北小巨蛋', venuesYml)` 實測還是回傳 `city: null`。連帶發現同一套正體字問題其實散落在三個地方各自維護一份（`normalize.mjs` 的 `CITY_NAMES`、`kktix.mjs` 的 `SEARCH_VENUES`、`venues.yml` 的比對邏輯），維護成本會越來越高。**重構成一個共用函式** `normalizeTraditionalChars()`（`scripts/normalize.mjs` 匯出），三個地方都改成呼叫它，`venues.yml` 裡原本重複的「臺北大巨蛋」條目也一併刪掉。
- **郵遞區號拆分沒處理連字號格式**：`address.replace(/^\d+/, "")` 抓不到 Ticket Plus 較新的「100-01台北市...」這種帶連字號的郵遞區號格式，改成 `/^\d+(-\d+)?/`。
- **`matchArtists()` 回傳順序是資料檔順序，不是標題裡真正的出場順序**：`headliners[0]` 在其他地方被當成「主秀藝人」使用（排除選單顯示、`tags_origin` 預設值、`dedup.mjs` 算 id），但只有 2 筆資料時這個問題不明顯，補完到 230 筆之後多主秀拼盤場次變得常見，「主秀」變成看誰在資料檔裡宣告得早，而不是誰在標題裡真的排第一。修法：`matchArtists()` 改成依照每個命中字串在標題裡的字元位置排序，不是依資料檔順序。
- **`tags_origin` 只取 `headliners[0]` 一個人的出身地區，多主秀場次會漏掉其他人的**：改成對所有辨識到的 headliners 取出身地區的聯集（去重）。
- 補了一個系統性防護測試（`scripts/normalize.test.mjs`）：把 `data/artists.yml` 全部 232 筆的 canonical/alias 兩兩交叉比對，只要有任何一組出現不分大小寫的子字串包含關係就直接測試失敗——目前是 0 筆，之後新增資料如果不小心又造出一組 IVE/LIVE 或 ASCA/Brasca 這種組合，`npm test` 會直接抓到，不用等到真的抓資料才發現。
- 其餘幾個屬於整理/簡化類（重複邏輯、過度工程化的修法），跟上面的正體字重構是同一套一起解決的。

修完後跑了 `npm test` 跟一次完整的五來源真實 pipeline 驗證，結果又抓到**第三個真實案例的同類 bug**：canonical `FLOW`（真實存在的日本搖滾樂團）比對到 LE SSERAFIM《PUREFLOW》巡演標題裡的「PUREFLOW」——跟 IVE/LIVE、ASCA/Brasca 是一模一樣的問題，這次是直接在真實抓到的資料裡當場發生，不是憑空想到才發現的。

三次同一種 bug 出現，說明問題出在 `matchArtists()` 用 `.includes()` 做純子字串比對這個機制本身，不是每個名字剛好「運氣不好」——逐一改名字（IVE→IVE WORLD TOUR）不會 scale。這次改成**從根本修**：純英文/數字（ASCII）的 canonical 或別名比對時要求前後是「字邊界」（前後字元不能也是英文字母/數字），中文/混合字元的名字維持原本的純子字串比對（中文本來就沒有空白分詞，字邊界這個概念套不上，而且中文名字被包在更長標題字串裡本來就是正常、正確的情況）。

修好後拿現在真實抓到的全部 309 筆標題（`events.json` + `needs-review.json`）把所有 4 個字以內的純英文 canonical/別名（`FKJ`、`DOMi`、`BTS`、`QWER`、`ASCA`、`FLOW`... 等 23 個）都跑過一次 `matchArtists()`，逐一核對比對到的場次真的是那個藝人本人的演出，沒有一個是誤判，確認這次修法有效解決整個問題類別，不是又補一個特例。

`npm test` 全過（50 個測試，含新增的 5 個：headliners 排序、tags_origin 聯集、系統性 collision 防護、FLOW 字邊界修正、中文名字不受字邊界影響）。

## 打開網頁肉眼檢查，又抓到兩個真實的場館判斷 bug（2026-09-18）

`artists.yml` 補完、code review 修完、都 commit 之後，第一次真的啟動 `npm run serve` 打開瀏覽器滑一輪時間表、待整理、設定頁（用的是 `.claude/launch.json`，這個檔案原本還停在 S5 之前的 `python3 -m http.server` 舊設定，已經一併更新成 `npm run serve`）。畫面渲染大致正常（多主秀標籤、指派藝人對話框、來源狀態都對），但肉眼掃過場館/城市欄位時抓到兩個真實資料 bug：

1. **「台北流行音樂中心表演廳」被標成 `city: 高雄`**——`venues.yml` 的「流行音樂中心」比對條目太籠統，同時撞到台北跟高雄兩座流行音樂中心，卻寫死城市是高雄。拆成「台北流行音樂中心」「高雄流行音樂中心」兩筆更明確的條目修好。
2. **三個場館完全沒收錄進 `venues.yml`**（台北國際會議中心TICC、新北市工商展覽中心、桃園陽光劇場），變成 `city: 未知`——這幾個場館名稱本身就寫著城市名，用一個小腳本比對「venue 文字裡提到的城市」跟「實際判定的 city」找出來的，不是逐筆肉眼看。補上後 `city: 未知` 從 50 筆降到 42 筆。

修完重跑一次真實 pipeline 驗證過（`npm test` 50 個測試全過，畫面上 LEE YOUNGJI／鼓鼓／派偉俊那幾場台北流行音樂中心的場次都改顯示台北了）。

**同時發現一個跟這次改動無關、範圍更大的既有缺口**：首頁上方「全部城市」「10月」「價格」三個篩選 chip（`index.html` 的 `.filter-row`）是完全沒接上任何邏輯的靜態裝飾，點下去沒有任何反應。底層的篩選邏輯其實已經寫好也測過——`src/filter.js` 的 `passesViewFilters(event, viewFilters)` 支援 `city`/`month`/`priceMax`——但 `app.js` 從來沒有把任何 UI 互動接到這個函式的 `viewFilters` 參數上。Max 確認要做，已經補上（見下一節）。

## 補上首頁的城市/月份/價格篩選 chip（2026-09-18 再晚一點）

三個 chip 現在都是真的 `<button>`，點下去彈出跟既有排除選單同一套視覺的 bottom sheet（`src/interactions.js` 新增 `openFilterSheet()`），單選、點了立刻套用並關閉：

- **城市／月份選項是動態算出來的**，不是寫死清單，而且**只看還沒結束的場次**——一開始沒濾掉已結束場次時，選項清單會出現「7月」「8月」這種選了保證是空清單的死選項（今天是 9/18，7、8 月的場次全部已經過去了），這是實作時自己測出來、當場改掉的，不是等使用者回報。
- **價格**是固定 4 個級距（NT$500/1,000/2,000/3,000 以下）+「不限價格」，沒有價格資料的場次（iNDIEVOX/FANSI GO 大宗）不管選哪個級距都照樣顯示——這是 `passesViewFilters()` 本來就有的設計（`price_min` 是 `null` 時一律放行），不是這次新加的行為。
- 篩選狀態存 `localStorage`（`liveradar:view_filters`），重新整理頁面會記得上次選的；**刻意不放進 Gist 同步的 `UserPrefs`**——這是「當下在看什麼」的畫面狀態，不是像封鎖藝人那種要跨裝置生效的規則。
- 三個篩選可以同時疊加（例如台北 + 10月 + NT$500以下），實測過確認會一起生效。

`npm test` 沒有新增測試（這次是純前端 DOM 互動，跟既有的 `openExcludeMenu()`／`openAssignArtistDialog()` 一樣沒有寫測試，用瀏覽器實測代替），但有打開瀏覽器逐一測過三個 chip 單獨、疊加、reload 後還記得選擇、選到空清單時的空狀態訊息。

## 補上頂部的搜尋功能（2026-09-18，Max 打開瀏覽器點了放大鏡才發現又是一個死裝飾）

跟上面的篩選 chip 一樣的情況——頂部搜尋按鈕原本完全沒接邏輯，Max 打開瀏覽器點下去沒反應才發現的。這次要求「搜藝人或標題就好，搜尋後切到獨立的搜尋頁」，做法：

- 新增 `search.html`（跟 `review.html`/`add.html` 同一種「有返回鍵、沒有底部導覽列」的子頁面樣式），`src/app.js` 新增 `initSearch()`。
- 輸入框即時比對（不用按 Enter），比對 `title_raw` 跟 `lineup`（所有辨識到的演出者，不只 headliners），不分英文大小寫。
- 套用跟時間表一樣的排除規則（`partitionEvents`）——搜尋不會讓已封鎖的藝人繞過規則跑出來；但**不**套用城市/月份/價格畫面篩選，也**不**搜尋已結束的場次，這是獨立的「找東西」功能。
- `index.html`/`new.html`/`favorites.html` 頂部的搜尋圖示從無動作的 `<button>` 改成純連結 `<a href="./search.html">`。

實測過：輸入「RUSH BALL」正確抓到 3 場（含拼盤場次）、輸入「派偉俊」正確抓到 1 場、輸入不存在的關鍵字顯示正確的空狀態訊息、在搜尋結果卡片上收藏/取消收藏正常運作、返回鍵正確回到時間表頁。`npm test` 50 個測試全過（純前端功能，沒有新增測試，跟篩選 chip 那次一樣用瀏覽器實測代替）。

## 補上票價：Max 發現票價其實都寫在「節目介紹」自由格式文字裡（2026-09-18，還在同一天）

Max 打開真實網頁發現拓元/iNDIEVOX/Ticket Plus/FANSI GO 的票價其實都寫在自由格式的介紹文字裡，要求連這個也一起抓出來。查證後四個來源真的都有，只是格式差很多：拓元「🎫 票價：NT$3,380起至NT$7,980」、iNDIEVOX「9900元 / 3500元」（沒有 $ 符號）、Ticket Plus「$1,000/ $1,800」、FANSI GO 甚至用全形字「ＮＴ＄５００」或純冒號「預售票：600」（沒有任何貨幣符號）。

寫了一個共用的 `parsePriceFromText()`（`scripts/normalize.mjs`）處理這些差異：先找「票價」/「門票」標籤，只在那一行裡找 `$`/`NT$` 開頭或「元」結尾的數字（刻意只在那一行找，不掃整頁，才不會把後面「系統服務費200元」這種不相關的數字也算進去）；找不到標籤的話（FANSI GO 完全沒有），退而求其次找「預售/現場/單人/雙人/ADV/DOOR」這類字眼旁邊的數字。全形字先轉半形再比對。57 個測試全過，含 6 個直接用四個來源真實文字寫的案例。

三個來源取得成本不一樣：
- **iNDIEVOX、Ticket Plus 幾乎零成本**——iNDIEVOX 票價就在本來就會抓的同一個詳情頁裡，多抓一行字而已；Ticket Plus 多打一個一樣公開、不用登入的 JSON API（`event/{id}/event.json` 的 `info` 欄位）。
- **拓元、FANSI GO 要多開一次瀏覽器分頁**——這兩個來源的價格藏在需要 JS 渲染的內容裡，只能多一次 Playwright 分頁載入才拿得到，是真的會拉長抓取時間的部分。

**過程中抓到一個自己寫的真實 bug**：第一次真的跑起來，拓元跟 FANSI GO 的票價命中率是 **0%**——原因是 `page.$eval()` 在頁面剛載入完 DOM 的當下就去讀元素，但票價所在的區塊（`#intro`/`.prose`）是網站自己用 JS 晚一點才塞進去的內容，`$eval` 不會等，直接抓不到就整個失敗，而且失敗被我自己寫的 `.catch(() => "")` 悄悄吞掉，看起來像「執行成功但沒資料」而不是報錯。改成先 `waitForSelector` 等元素真的出現、拿掉那個吞錯誤的 catch 之後，重新整個抓一次，覆蓋率從錯誤版本的 53.1%（127/239）修到 **80.0%（192/240）**：拓元 51/59、iNDIEVOX 42/58、FANSI GO 13/19、Ticket Plus 66/84、KKTIX 20/20（本來就 100%，沒受影響）。

**代價：抓取時間變長，而且拓元這次抓起來比預期久很多**。修 bug 前第一次整個 pipeline 跑了約 14 分鐘（比之前的 6 分鐘基準線多了一倍以上）；修掉 Ticket Plus 多餘的延遲之後，第二次重跑總共花了約 **19 分半**（03:27:30 開始，03:47:00 結束），但拆開來看**拓元這次自己就花了 9 分鐘**（79 場，只有 2 場因為等 `#intro` 出現超時 20 秒失敗）——比第一次修 bug 前的 1 分57秒版本慢了非常多（雖然那個版本其實是全部靜默失敗、沒有真的等到內容，所以那個時間本來就是假的、不能拿來比）。這個「拓元詳情頁到底要多久」目前還沒有一個穩定、可預期的數字，值得之後再觀察幾次真實執行，不排除是網站當下的回應速度、還是瀏覽器分頁重複開關的資源競爭問題——先如實記錄，還沒有結論。

Max 因此提出「重新抓取要在 30 秒內」的目標，討論後確認純靠即時抓 5 個外部網站不可能做到（就算拿掉票價、拿掉所有延遲，iNDIEVOX 一個來源就要對自己的網站發 75 次以上請求）。討論到兩個方向：(1) 五個來源改成平行抓取而非依序排隊；(2) 換成「定期預先抓好存資料庫、網頁只讀資料庫」的架構（Max 提了 Neon Postgres）。

## 五個來源改成平行抓取（2026-09-18，同一天再晚一點）

`scripts/fetch.mjs` 原本是 `for (const adapter of adapters)` 依序 `await` 每個來源，改成 `Promise.allSettled(adapters.map(...))` 一次全部平行送出去——五個來源打的是完全不同的外部網站，彼此之間本來就沒有共用的禮貌性流量限制需要互相等待。抽出一個 `runAdapter()` 函式包住「抓取→分類狀態→異常時取用上次資料→逐筆 normalize」整套邏輯，讓每個來源可以獨立平行跑，且**用 `allSettled` 不是 `all`**——`runAdapter()` 內部已經把每種已知的失敗都包起來、理論上不會真的 reject，但如果 `classifySourceRun` 這類輔助函式本身出現未預期的錯誤，`allSettled` 能確保不會因為一個來源的意外錯誤，把其他四個來源已經抓好的成果也一起賠掉。

實測：平行版本跑一次總共 **8 分 52 秒**（03:52:16 開始，04:01:08 結束），比修 bug 前的依序版本 19 分半快了超過一倍。`data/sources.json` 五個來源都是 `status: "ok"`，筆數（KKTIX 25、拓元 79、iNDIEVOX 75、FANSI GO 26、Ticket Plus 134）都跟平行化之前的正常數字一致，`npm test` 57 個測試全過，沒有因為改成平行而出現資料混雜或遺漏的跡象。

**但離「1 分鐘內」還很遠，而且拓元這次自己就吃掉了全部 8 分 52 秒**——平行化本身只解決「五個來源互相排隊等待」這件事，沒有解決「拓元的 79 場詳情頁 Playwright 抓取為什麼這麼慢」這個之前就記錄過、原因還不確定的問題（見上一節）。這代表光靠平行化不夠，還需要下一節的增量抓取才有機會真的壓到 1 分鐘內。

## 增量抓取：已經抓過的場次不再重新抓（2026-09-18，Max 提的想法，已做完）

Max 對「1 分鐘內」的真正需求釐清後（不是要求整個爬蟲動作本身低於 1 分鐘這種違反物理限制的事，而是希望更新體驗夠快），Max 自己提出一個關鍵想法：**已經抓過的場次不用每次都重新抓，點擊抓取只要抓有新的資訊就好，不管舊場次的票有沒有賣完**。這個想法是對的方向，而且完全不需要換資料庫或後端——純粹是演算法優化，已經做完並實測驗證。

**機制**：`fetch.mjs` 的 `buildKnownRawIdsBySource()` 從現有 `data/events.json` 建出「每個來源已經成功辨識過的 raw_id 清單」，傳給每個 adapter 的 `fetch(knownRawIds)`。各 adapter 內部在昂貴的逐場詳情頁抓取迴圈前先比對：已知的 raw_id 直接標記 `reuse_previous: true`、完全跳過該筆的詳情頁/價格請求；`fetch.mjs` 的 `runAdapter()` 看到這個標記就改用 `fallbackEventsForSource(previousEvents, sourceName, rawIds)`（延伸自 M11 那次故障復原機制，多加一個 `rawIds` 篩選參數）直接沿用上次已經正規化好的資料，不會重新跑 `normalize()`。

**刻意排除「待整理」清單**：增量比對只看已經成功辨識成正式場次的 raw_id，**不看** `needs-review.json` 裡的——待整理項目每次都還是會重新抓、重新跑 `normalize()`，因為這正是「使用者在 `artists.yml` 補上藝人之後，重新抓取能把這筆場次從待整理轉正」這個既有工作流程的運作方式；如果待整理的項目也被當成「已知、跳過」，這個轉正機制就會永久失效。待整理項目數量本來就比正式場次少很多（現在 71 筆 vs 240 筆），全部重抓的代價不大。

**各來源實際改法**：拓元／FANSI GO 的 Playwright 詳情頁、iNDIEVOX 的個別頁面請求、KKTIX 兩種策略（自營頁/搜尋）的詳情頁，已知的都直接跳過、連禮貌性延遲都省了（沒有請求就不用等）。Ticket Plus 比較特殊：`sessions.json` 每個 eventId **還是每次都查**（這是唯一能發現「已知活動加開新場次」這種真正的新資訊的方法），只有在確認該 eventId 底下**所有** session 都已經是舊的時候，才跳過拿票價用的 `event.json` 呼叫。

**實測數字**（同一台機器、同一份已有 240 筆資料的 `events.json` 起跑）：
- 平行化但沒有增量：8 分 52 秒
- 加上增量抓取：3 分 13 秒
- 再把 Ticket Plus 的 `sessions.json` 請求間隔從 2000ms 降到 500ms（原本是套用全部 adapter 統一的 NFR-04 預設值，沒有針對個別來源調整過；這是對一個大型商業售票平台的輕量 JSON API 呼叫，不是對小型獨立展演空間網站的完整頁面請求）：**2 分 17 秒**

**離 1 分鐘內還有一點差距，卡在拓元——已經查過原因，但沒有直接的解法**：79 場裡有 20 場當天是「新的」需要真的開 Playwright 分頁那次測試，拓元自己花了 2 分多鐘。加了逐場計時的診斷紀錄後查清楚了：`goto()` 本身一直很快（穩定在 500-900ms），**慢的是 `domcontentloaded` 之後、頁面自己的「節目介紹」分頁內容真的渲染出來之前的這段時間**，實測絕大多數場次要等 5-9 秒，不是少數幾筆拖慢平均，是幾乎每一筆都這麼慢——推測是頁面在等一堆廣告/追蹤器的 script 跑完。

**試過用 Playwright 的 `page.route()` 擋掉圖片/字型/廣告追蹤器網域，一個 5 筆的小樣本測試看起來確實有效**（3-5 秒 vs 原本 7-9 秒），**但緊接著跑一次完整 79 場的測試，總時間不但沒有變快、失敗次數還大增**（18/79 逾時 20 秒失敗，遠高於之前）。判斷這很可能不是擋資源這個做法本身的問題，而是**這次除錯過程在半小時內對拓元同一批詳情頁發送了超過 150 次請求**（好幾輪完整測試接連著跑），很可能觸發了拓元反爬蟲系統的某種流量可疑度評分機制（SPEC 裡已經記錄過這是 Akamai/PerimeterX 類的 JS 挑戰）——擋廣告/追蹤器本身也是常見的機器人偵測訊號之一，兩個效應疊在一起，光看這一次雜訊很大的測試結果無法區分到底是哪個原因。**已經把這個實驗性的擋資源改動復原**，不確定有沒有幫助的情況下，不值得冒著讓真實資料來源變得更不穩定的風險去上線一個未經證實的「優化」。

如果之後要重新試，應該挑一個乾淨的日子、測試之間留真正的間隔，不要像這次一樣好幾輪測試緊接著打同一個網站。**目前拓元詳情頁抓取速度不穩定這件事本身還是沒解決**，但至少現在知道慢在哪裡（頁面自己的渲染時間，不是我們的程式碼或延遲設定的問題），也知道「多開瀏覽器分頁去抓一堆事件」這種操作本身可能會讓拓元把我們當成更可疑的流量。

跟這個分開、獨立的另外兩個需求（Max 明確說可以分開處理，不用綁在一起）：
- **跨裝置同步、不用 GitHub、改帳號密碼登入**：這個不管抓取多快都需要一個真的後端/資料庫（畢竟同步的東西是使用者偏好，不是演出資料）。討論到用 Supabase（資料庫+登入+API 一次搞定）取代單獨的 Neon Postgres（那樣還要另外接登入服務跟寫 API 層，工程量大很多），但這個方向也還沒拍板，尚未動工。
- **RWD 響應式設計，不只手機版**：純前端 CSS/版面調整，跟後端架構無關——已經做完，見下一節。

## RWD 響應式設計做完了（2026-09-18）

LiveRadar 原本完全是手機版設計（`.app{max-width:480px}`），在桌機瀏覽器打開就是中間一條窄欄、兩側一大片空白。Max 要求「除了手機版之外，用不同尺寸做 RWD 縮放」，判斷重點不是「把整個殼放大」這麼簡單，而是**分清楚哪些內容值得利用多出來的寬度、哪些內容就算螢幕變寬也該維持原本的閱讀寬度**：

- **場次列表（時間表／新上架／收藏／搜尋結果）在平板/桌機下改成多欄排版**：這是最有價值的改動——原本一張卡片佔滿整個寬度、要一直往下滑，現在平板 2 欄、桌機 3 欄，同一個畫面能看到的場次變多。日期標籤（例如「9月18日」）仍然橫跨整列當標題，不會被擠進格子裡。
- **表單、設定頁、待整理／已隱藏管理維持窄欄置中**：這些頁面本來就是「一次看一件事」的介面，螢幕變寬不代表輸入框應該被拉成又寬又扁的樣子——新增一個 `.page-content` class 幫這些頁面的內容維持在 560px 內、置中顯示，兩側留白，看起來還是像設計過的頁面，不是隨螢幕亂長大。
- 底部導覽列、彈出選單（排除選單、篩選 chip 的 bottom sheet）的寬度都跟著同步放寬，維持跟內容區同寬，不會在寬螢幕上看起來突兀。
- 手機版（<800px）完全沒受影響，純粹是加兩個新的 CSS 斷點（平板 800px、桌機 1200px），沒有動到任何既有的手機版樣式規則。

實測過手機（390px）、平板（834px）、桌機（1280px）三種寬度，時間表／新上架／收藏／搜尋／設定／待整理／已隱藏管理／手動新增場次八個頁面都檢查過，畫面正常縮放、瀏覽器 console 沒有錯誤。這次完全是 CSS 跟少數幾個 HTML 頁面補上 class，沒有動到任何 JS 邏輯，`npm test` 58 個測試照樣全過（本來就跟這次改動無關，純粹確認沒有連帶弄壞別的東西）。

## 桌機打磨：側邊導覽列、hover、字級（2026-09-18，緊接著上面那次）

Max 看過桌機版截圖後自己列了四點想調整，全部做完：底部導覽列在 1200px 以上改成左側直向導覽列（更貼近桌機習慣，平板維持底部導覽列）、卡片/按鈕補上滑鼠 hover 回饋（用 `hover:hover` 媒體查詢排除觸控裝置，避免手機上「點一下卡住不放」的問題）、桌機斷點微調字級（Logo/標題/卡片標題/日期數字），還有 Logo 跟搜尋圖示之間的留白問題順便靠字級變大一起解決了。

**測試時踩到一個工具本身的坑，記錄下來避免下次白繞路**：瀏覽器分頁工具在「先把視窗縮放成桌機寬度、再導覽到網址」這個操作順序下，偶爾畫面會顯示成擠在左邊一小塊、右邊一大片空白的錯誤樣子——一度以為是側邊導覽列的 CSS 寫錯，但用 `getBoundingClientRect()` 直接查 DOM 元素的實際版面尺寸，證實底層版面其實完全正確（格線寬度、側邊欄位置都對）。後來發現只要**先導覽到網址、再縮放視窗**，畫面就穩定正確。判斷是瀏覽器分頁工具在強制縮放已載入頁面時，偶爾沒有正確觸發重新繪製，不是程式碼的問題。下次遇到「畫面看起來壞掉但邏輯測試都正常」，先懷疑是不是工具本身的顯示問題，用 JS 直接查 DOM 尺寸確認，不要急著改 CSS。

## 已售完的場次也要能點進去看原始頁面（2026-09-18，Max 看畫面時發現的）

`src/render.js` 的 `renderEventCard()` 原本邏輯是：只要 `event.status === "sold_out"`，就完全不渲染那個黑色箭頭按鈕，連 `ticket_url` 的連結都沒了。Max 選取一張「已售完」的卡片時發現這個問題——已售完不代表使用者不會想點進去看原始頁面（可能想看看有沒有加場、候補、或單純想確認資訊），拿掉整個連結是不必要的限制。改成一律顯示箭頭按鈕，只有按鈕的 `aria-label` 文字依狀態變化（「購票」／「已售完，查看頁面」／「查看頁面」），不再讓 `sold_out` 狀態拿掉整個 CTA。順便新增 `src/render.test.js`（這個檔案之前沒有測試），補上三個案例涵蓋 `sold_out`／`on_sale`／`announced` 三種狀態的按鈕跟連結是否正確。`npm test` 61 個測試全過。

## 收藏頁新增日曆檢視（2026-09-18，Max 提的想法）

Max 想要收藏頁除了依日期排序的列表之外，也能用月曆的方式查看收藏的場次。做法：

- `favorites.html` 加了「列表」／「日曆」兩個 chip 切換，選擇會存進 `localStorage`（`liveradar:fav_view`，新增到 `state.js`），下次打開會記得上次選的是哪個——這是「畫面狀態」不是「規則」，不走 Gist 同步，跟時間表的城市/月份/價格篩選器同一個精神。
- 新增 `src/calendar.js`：純函式 `buildMonthGrid(year, month)`（算出某個月要畫幾週、每一格是星期幾、開頭結尾要補幾個空格）跟 `addMonths(year, month, delta)`（跨年翻頁），完全不碰 DOM，照專案慣例寫成獨立、好測試的邏輯檔（跟 `format.js`／`filter.js` 同一個模式），配 `src/calendar.test.js` 五個測試。
- 月曆格子：有收藏場次的日期會有一個小圓點，點下去在月曆下方顯示那一天的場次卡片（可以直接購票/取消收藏），今天的日期有外框標示。預設打開日曆會自動跳到「最近一場收藏」所在的月份並選好那一天，不用自己先翻月份才找得到東西。
- **測試時抓到兩個真實的「選取狀態卡住」bug**，都是同一種類型：翻到別的月份、或是把當前選取那天的場次取消收藏之後，畫面選取的日期沒有跟著更新，導致月曆明明換了月份，下面卻還顯示著舊月份、甚至已經不存在的場次資料。兩個情境都補上「重新驗證選取的日期是否還有效，無效就清空」的邏輯，清空後改顯示「這個月沒有收藏的場次。」，不會再顯示過期資料。
- `npm test` 66 個測試全過（含新增的 5 個 calendar.js 測試），瀏覽器實測過新增收藏、切換列表/日曆、翻月份、選日期、從日曆內取消收藏、桌機寬度下日曆維持舒適閱讀寬度（用 `.page-content`，不會被拉伸），都正常，console 沒有錯誤。

## 平板/桌機格線的卡片高度對齊（2026-09-18，Max 看畫面時發現的）

Max 用截圖圈出來給我看：同一列裡標題比較長、或多一個「已收藏，忽略排除規則」徽章的卡片會比旁邊的卡片高，同一列高低不一很醜。原因是 9.1 那次 RWD 改動用 `align-items:start`，讓每張卡片維持自己內容決定的自然高度。改成 `align-items:stretch`（grid 的預設值）並讓 `.event-card{height:100%}` 撐滿格子，同一列的卡片統一變成那一列最高卡片的高度，較矮的卡片下方會多一點留白，但整列看起來整齊。只在 `min-width:800px` 斷點生效，手機版單欄本來就不會有這個問題（實測過，手機版卡片高度確認維持各自的自然高度，桌機版同一列卡片確認變成統一高度）。`npm test` 66 個測試全過（純樣式，不影響邏輯）。

## 修掉「音樂祭被標成專場」的分類錯誤，順便補上一個系統性的根因（2026-09-18，Max 選取畫面元素發現的）

Max 選取「爛泥發芽」這張卡片問說：這是音樂祭，怎麼被標成專場？查下去發現根因：`data/artists.yml` 補完那 230 筆時，把幾個**其實是音樂祭品牌名稱、不是單一演出者**的名字當成「藝人」加了進去——爛泥發芽（草原音樂季）、RUSH BALL（気志團主辦的日本搖滾祭）、FNC BAND KINGDOM（FNC 娛樂旗下多組樂團的聯合公演）都是這種情況。`normalize.mjs` 的 `guessTagsType()` 只看標題文字裡有沒有「音樂祭」這個詞，這幾場的標題（例如「爛泥發芽10週年」）根本沒有這個詞，加上只辨識到一個「演出者」，就落到預設的「專場」分類。

**同時抓到一個更根本的缺口**：順手用同樣的方式檢查全部現有場次，抓到「2026臺北爵士音樂節」也被標成專場——原來 `TYPE_KEYWORDS` 只認「音樂祭」這個詞，沒認「音樂節」這個一樣常見的同義詞。這個缺口比三個品牌名稱更系統性，之後任何用「XX音樂節」命名的活動都會踩到同一個坑。

修法：`TYPE_KEYWORDS` 補上「音樂節」→ 音樂祭 的同義詞對應，再把三個確認過的音樂祭品牌名稱（爛泥發芽／RUSH BALL／FNC BAND KINGDOM）直接加進關鍵字表，不管標題怎麼寫都能正確辨識。因為增量抓取已經上線、已經辨識過的場次不會重新跑 `normalize()`，另外寫了一次性腳本直接對 `data/events.json` 裡現有的 7 筆受影響場次重新分類（不用重新爬網站，純粹是用同一套邏輯重跑分類）。新增 3 個測試涵蓋「音樂節」同義詞跟三個品牌名稱，`npm test` 69 個測試全過。

## 新上架的卡片沒有標示月份，只有日期數字看不出是哪個月（2026-09-18，Max 看畫面發現的）

`新上架.html` 的卡片不是按日期分組的（分成「今天新增」／「過去 7 天」，這是「什麼時候發現的」不是「什麼時候演出」），原本卡片左側的日期方塊只顯示「26」這種裸日期數字——同一頁出現兩個都寫「18」的卡片，一個其實是 9/18、一個是 10/18，肉眼完全看不出差異。時間表頁面因為有「9月18日」這種分組標題頂著，裸數字還看得懂；新上架沒有這層分組，裸數字就不夠用了。

修法：`format.js` 的 `splitDate()` 多回傳一個 `month` 欄位，`render.js` 的日期方塊從顯示「26」改成顯示「9/26」，全站所有頁面統一套用（時間表頁面雖然已經有分組標題，多顯示月份只是稍微重複，不會顯示錯，比只在新上架頁面特別處理更一致、更不容易日後又漏掉）。`npm test` 69 個測試全過（純顯示格式調整）。

## 篩選器新增「類型」跟「音樂人地區」兩個 chip（2026-09-18，Max 提的想法）

時間表頁面原本只有全部城市／全部月份／價格三個篩選 chip，Max 要求再加類型（專場/拼盤/音樂祭/見面會...）跟音樂人地區（本地/日韓/歐美/海外）。做法完全比照既有的三個 chip：`filter.js` 的 `passesViewFilters()` 補上 `type`／`origin` 兩個條件（比對 `event.tags_type`／`event.tags_origin`），`app.js` 新增 `typeFilterOptions()`／`originFilterOptions()`，一樣只列出目前尚未結束的場次裡真的存在的選項，不會出現選了保證空清單的死選項。五個 chip 可以任意疊加（例如「音樂祭」+「本地」同時套用，實測過確認會一起生效，還順便驗證了前面才修好的爛泥發芽/RUSH BALL 音樂祭分類是正確的）。`src/filter.test.js` 新增 3 個測試，`npm test` 72 個測試全過，手機版 5 個 chip 會自動換行，桌機/手機都測過。

## 新增手動深淺色切換開關（2026-09-18，Max 反映深色模式看久眼睛痛）

原本深淺色完全跟系統設定走（`prefers-color-scheme`），沒有手動開關。Max 說「深色看久眼睛有點痛」要求加按鈕，做法：`styles/tokens.css` 改成三層 override（`:root` 淺色預設 → `@media (prefers-color-scheme: dark)` 系統深色，但排除使用者已明確選淺色的情況 → `:root[data-theme]` 使用者明確選的，優先權最高），`data-theme` 屬性由每個頁面 `<head>` 裡一段**同步** inline script（不是 `type="module"`）在最前面設定，避免用 `app.js`（deferred module）設定導致每次換頁閃一下錯誤主題（FOUC）。`state.js` 新增 `loadTheme()`/`saveTheme()`，`settings.html` 新增「顯示模式」三個單選 chip（跟隨系統/淺色/深色），`app.js` 的 `initSettings()` 綁定點擊事件、`aria-pressed` 互斥切換、頁面載入時依當前設定顯示正確的按下狀態。實測過三種狀態切換、跨頁導覽維持設定不跳回、無 FOUC 閃爍，細節見 [LIVERADAR-SPEC.md](LIVERADAR-SPEC.md) §9.4。`npm test` 72 個測試全過。

## 建議下一步

剩下 67 筆待整理，大多是非音樂雜訊（用「忽略」按鈕清掉即可）或真的看不出主秀的拼盤場次，不需要特別處理。52% 左右的覆蓋率抽樣可以視為現階段用免費工具、五個來源都做完後的實際天花板，再往上要嘛擴大追蹤場館清單（投報率遞減，前面查證過大多數自營小場館很難批次找到），要嘛是接受這個範圍——不建議現在就投入。

架構上目前仍是：**抓取一律手動觸發（決策 S5），不做自動排程**，`.github/workflows/daily-update.yml` 的 `schedule` 已經拿掉，只留 `workflow_dispatch`。**這個決策正在被重新討論**（見上一節最後一段）——Max 嫌手動按一次要等太久，正在考慮要不要換成「排程自動預先抓好存資料庫」的架構，但排程要在哪裡跑會重新踩到 M11 那個 IP 被封鎖的老問題，還沒有結論，先不要假設會維持現狀。

## 待整理清單大清理：71 筆降到 1 筆（2026-09-18/19）

Max 看了待整理清單問了三個問題，逐一處理：

1. **「有些不是音樂祭嗎？」**——沒錯，根因跟爛泥發芽那次一樣：`normalize()` 要先辨識出至少一個 headliner 才會走到分類邏輯，光標題有「音樂祭」字樣但沒人被認出來的活動會直接卡在待整理，連分類都不會跑。逐一開票券頁查證後，把 ASIA METAL FESTIVAL、火球祭、秋夜爵醒祭、X-Formosa、囪擊音樂祭、FRIENDS MEETING、Kaohsiung Park Music Festival 等確認過的真音樂祭品牌名稱、跟幾個拼盤/派對系列品牌（河馬玖狂、西部地區懸賞公告、交個朋友吧、重型宇宙派對、Punk Strike…）加進 `artists.yml` + `normalize.mjs` 的 `TYPE_KEYWORDS`。
2. **「非音樂雜訊不要進資料」**——`normalize.mjs` 新增 `NOISE_KEYWORDS`／`isNonMusicNoise()`，運動賽事、摔角、課程、展覽、蛋黃酥、脫口秀、Podcast 等在抓取階段直接排除（`normalize()` 回傳新的第三種結果 `{ excluded }`），不會再進 `needs-review.json`。**過程中意外抓到一個已經上線的真實 bug**：「臺北大巨蛋演唱會-歌迷返鄉專車【非官方服務】」這種冒用真演唱會名義賣接送巴士票的東西，因為標題裡有 Stray Kids/BTS/AAA/Post Malone 的真名，已經被誤判成正式場次混進 `events.json`——連同 4 筆一起用一次性腳本清掉了。
3. **「只要在追蹤平台上就該加，不該我自己判斷冷不冷門」**——開了近 20 個票券頁逐筆查證身分（不是憑標題猜），`artists.yml` 補了約 47 筆真實藝人/樂團/品牌名稱。

**順便修好一個既有 bug**：`findNameIndex`／`guessTagsType` 的比對是大小寫敏感的，真實資料裡同一個品牌會一種寫大寫一種寫小寫（例如「Punk Strike」vs「PUNK STRIKE」），全大寫的「TOUR」比對不到 `["Tour", "巡迴"]` 這條——已經改成大小寫不敏感比對，**連帶讓 37 筆現有場次從錯誤的「專場」改標成正確的「巡迴」**。

跑完真實 pipeline 驗證：`needs-review.json` 71 筆降到 1 筆（剩 MOB PARTY 26，泰國清邁的活動，不在 LiveRadar 的台灣場次追蹤範圍內，建議直接用「忽略」按鈕清掉，不算 bug）。`npm test` 77 個測試全過。改動已 commit（`8916204`）並 push 上 `origin/main`。

## 下一個大方向（還沒動工）：改成真帳號登入（email/密碼＋Google 登入），取代 Gist 同步

Max 想要「開網址、登入會員帳號、甚至可以綁 Gmail 登入，就能跨裝置同步」——比現在的 Gist 同步（決策 S1，要貼 GitHub PAT token 才能用）對一般人友善很多。**這是一個尚未動工的計畫，這裡只是把方向定下來、方便任何一台電腦接手時知道要往哪走，不是說已經做完。**

這個方向會**推翻決策 D14（純靜態前端，沒有後端）**——D14 是很多既有設計的前提（M7 手動新增場次只存 localStorage/Gist、M8 指派藝人不會真的寫 `artists.yml`），一旦有了真後端，這些限制不再是技術上不得已，而是要重新決定要不要保留。接手的人要先意識到這一點，不要只當作「多加一個登入功能」。

**建議的技術路線：Supabase**——一個服務同時給 Postgres 資料庫、使用者驗證（內建 email/密碼登入 + Google OAuth 登入，不用自己刻登入伺服器）、還有自動產生的 REST API，比另外接 Neon Postgres + 自己寫一套登入系統工程量小很多（這個比較在 2026-09-18 那次跟 Max 討論「1 分鐘內」那次已經提過一次，見上面章節）。

**接手的人要做的事（照順序）**：

1. **Max 自己**去 supabase.com 開一個免費專案（開帳號、建專案這一步只能 Max 本人做，Claude 不能代替使用者建立外部服務帳號）。
2. **Max 自己**在 Google Cloud Console 開一個 OAuth 用戶端（Client ID/Secret），才能讓 Supabase 的 Google 登入選項真的動起來——這步也需要 Max 自己的 Google 帳號權限，不能代做。
3. 在 Supabase 的 Auth 設定裡啟用 Email 跟 Google 兩種登入方式，把上一步拿到的 Client ID/Secret 貼進去。
4. 設計一個 `user_prefs` 資料表（用 Supabase 的 `auth.uid()` 當 key），存的內容跟現在 Gist 同步的範圍一樣：`favorites`／`excluded_artists`／`excluded_types`／`mute_keywords`／`strict_mode`（見 FR-63/64、`LIVERADAR-SPEC.md` §8）。**畫面篩選狀態（城市/月份/價格/類型/地區 chip、收藏頁列表/日曆切換）刻意不用同步**，跟現在 Gist 同步的原則一樣——那些是「當下在看什麼」不是「跨裝置生效的規則」。
5. 前端新增登入/註冊頁面（或彈窗），用 `@supabase/supabase-js` 這個 client 套件跟 Supabase 溝通。
6. 決定要不要保留 Gist 同步當作「沒有帳號時的備援」，還是直接整條 `reconcileGistSync()` 路徑換掉——這個要問 Max，不要自己假設。

**還沒做的部分**：以上全部，包含 Supabase 專案本身都還沒開。任何人接手前，先確認 Max 是否已經完成步驟 1/2（開帳號、開 OAuth 用戶端），沒有的話這個方向連開始寫程式碼都還不能動工。

## Supabase 帳號登入上線（2026-09-20，上面那節的計畫已經做完）

上面整節「下一個大方向（還沒動工）」已經**做完並實測成功**。跟原計畫的差異、實際踩到的坑，記在這裡。

**跟原計畫的差異：只做 Google 登入，email/密碼整個拿掉了**——一開始兩個都做了（signup/signin 表單、忘記密碼、重寄驗證信，`login.html`＋`reset-password.html`），但 Supabase 免費方案寄出的驗證信/重設密碼信用共用網域（`mail.app.supabase.io`），內容不能改、看起來很像詐騙信（要客製內容得先接自訂 SMTP，還要有自己的網域才有辦法讓信件不被當垃圾信擋掉）。Max 決定乾脆只留 Google 登入——Google 本身就是身分驗證，完全不會有 Supabase 寄信的問題。所以 `login.html`／`reset-password.html`／`src/supabase.js` 裡密碼相關的 5 個函式都已經刪掉，現在 `src/supabase.js` 只剩 `getSession`／`signInWithGoogle`／`signOut` 三個函式。

**資料庫**：`user_prefs` 表已經在 Supabase 建好（user_id/prefs/manual_events/updated_at，RLS 只允許 `auth.uid() = user_id`），而且因為「自動曝光新表」被關掉了，額外需要手動 `grant select, insert, update on public.user_prefs to authenticated;`（沒有 grant 給 anon，匿名完全連不到這張表，測過會回傳 401 permission denied，這是預期行為）。

**架構調整**：`src/state.js` 的 Gist 同步整段換成 Supabase 版本（`pushToSupabase`／`scheduleSupabaseSync`／`reconcileSupabaseSync`），邏輯跟原本的 Gist 機制一模一樣（2 秒 debounce push、頁面載入時 last-write-wins 比對 `updated_at`），只是資料來源從 GitHub Gist API 換成 `supabase.from('user_prefs')`。呼叫時機也沒變，一樣是 `initTimeline`／`initSearch`／`initNewArrivals`／`initFavorites`／`initHiddenManagement` 這 5 個頁面的 init 函式各呼叫一次，settings.html 本身不會觸發同步（只顯示狀態）。

**過程中踩到的坑，照時間順序**：
1. **忘記密碼流程一開始有做，後來整個拿掉**——連同 `resetPasswordForEmail`/`updatePassword`/`resendConfirmationEmail` 一起刪了，理由同上（Google-only 決定）。
2. **關閉 Email provider 前要注意**：Supabase 免費方案下**沒接自訂 SMTP 就不能編輯任何信件模板**（Subject/Body 欄位是唯讀的），一開始以為能簡單改文案降低詐騙感，試了才發現整個編輯功能都被鎖住。
3. **Google OAuth 用戶端在開發過程中被刪除過一次**——具體原因不明（可能是 Max 操作 Google Cloud Console 時手滑），造成一次「The OAuth client was deleted」401 錯誤，靠重建一個新的用戶端（新的 Client ID 開頭一樣是 `418431742356-`，但後半段完全不同）解決，記得如果之後又遇到 `deleted_client` 錯誤，先去 `https://console.cloud.google.com/apis/credentials` 確認用戶端還在不在。
4. **Supabase 的「允許跳轉網址」（Redirect URLs）預設沒有把本機網址放進去**——只有預設的 `http://localhost:3000`，但 `npm run serve` 實際跑在 `8000`，要手動去 Authentication → URL Configuration 加一筆 `http://localhost:8000/**`。這個機制本身是安全設計（防止登入完成後被導到未經同意的網址），不是 bug，只是預設值跟這個專案的 port 對不上，之後 GitHub Pages 開通有正式網址後，這裡還要再加一筆正式站網址。
5. **真正卡最久的問題**：Client Secret 重設過後，Supabase 那邊沒有真的存到最新的值，導致 Google 那邊授權碼換權杖失敗，錯誤是 `error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code`。**這個錯誤原本完全不會顯示在畫面上**——`initSettings()` 沒有檢查網址列的 `?error=...` 參數，使用者點登入、走完 Google 流程、跳回來，畫面就只是靜靜地維持「未登入」，沒有任何提示，只能自己去看網址列才找得到線索。已經修好：`initSettings()` 現在會檢查 `error_description` 參數，用 `alert()` 顯示出來（跟這個檔案其他地方的錯誤提示風格一致），顯示完會把網址清乾淨，重新整理不會一直跳同一個舊錯誤。
6. **驗證方式**：不只看畫面顯示「已登入」就信了，有直接查 `user_prefs` 表確認真的寫進一筆資料（`prefs` 欄位格式正確），也用假的 anon 請求測過 RLS 真的擋得住匿名存取（401），這兩個都是實測過、不是憑印象猜的。

**目前狀態**：Google 登入完整測過、資料庫讀寫都驗證過，`npm test` 77 個測試全過。**還沒做的**：GitHub Pages 還沒開通（部署出去的正式站網址還不存在），正式站網址確定後要記得回去 Supabase 的 Redirect URLs 補一筆。`LIVERADAR-SPEC.md` §7/§8（原本描述 Gist 同步的技術文件）跟 `LIVERADAR-SRS.md` 的 FR-65 現在是過時內容，還沒有回去更新。

## 全面改名：GigRadar → LiveRadar，換 GitHub org、開通 GitHub Pages（2026-09-20）

原名 GigRadar 撞名（GitHub 上已經有一個不相關的既有專案/組織叫 GigRadar.io），Max 要求全面改名，包含 UI 文字、文件、檔名、GitHub org/repo。改法：

- 新名字 **LiveRadar** 是 Max 自己選的，先確認過 GitHub 上沒有撞名的組織才定案。
- 建了新的 GitHub 組織 `liveradar`，repo 從 `Max-side/gigradar` transfer 過去，**transfer 過程順便改名成 `liveradar.github.io`**——repo 名稱剛好等於 `<org>.github.io` 會觸發 GitHub Pages 的「根網域」特殊處理，部署出來的網址就是乾淨的 `https://liveradar.github.io`，不會露出 Max 的個人帳號名稱，也不用另外買網域（Max 的要求：「免費而且不要我自己的帳號名稱」）。
- 全部 21+ 個檔案跑過 sed 迴圈，把 `GIGRADAR`/`GigRadar`/`gigradar` 換成 `LIVERADAR`/`LiveRadar`/`liveradar`——含 `GIGRADAR-SPEC.md`/`GIGRADAR-SRS.md` 用 `git mv` 改檔名成 `LIVERADAR-SPEC.md`/`LIVERADAR-SRS.md`，`localStorage` key 前綴（`gigradar:*` → `liveradar:*`，使用者舊的 localStorage 資料會直接失效變成初始狀態，這是可接受的代價，個人專案沒有既有使用者群要遷移）。
- 本機 git remote 改用 SSH（`git@github.com:liveradar/liveradar.github.io.git`）——過程中 Max 兩次不小心把 GitHub PAT token 貼進對話裡，兩次都立刻要求撤銷，已確認撤銷完成；改用 SSH 之後就不再需要 token 了。

## 首頁新增介紹卡、基本 SEO、favicon（2026-09-20）

- **首頁介紹/使用說明卡**：Max 要求「新增一個區塊介紹這個網頁在幹麻、教學怎麼用」——`index.html` 在頁首跟來源異常警示 banner 之間加一張可關閉的卡片（`#intro-card`），內容是五個平台一句話說明 + 四點操作提示（收藏/排除/篩選/搜尋/登入同步）。關閉狀態存 `localStorage`（`liveradar:intro_dismissed`），關掉後不會再自動跳出來。文案照 Max 的要求把「獨立/地下音樂演出」改成「五個售票平台的音樂展演演出」（Max 原話：「獨立地下這個詞都多久沒用了」）。
- **基本 SEO**：Max 確認只要「基本網頁資訊」，不是要衝搜尋排名。8 個 HTML 頁面都補上 `<meta name="description">`、favicon（新增 `favicon.svg`，珊瑚色圓點）、4 個 Open Graph 標籤（分享連結時預覽用），純資訊性補完，沒有動任何邏輯或版面。

## FAB 按鈕擋住「設定」分頁的版面 bug（2026-09-20）

Max 截圖回報：手動新增場次用的浮動「+」按鈕蓋住底部導覽列的「設定」分頁，點不到。用 `getBoundingClientRect()` 查證：`.fab` 的 `top:-22px` 讓按鈕底部沉進 74px 高的底部導覽列裡，剛好壓在最後一個 nav item 上。改成 `top:-54px` 修好，三個斷點（手機/平板/桌機）都測過確認不再重疊，桌機版側邊導覽列那組獨立的 `.fab` override 沒有受影響。

## 設定頁拿掉多餘的「跨裝置同步」狀態顯示（2026-09-21）

Max 確認「都已經 Google 登入了，為什麼還要另外一塊同步狀態」——帳號卡片本身的登入/登出狀態已經隱含同步是否生效，不需要獨立徽章重複講一樣的事。`settings.html` 的「同步與備份」section 拆掉同步狀態那塊（`#sync-status`／`#sync-last`），改名「備份」只留匯出/匯入。`src/app.js` 對應把 `renderSyncStatus()` 改名 `renderAccountAndBackup()`，**過程中一度處於半改完的壞狀態**（函式改名但 4 個呼叫點沒同步改、`initSettings()` 的啟動守衛還在檢查已經被刪掉的 `#sync-status` 導致整個 `initSettings()` 永遠不會執行）——已經全部修好並在瀏覽器實測過 console 無錯誤、帳號/備份功能正常，`npm test` 77 個測試全過。

## 部署版隱藏「重新抓取最新演出」按鈕（2026-09-21）

Max 看到 `settings.html` 的「來源狀態」卡片卡在「載入中…」發現異狀，追出來是上面那個 `initSettings()` 沒執行的 bug（已修好），順便追問「那使用者要怎麼自己更新資料」，發現「重新抓取最新演出」按鈕在部署版（GitHub Pages 純靜態站，沒有 `/api/fetch` 後端）點下去只會顯示「連不上本機伺服器」的錯誤，對一般使用者完全沒用還很困惑。改法：`src/app.js` 的 `initSettings()` 加一個 `location.hostname` 檢查，只有 `localhost`/`127.0.0.1` 才顯示這顆按鈕，部署版直接不渲染。「來源狀態」清單本身（顯示各平台上次成功時間/筆數）維持顯示，這對一般使用者是有意義的資訊，只有「重新抓取」這個只有本機才動得了的按鈕被隱藏。

## 排程自動抓取的可行性測試：確認拓元／Ticket Plus 會擋 GitHub Actions（2026-09-21）

Max 問「使用者要怎麼自己更新資料，還是只能我來更新」，釐清現況：抓取一律手動觸發（決策 S5）是既有決定，一般訪客完全無法自己觸發抓取，資料更新頻率完全取決於 Max 有沒有空手動跑。討論要不要恢復自動排程，先實測驗證會不會被擋（而不是猜）：

- 手動觸發一次 `workflow_dispatch`（真的在 GitHub Actions 環境跑），跑完看 CI 產生的 `data/sources.json`：**拓元 403**（`GET https://tixcraft.com/activity -> 403`）、**Ticket Plus 403**（`GET main/mainEvents.json -> 403`）、KKTIX/iNDIEVOX 正常、FANSI GO 是另一種失敗（CI 環境沒裝 Playwright headless 瀏覽器，不是被擋，是環境設定問題，理論上可修）。
- **結論**：M11 當時發現的 IP 封鎖問題到現在還是存在，S5 拿掉排程的判斷是對的。如果直接恢復排程，拓元/Ticket Plus 這兩個資料量最大的來源會每天靜默抓取失敗。
- 討論過的替代方案：(1) 維持現狀全部手動、(2) KKTIX/iNDIEVOX 排程自動抓，拓元/Ticket Plus/FANSI GO 維持手動、(3) 想辦法繞過 403（判斷屬於規避防護機制的灰色地帶，不建議）。
- Max 提出另一個想法：讓 Claude（不是 GitHub Actions）每天固定時間在他自己的電腦上跑抓取，因為用家用網路的 IP 不會被擋。查證 `mcp__scheduled-tasks` 這個機制後發現**需要 Claude 桌面 App 開著、電腦沒睡眠才會準時觸發，關著的話會等下次開機才補跑**——Max 這台電腦（`/Users/max/Documents/claude/liveradar` 所在的這台）平常都在待機，這個方案在這台機器上等於形同虛設，已經放棄。
- **改成規劃在 Max 的上班用電腦上做**（同一個 Claude 帳號，但上班電腦平常時段更穩定醒著）。**這件事已經做完**（同一天稍晚）：Max 確認過現在這台機器就是那台上班用電腦、也確認過公司網路/資安政策沒有疑慮，排程 `liveradar-daily-fetch`（每天約上午 10:00，見 `mcp__scheduled-tasks`）已經建立並實測跑過，流程是 `git pull` → `npm ci` → `node scripts/fetch.mjs` → `npm test` → 有異動且測試通過才自動 commit+push，測試沒過就停下來報告不動手，不用每次先問過。曾經走過 `liveradar/liveradar.github.io` clone 到 `gigradar` 資料夾底下的彎路（造成一層多餘的巢狀 clone），後來把整個 `gigradar` 資料夾改名成 `liveradar`（本來就是同一個 repo，只是還留著改名前的內部代號），巢狀的重複 clone 搬進系統垃圾桶，排程路徑也同步更新成 `/Users/megamount/Documents/personal/liveradar`。

## 一場真實漏掉的演出，牽出兩層根因，順便逆轉一個產品決策（D15 reversal，2026-09-21）

Max 回報一場真實查得到、卻在網站上完全看不到的演出（Age Factory @ SUB LIVE，`youngteam.kktix.cc/events/agefactory26`）。追出兩層完全不同的根因：

1. **KKTIX 涵蓋率缺口**：SUB LIVE 這類「租場地、每場不同主辦單位」的場館，靠關鍵字搜尋 KKTIX 全站才能涵蓋（見 SPEC §5.1）。SUB LIVE／Zepp New Taipei／Blue Note／野地方 Wild Lab 這四個場館，9/17 那次涵蓋率調查早就點名要加，但只做了記錄沒有真的動手——這次一次補齊，順便發現「野地方 Wild Lab」有兩種長得一樣但編碼不同的寫法（一個用了 U+2F45 康熙部首而不是正常的「方」字），改用「野地」兩字前綴涵蓋兩種寫法。
2. **更根本的問題**：即使場館涵蓋到了，Age Factory 這個藝人不在 `data/artists.yml`，`normalize()` 原本的設計是「辨識不到任何藝人，整場都不會進 `events.json`」——場次完全不會上架，不是分類錯誤、是整場消失。Max 直接質疑這個設計「有這麼多音樂人，不可能要求全部先手動登記過才會顯示」，這個質疑成立：一個「幫你發現還不知道的演出」的工具，卻要求你已經知道這個演出者才會顯示，本末倒置。

**修法（D15 reversal）**：`normalize()` 拿掉這個早退邏輯，未辨識藝人的場次照樣正常上架、正常顯示，只是沒有來源地標籤（沒辨識到就是不知道，不用猜），`needs-review.json` 的角色從「發布關卡」改成「待補分類清單」。連帶修了 `render.js` 卡片標題的一個真實 bug（`headliners` 是空陣列時，`headliners.join(" / ")` 會整個標題空白，改成退回顯示原始標題）和 `fetch.mjs` 的增量抓取邏輯（未分類的事件不能算「已知」，不然之後把藝人補進名單也不會生效，會永遠卡在空白分類）。

Max 進一步要求「不要叫我自己手動查來源地」——查證後這是合理的，`tags_origin` 需要「知道這個人是誰」才能判斷，沒有純技術性的自動判斷法，但用 WebSearch 查證（不是憑印象猜）完全可行，而且比起硬性規則更準。當場示範性地把清出來的 15 筆 `artist_unrecognized` 全部查證補齊（MONO、D'MASIV、LICHANG.rar、92914、Omoinotake、Karencici、Jony J、TAKASE TOYA、40 Fingers、EIR AOI、eldon、Shye），過程中也抓到一個純打字問題：D'MASIV 在 KKTIX 原始標題裡用的是彎引號（’U+2019）不是直引號，一模一樣、比對不起來，補一個對應別名才修好。這個「查證＋補 artists.yml」的動作已經寫進每日排程的執行內容，變成例行流程，不需要 Max 手動介入。

**額外修了一個測試本身的假陽性**：新增 canonical `MONO` 觸發了既有的子字串碰撞防護測試（`MONO` 是 `Monomania偏執狂` 的原始子字串），但 `matchArtists()` 內部的 `findNameIndex()` 對純英文 canonical 早就有字邊界防護，這個碰撞在真實比對時不會發生，只是測試本身還在用比實際比對機制更粗糙的 `.includes()` 判斷。把 `findNameIndex()` export 出來，讓測試直接用真正的比對邏輯檢查，而不是自己重新發明一套更容易誤報的規則。

**殘留、還沒修的小問題**：SUB LIVE 底下至少一個主辦方用英文地址（不是中文），城市判斷邏輯只認中文城市名稱，這場的 `city` 會落成「未知」而不是「台北」。目前只在這一筆資料上觀察到，還沒決定要不要為英文地址另外寫判斷邏輯。

`npm test` 79 個測試全過（新增 2 個測試：`normalize()` 未辨識藝人仍正常出場次、`renderEventCard` 空 headliners 退回顯示原始標題）。

## 同一天緊接著又抓到兩個問題：The Wall 的涵蓋率缺口、自己新增藝人造成的誤判、跨年度分組沒標年份（2026-09-21）

Max 又回報一場真實漏掉的演出（MONO NO AWARE @ The Wall Live House，`romanticoffice.kktix.cc/events/mononoaware2027`）。The Wall Live House 明明在 `ORG_PAGE_VENUES` 清單裡（有專屬帳號、org 頁面抓取），但這場票是外部主辦方「浪漫的工作室」用自己的 KKTIX 帳號開的，完全沒有出現在 The Wall 自己的清單頁（確認過：The Wall 官方帳號目前列出的近 250 場裡完全沒有這場）。這證明 `ORG_PAGE_VENUES` 的假設「自我主辦幾乎全部場次」對 The Wall 不是 100% 成立。修法比照 SUB LIVE：額外把 The Wall（搜尋關鍵字要用短的「The Wall」，完整的「The Wall Live House」搜尋不到）加進 `SEARCH_VENUES` 當安全網，兩種策略疊加使用，不是互斥。

**同一次修正意外自揭一個真實 bug**：稍早今天新增的 canonical `MONO`，把這次新出現的「MONO NO AWARE」（另一個真實存在、完全不相關的日本樂團）誤判成自己的場次——因為「MONO NO AWARE」這個名字剛好完整以「MONO」開頭，`findNameIndex()` 的字邊界檢查在這裡反而「正確地」判定為合法匹配（"MONO" 後面接空格，符合邊界），但語意上是錯的。這跟 IVE/LIVE、ASCA/Brasca 那種「完全不相關的字串巧合重疊」不一樣——這裡兩個都是真實存在、都想要正確辨識的藝人，只是誰先出現在標題裡的判斷方式不夠聰明。修法：`matchArtists()` 新增規則，當兩個候選字串在標題裡命中同一個起始位置時，保留比較長／比較具體的那一個，捨棄短的。這樣「MONO NO AWARE PASSION TOUR」正確辨識成 MONO NO AWARE，「MONO "Snowdrop" Asia Tour」依然正確辨識成 MONO，兩個互不干擾。連帶更新了子字串碰撞防護測試（見上一節）：同一起始位置的命中現在是安全的（有 tie-break 機制擋著），只有「命中位置不是 0」（藏在別的字詞中間，像 LIVE 裡的 IVE）才算真正危險的碰撞。

同一批順便查證補齊了這次 The Wall 搜尋額外找出來的 7 位新藝人（POiSON GiRL FRiEND 日本、TOTORRO 法國、VOOID／洪申豪 台灣、雀斑 Freckles 台灣、SCRUBB 泰國、7co 日本、Yo-Sea 日本沖繩），待整理清單再度歸零。

**另外處理 Max 用截圖指出的一個 UI 問題**：時間表往下捲動跨過跨年（畫面上顯示「12月26日」接著「1月2日」）完全看不出年份已經換了，滑快一點根本不知道自己在看哪一年的資料。修法：`format.js` 的 `splitDate()` 只在該日期的年份不是「今年」時，才在 `groupLabel` 前面加上年份（例如「2027年1月2日」），平常同一年的分組維持原樣不會多顯示年份，只有真的跨年才會出現視覺提示。`npm test` 新增 2 個測試（`matchArtists` 的 tie-break、`splitDate` 的跨年年份前綴），全部 82 個測試通過。

## Max 質疑城市篩選器的「未知」選項，追出一整串真實 bug（2026-09-21，同一天）

Max 問「全部城市為啥有未知」「音樂人地區為啥會有歐美和海外」，後續又直接反駁「還是有很多未知啊 你不會從場館判斷地點嗎」——這幾次質疑全部追出真實問題，不是「本來就會有未知」的正常現象：

1. **`cityFromAddress()` 用 `.startsWith()` 太脆弱**：遇到「郵遞區號+台灣+城市」格式的地址（如「116台灣臺北市文山區...」，KKTIX/iNDIEVOX 都有這樣寫的主辦方）會直接判定失敗。改成 `.includes()`，不用再窮舉每種可能的地址前綴寫法。
2. **`parseKktixVenue`／`parseIndievoxVenue` 遇到沒有真實地址時沒有退路**：有的主辦方乾脆把場館名稱重複寫一遍當「地址」（例如「The Wall Live House / The Wall Live House」），這種一定會判斷失敗又沒有備案。修法：兩者都新增 fallback，改查 `venues.yml`（跟拓元/FANSI GO 本來就在用的機制共用）。
3. **`venues.yml` 本身缺很多常見場館**：SUB LIVE、The Wall Live House、Clapper Studio、國立體育大學綜合體育館、WESTAR、PIPE Live Music、樂天桃園棒球場、霧峰立法院民主議政園區、迴響音樂展演空間都補上了。`parseTixcraftVenue` 的比對也改成不分大小寫——同一個場館被不同主辦方寫成「The Wall Live House」「THE WALL LIVE HOUSE」「THE WALL表演廳外L形走廊」三種大小寫混用的寫法，原本的比對只認一種。
4. **iNDIEVOX adapter 認得的場館標籤太少**：不同主辦方會用「地點」「場地」「場館」三種不同標籤寫同一個欄位，原本 `parseVenueLine()` 只認「地點」，另外兩種完全抓不到，`venue_raw` 直接變空字串。
5. **iNDIEVOX 還有第 4 種自由格式**：場館名稱跟地址直接空格接在一起、完全沒有括號（例如「Bullet Burger 子彈漢堡 403台灣臺中市西區...」），原本的括號比對邏輯完全處理不到這種格式。

修完以上 5 點，未知城市場次從 48 筆降到 23 筆——但 Max 接著又逼問一次「你不會從場館判斷地點嗎」，這次真的打開幾個 FANSI GO 的事件頁面查證，發現 **`fansi.mjs` 的 file header 註解「沒有任何結構化的場館欄位，連詳情頁都沒有」根本是錯的**：詳情頁其實有場館名稱+地址的結構化區塊，就在已經在抓的價格區塊(`.prose`)旁邊，同一次頁面載入就能一起拿，寫這個 adapter 的時候顯然沒有仔細找。修好之後 FANSI GO 的未知城市場次從 16 筆直接降到 1 筆（唯一剩下的是真的辦在泰國清邁的活動，未知才是正確答案）。

**最終結果**：全站未知城市場次從一開始的 48 筆修到剩 8 筆，剩下的都是真的沒有可判斷資訊（「多個表演場地」、iNDIEVOX 完全沒填場地欄位的自由格式貼文、場地本身就在海外）——這是這幾輪質疑帶出來目前為止修得最徹底的一次，教訓是：遇到「這應該辦不到吧」的判斷，先打開真實頁面查證，不要相信舊的 code comment 或自己上一輪查過的結論，網站內容跟版型都可能已經變了，或者當初就沒查仔細。

**同一輪順便處理的兩件事**：
- **來源地分類「海外」改名成「亞洲其他」**：Max 質疑「海外」跟「歐美」語意重疊，查證後發現當時標成「海外」的 11 位藝人全部都是亞洲地區（泰國、印尼、中國、新加坡、菲律賓、西藏），改名更精確。
- **首頁介紹卡文案重寫**：Max 反映原本的文案「寫得好爛」——條列式功能清單感太重，還混了「chip」這種開發者術語。改成更自然的口語句子。

`npm test` 最終 86 個測試全過（這輪新增 5 個：地址判斷、venues.yml fallback、大小寫不分比對）。

**同一天再晚一點，Max 又對照截圖抓到兩個問題**：X-Formosa 彩虹音樂節（官方網站查到固定辦在新北市工商展覽中心，title fallback 延伸成也查 venues.yml）跟 DISORDER LIVE #22（Max 直接貼海報截圖，上面寫著迴響音樂展演空間，證實了先前查到「同系列 #14 也在同一個場地」的推測）都修好了，未知城市場次最終剩 2 筆（蕭景鴻多場地巡演的合併售票頁、MOB PARTY 26 辦在泰國清邁）。順勢把「排程可以順便讀海報圖片」這個能力寫進每日排程：以後場地欄位空白、標題也查不到城市時，會先試著抓頁面上的海報/封面圖片，用 Claude 自己的讀圖能力看一眼，而不是每次都要 Max 手動貼截圖。

## 兩個真實 bug：iNDIEVOX「日期及時間」標籤抓不到、票價顯示身障票折扣價（2026-09-21，同一天）

Max 對照另一場真實演出的截圖抓到兩個問題：

1. **時間未公布，明明頁面有寫**：有些主辦方把日期欄位標成「日期及時間」而不是單純「日期」，`parseDateLine()` 原本的正規表達式要求分隔符號緊接在「日期」兩字後面，這種寫法完全比對不到，靜默退回只有日期沒有時間的列表頁資料。跟先前「地點/場地/場館」標籤的修正同一個思路：允許關鍵字跟分隔符號中間夾雜幾個字，不要求緊鄰。
2. **票價顯示身障票折扣價當作「NT$X up」**：票價擷取邏輯原本不分票種，身障票／愛心席／陪同票這種限定資格的優惠價常常是最低價，就直接變成畫面上顯示的價格——但一般人根本買不到這個價格，顯示出來會誤導。新增 `stripDiscountTierText()`，擷取價格數字之前先把這類優惠票的整段文字（含它後面共用字首的價格列表，例如「NT$2,990/2,690/2,490」這種只有第一個數字有自己的錢字符）拿掉，只讓一般票種的價格當 min/max 候選。3 個既有測試的預期值原本意外把優惠價當成「正確答案」，這次一併修正過來。

`npm test` 91 個測試全過（新增 2 個測試明確鎖住優惠票排除邏輯）。

## 音樂祭標題被截斷、收藏無視畫面篩選器、搜尋清空沒還原時間表（2026-09-21，同一天）

Max 這輪抓到三個各自獨立的真實 bug：

1. **「2026 FIREBALL Fest. 火球祭」卡片只顯示「火球祭」**：火球祭這種音樂祭品牌名稱被登記進 `artists.yml` 當 canonical，純粹是為了讓 `guessTagsType()` 認得出音樂祭類型，不是真的演出者，但卡片標題邏輯把它當成普通 headliner 處理，直接吃掉了標題其餘部分。新增 `displayTitle()`：`tags_type` 含「音樂祭」時一律顯示完整原始標題，不只顯示比對到的品牌名稱；隱藏管理頁的單場次排除清單也套用同一個函式，是同一類問題。
2. **收藏的場次會無視所有畫面篩選器強制顯示**：Max 把城市篩選器切到「新北」，卻看到一場收藏的台北場次（Age Factory @ SUB LIVE）照樣出現。回頭查證 SRS 的 FR-33 原始文字「收藏優先於所有排除規則」，用詞是「排除規則」（`prefs.excluded_*`），不是「畫面篩選器」（viewFilters，是後來才加的獨立機制）——原本的決策樹把兩者混在一起短路掉了。修法：收藏依然無條件贏過封鎖藝人/類型/關鍵字/單場排除這些規則，但現在也要通過畫面篩選器（城市/月份/類型/地區/價格）才會顯示。SRS 的決策樹圖跟 FR-33 文字同步更新。
3. **清空搜尋文字沒有還原時間表**：首頁 inline 搜尋面板原本疊在已經有資料的時間表上面，空字串時卻顯示「輸入藝人或標題開始搜尋」的提示（跟輸入框自己的 placeholder 重複），時間表資料明明已經在旁邊。改成空字串時直接還原顯示時間表。`search.html` 那個獨立搜尋頁面沒有時間表可以還原，維持原樣顯示提示是對的，這次只改 inline 版本。

`npm test` 95 個測試全過（新增 4 個測試鎖住前兩個行為）。

## 追到底：時間/票價缺漏的根因是全形｜被正規化成半形、正則卻沒跟上（2026-09-21，同一天）

Max 再次質疑「但我還是看到很多時間或票價沒有上，是發生什麼事」——沒有接受「本來就會有缺漏」，逐一打開真實頁面查證後，這次挖到全 session 最隱蔽的一個 bug：

**`PRICE_LABEL_RE`（票價標籤擷取正則）的字元類別只寫了全形「｜」（U+FF5C），但 `normalizeFullwidthAscii()` 會在比對前先把包含這個字元在內的整段全形 ASCII 範圍轉成半形，「｜」因此變成半形「|」（U+007C）——正則永遠比對不到，靜默退回不精準的關鍵字 fallback。** KKTIX／iNDIEVOX／Ticket Plus 三個來源都用「票價｜」這種格式，全部中招；之所以一直沒被抓到，是因為既有測試的票價文字剛好都同時含有「預售」「現場」這種會觸發 fallback 的關鍵字，掩蓋了 label 比對路徑本身早就失效的事實。用一支寫進 scratchpad 的除錯腳本，繞開 ESM 的 import 限制直接注入除錯輸出，才追出這條全形轉半形的因果鏈。修法：字元類別加回半形「|」。

同一輪查證順便修了另外四個問題（都是打開真實頁面才發現，不是憑經驗猜的）：

- **Ticket Plus 貨幣格式沒吃全**：`CURRENCY_NUMBER_RE` 只認「NT$」「$」「元」，遇到「TWD 4,280」「NT4,000」（無 `$`）這種寫法直接跳過；有些頁面票價欄位裡根本沒有任何貨幣符號，只有純數字列表（「票價｜8,500 / 8,000 / … / 1,500」），新增 `BARE_NUMBER_LIST_RE` 作為 fallback——因為已經確定身處「票價」標籤內才敢信任裸數字，跟全頁面關鍵字 fallback 的風險不一樣。
- **iNDIEVOX label 前後容許空格**：「活動地點 ｜」這種標籤跟分隔符號之間多一個空格的寫法，先前的正則要求緊鄰，比對不到。
- **拓元、FANSI GO 兩份 adapter 的 file header 註解都寫死「時間抓不到／是裝飾文字」的結論**——這是本次 session 第二次證明「舊的 code comment 不能信」（第一次是 FANSI GO 的場館欄位）。實際打開真實頁面查證，拓元的 `#intro` 區塊裡有 `📅 時間：` 開頭的真實結構化時間（用 `<span>` 標籤把日期字元拆開，正則要加標籤容忍度才吃得到），FANSI GO 詳情頁場館區塊正上方的 sibling 元素也有真實的「YYYY/MM/DD HH:MM」文字，兩者都跟已經在抓的資料同一次頁面載入就能拿到，不需要額外的網路請求。新增 `SHOW_TIME_RE`（拓元）跟對應的擷取邏輯（FANSI GO），`parseTixcraftDate()`（兩者共用）也跟著支援解析附加在 `date_raw` 尾端的 `HH:MM`。

全量重新抓取驗證（清空 `events.json` 重跑 `node scripts/fetch.mjs`）：289 場總數不變，時間缺漏 97→65（拓元 52、iNDIEVOX 24，多數是頁面真的還沒公布時間），票價缺漏→61（Ticket Plus 33、iNDIEVOX 25、拓元 9、FANSI GO 7，抽查確認至少一筆是頁面本身寫「票價另行公告」）。`npm test` 100 個測試全過。

## 待整理清單清到 0 筆，順便修好 KKTIX 新版頁面模板 bug（2026-09-22）

Max 說「我沒有想要手動整理欸，請你自己整理」——這台 Mac 上直接接手了待整理佇列（跟上班電腦那邊各自獨立進行，兩邊 commit 過幾輪後有合併）。7 筆原始清單逐一開票券頁查證（不是憑標題猜）：

- **陳如山「那些我賣不出去的歌」城市小巡迴**卡在 `date_unparseable`，但頁面上的日期格式完全正常——追出真正原因：**KKTIX 現在同時存在兩種活動頁面模板**，`kktix.mjs` 的 `fetchEventDetail()` 只認舊版的 `.event-info ul.info li` 結構（例如 thewall.kktix.cc 用的），這場用的是新版 `.side-inner .section` 結構，選不到任何東西，`date_raw`/`venue_raw`/`tickets_raw` 全部抓空。新增模板偵測（`$(".side-inner").length > 0 && $(".event-info").length === 0`），兩種版面分別用對應的選擇器解析，票券狀態的 `.waiting`（尚未開賣）class 名稱在新版沒有實例可以驗證，標成 ⚠️ 推測未證實。
- **紙博 in 台北 vol.2**（Ticket Plus 兩個場次）查證後是日本紙品文具展，不是音樂演出，加進 `NOISE_KEYWORDS`。
- **曾艾佳、回聲樂團、BORIS、KITA、周穆、葉澈、尚霖、Juice=Juice** 逐一開票券頁確認身分後補進 `artists.yml`（KITA/周穆/葉澈/尚霖是同一場拼盤演出的四位演出者，查證頁面：ticketplus.com.tw/activity/6def673ab73ab7d7a4d0597ae84809ca）。

**順便修好一個真實 bug**：`needs-review.json` 從來沒有去重過——陳如山那場因為同時命中 KKTIX 的 org 頁跟搜尋兩種抓取策略，在待整理頁重複出現兩次。`fetch.mjs` 寫檔前加了 `(source, raw_id)` 去重。

三輪 `npm run fetch` 實際跑驗證（不是只改完程式碼就假設有效）：7 筆 → 2 筆（KKTIX 模板 bug 修好但陳如山還沒進 artists.yml，加上一筆新出現的 Juice=Juice）→ 1 筆（補完陳如山）→ **0 筆**。`npm test` 134 個全過。Commit `05663cb`。

## 新增兩個使用者功能：回報問題、開賣提醒加入行事曆（2026-09-22）

Max 提了兩個功能需求，先用 `AskUserQuestion` 確認做法（因為兩個都有明顯的分岔，不想自己假設）：

**1. 回報問題**——「使用者回報以後，Max 確認問題，Claude 修掉問題」。入口選在**每張卡片的排除選單裡**（推薦選項，比另開一個統一的意見回饋頁精準，缺點是要多改一點畫面，Max 選了這個）：

- 新增 Supabase 表 `public.event_reports`（event_id/event_title/event_url/description/reporter_user_id/page_url/created_at/status），**只有 INSERT policy，沒有 SELECT**——連回報的人自己都讀不回來，Max 直接在 Supabase 後台 Table Editor 看，不做管理畫面（跟這個專案其他表同一個模式）。**這份 SQL 還沒有在 Supabase 後台真的執行過**，見 `supabase/schema.sql` 尾端的完整語句，Max 要自己去 SQL Editor 跑一次才會生效——瀏覽器裡已經實測過「表不存在時」的失敗路徑（`PGRST205` 錯誤，畫面正確顯示「回報失敗，請稍後再試」，不會讓整頁掛掉），但成功寫入的路徑要等 Max 跑完 SQL 才能驗證。
- `src/interactions.js` 的 `openExcludeMenu()` 加了第四個選項「回報這場資訊有誤」（跟前三個排除選項之間用一條分隔線隔開，語意上是不同類的操作），點了開 `openReportDialog()`（新函式，跟既有的 `openAssignArtistDialog()` 同一種 `.dialog-box` 樣式），送出呼叫 `src/supabase.js` 新增的 `reportIssue()`。不登入也能回報（`reporter_user_id` 是 `getSession()` 目前有沒有 session，沒有就是 `null`，不是必填）。

**2. 開賣提醒加入行事曆**——延伸既有的「尚未開賣」倒數標籤（見上面 2026-09-22 稍早的票價/時間 bug 修復章節）。做法選了**匯出 .ics**（推薦選項，純前端零後端；沒選 Web Push 是因為那需要新增 service worker + VAPID + 一個會定時檢查「誰的收藏快開賣了」的伺服器排程，工程量大很多，Max 選了 .ics）：

- 新增 `src/ics.js`：純函式 `buildOnSaleReminderIcs(event)`，產生單一 VEVENT + 兩個 VALARM（開賣前 15 分鐘、開賣當下各一個），UID 用場次 id 固定住（重複下載同一場的提醒會更新既有行事曆項目，不會一直重複新增）。刻意不做 RFC 5545 的長行折疊（line folding）——測過 Google Calendar/Apple Calendar 都能正常吃未折疊的長行，中文字折疊要處理多位元組邊界，這次沒有真的遇到問題，不值得先做。配 6 個單元測試 `src/ics.test.js`。
- `src/render.js` 的 `renderEventCard()` 在 `status === "announced" && on_sale_at` 已知時，於「尚未開賣」badge 下方加一顆「🔔 開賣提醒加入行事曆」按鈕（`.btn-remind`，新 CSS class）。**已經是 on_sale 或已售完的場次不會顯示**——這個提醒是「幫你記得去買」，不是「幫你記得這場秀」（後者才是 FR-35 原本規劃、還沒做的「收藏匯出 .ics」，是不同的功能）。
- `src/app.js` 新增 `wireRemindButtons(container)`，用跟 `wireTicketButtons()` 完全一樣的自足模式（所有需要的欄位都編碼在按鈕的 `data-*` 屬性裡，不用回頭查 `events` 陣列），接到全部 6 個會渲染卡片的地方（時間表、新上架、收藏列表、收藏日曆、搜尋、已隱藏管理）。點擊後用 `Blob` + `<a download>` 觸發瀏覽器下載，跟既有的匯出 JSON（FR-63）同一套機制。

**實測**：瀏覽器裡確認過按鈕只在正確的狀態下出現、點擊觸發下載無 console 錯誤、直接呼叫 `buildOnSaleReminderIcs()` 檢查過輸出格式正確（`DTSTART` 真的是開賣時間、不是演出時間）；回報表單填寫送出、確認打中 Supabase（目前因為表還沒建，收到預期中的 `PGRST205` 錯誤，UI 正確顯示失敗提示而不是整頁掛掉）。`npm test` 143 個全過（新增 9 個：6 個 `ics.test.js` + 3 個 `render.test.js` 的按鈕顯示條件）。

**2026-09-22 更新：Max 已經跑完 SQL，回報功能上線並實測成功**——在瀏覽器裡對一張真實卡片送出一筆測試回報，直接用 SQL Editor 查 `public.event_reports` 查到那筆資料（`event_id`/`event_title`/`description` 都對），確認整條路徑從前端到資料庫都通了，驗證完用 `delete` 清掉測試資料。`supabase/schema.sql` 已經更新成跟 `user_prefs` 一樣的「最後對照日期」格式。

## 回報功能上線後收到的第一批真實回報，三個都是真的 bug（2026-09-22）

Max 用剛做好的回報功能（或直接在對話裡）丟了三個問題，全部逐一查證（不是憑標題猜、也不是照使用者說法照單全收——每個都先開實際頁面確認過根因）：

**1. 岡崎體育 10/24 場「已取消」卻顯示 on_sale**：查證後確認 Ticket Plus 頁面上有清楚的「最新公告」取消聲明（岡崎體育無限期停止演藝活動，全額退票）跟頁面層級的「銷售截止」狀態文字。追出真正原因：`ticketplus.mjs` 的 `fetchSaleStatusMap()` 其實**有**正確抓到這個狀態文字（選擇器沒問題），問題在 `normalize.mjs` 的 `SOLD_OUT_TEXT_RE` 正則只認「銷售一空／選購一空／售完／完售／售罄／登記截止」六種字樣，沒有把「銷售截止」這第七種也算進去，於是完全被忽略、預設回退成 `on_sale`。修法：正則補上「銷售截止」，比照其他同義詞一樣導向既有的 `sold_out`／`ended` 分支——不是精確的「已取消」語意（沒有可靠訊號能區分「取消」vs「單純售票期結束」，這個字串本身兩種情況都可能出現），但至少不會再謊稱「可以買」，比新增一個沒有可靠資料源可以填的全新 `cancelled` 狀態更誠實。

**2. Chevon 11/29 場被標成拼盤、顯示名稱是「Chevon / Yoshinani」**：查證後這場是 Chevon（日本札幌搖滾樂團）的個人專場，「Yoshinani」是這次巡迴的企劃/概念名稱（「Chevon pre.よしなに〜遊牧編〜」，pre. 是 presents 的意思），不是第二位演出者。根因：`data/artists.yml` 裡真的有一筆假的「Yoshinani」canonical（之前某次批次查證誤植），造成 `matchArtists()` 假陽性配對成兩位演出者，`guessTagsType()` 因此誤判成拼盤。已經把假的 Yoshinani 條目刪掉，順便發現 Chevon 自己的 `tags_origin_default` 也標錯（寫本地，實際是日韓），一起修正。

**順便處理 Max 這次點出的更根本問題**：「你顯示的名稱不用少，直接把那個演出的標題同步顯示就好，你這樣簡寫就造成你自己判斷失誤了對吧」——`displayTitle()` 原本（2026-09-21 那次）只在 `tags_type` 是音樂祭時才退回顯示完整原始標題，其他情況一律顯示比對到的 headliners 陣列。這次證明同一種「簡化顯示 = 自己也被誤導」的問題不只發生在音樂祭，**任何**比對錯誤都會同時搞砸畫面顯示和資料分類兩件事。**做法改成 `displayTitle()` 永遠回傳原始標題**，不再嘗試用比對到的演出者名字組出精簡版標題——headliner 比對本身還是保留（排除規則、來源地標籤都還要用），只是不再拿它的結果來決定畫面上寫什麼。`src/render.test.js` 對應的兩個 `displayTitle` 測試已更新。

**3. KKTIX 漏掉 10/31 藤井風、11/24（實際上是 10/24，使用者記錯月份，事件本身是同一場）高橋洋子**：查證後兩場都真實存在於 KKTIX，但完全沒被抓到——追出真正原因跟之前修過的個別涵蓋率缺口不一樣，這次是**整整兩個主辦帳號從來沒被收錄過**：`kklivetw`（KKLIVE Taiwan，主辦滅火器/洪佩瑜/藤井風等多組演出者，橫跨小巨蛋到體育場等各種場地，7 場當前活動全部沒抓到）、`atc-twn`（天照網訊，專做日本偶像通告的主辦方，16 場活動全部沒抓到）。這兩個帳號模式完全符合 `ORG_PAGE_VENUES` 的設計（單一帳號自己辦大多數場次），只是之前沒被發現/加入——加進清單後直接補進 23 場原本完全看不到的演出。

**額外查證補齊的真實藝人**（這兩個帳號補進來後冒出的 needs-review 待整理清單）：藤井風、高橋洋子、滅火器、山下智久、TayNewPolcasan（泰國藝人 TayNew 見面會）、Fear, and Loathing in Las Vegas（日本電子核樂團）。

**還沒解決、誠實記錄的殘留缺口**：這兩個新帳號的活動裡有 6 筆卡在 `date_unparseable` 且 `title_raw` 是空字串——查了其中一筆（TayNewPolcasan Family Trip）發現這是**第三種 KKTIX 頁面模板**：`.header-title h1`（標題）在頁面初次載入時是空的，日期/場地資訊也不在慣用位置，實際內容顯示在「簡介」/「活動資訊」分頁切換後面，需要跟前兩種模板（`.event-info`／`.side-inner`）完全不同的處理方式才能解析。這次沒有深入解決——影響範圍小（6 筆，都安全地卡在待整理，不會顯示錯誤資料），但如果之後這兩個帳號或其他帳號又冒出更多這種模板的活動，需要專門排時間處理第三種模板，不要當作跟前兩次一樣的小修就好。

**驗證方式**：三個回報都在瀏覽器/命令列直接開真實頁面查證根因（不是照 Max 的描述直接動手改），改完程式碼後**強制重新抓取**受影響的兩場（先從 `events.json` 手動移除，讓增量抓取機制不會跳過，重新完整爬一次），確認修好後才 commit。`npm run fetch` 跑了三輪（KKTIX 模板/正則修好 → 加兩個新帳號 → 補齊查證的藝人），最終 300 場正式場次、6 筆待整理（都是上述已知的第三模板缺口）。`npm test` 143 個全過。

## Max 三點回饋，逐一從根本修：語意化正則、通用地理過濾、清空待整理清單（2026-09-22，同一天）

Max 看完上面三個回報的修法後回饋三點，核心是同一個問題：**「遇到清單裡沒列的就忽略/不管」這個做法本身不能接受**，要嘛從根本判斷，真的判斷不出來才問人，不能直接省略：

1. **「銷售截止」不該靠白名單**——`SOLD_OUT_TEXT_RE` 從逐字列舉六個同義詞，改寫成**結構化樣式**：`(?:銷售|選購|販售|售票|登記)(?:一空|截止|結束)` + 幾個獨立複合詞（售完/完售/售罄/停售）。測試裡刻意加了一個「從沒在這個 codebase 出現過的組合」（販售結束）驗證真的是通用樣式在生效，不是換個方式重列白名單。`sale_status_text` 本來就是從一個很窄的結構化狀態元件抓出來的（不是整頁自由文字），這是能放心用結構化樣式、不用真的做語言理解的原因。

2. **KKTIX 音樂類別全站掃描上線**（`fetchCategoryBrowsePages`，Strategy 3）——這是這次影響最大的改動，直接回應「帳號沒被收錄過為什麼就不會出現」：不再只靠 `ORG_PAGE_VENUES`／`SEARCH_VENUES` 這兩份手動維護的清單，改成每次抓取都掃過 `kktix.com/events?event_tag_ids_in=13`（音樂類別，20 頁上限）整個 KKTIX 平台的音樂類活動，不管主辦帳號有沒有被收錄過都會抓到。跑第一次就多抓到 80 場全新場次；後續每天靠既有的 known-raw-id 跳過機制，邊際成本很低。代價很明確：單次抓取時間從 ~2 分鐘拉長到 ~6-8 分鐘（20 頁 Playwright 瀏覽本身的固定成本），這是刻意接受的取捨。

3. **待整理清單從 89 筆清到 27 筆**，過程中發現並修好一串連鎖的真實 bug：
   - **KKTIX 站內搜尋跟音樂類別瀏覽會挖出同一個藝人在香港/澳門/深圳的場次**，不是台北場——新增 `isOutsideTaiwanVenue()`，檢查 `venue_raw`（這一筆自己的場地欄位，不是標題或全文，同樣是「查窄欄位、不查自由文字」的安全設計）是否命中香港/澳門/深圳/馬來西亞的地名或已知場地名稱（TIDES、PORTAL/The Burrow、麥花臣場館…）。這份清單注定追不完每一個新場地名稱，跟 NOISE_KEYWORDS 同一種「看到新的就加」的維護模式，誠實記錄不是一次性解決。
   - **第三種 KKTIX 頁面模板（上一節記錄的殘留缺口）修好了**：日期的自由文字格式其實比想像中更分歧——`2026年10月4日`／`2026.09.26`／`2026 年 12 月 12 日`（帶空格）都出現過，`fetchCategoryBrowsePage` 抓到的 HANAZAWA KANA 這場甚至在標籤跟日期之間夾了一整句「（實際演出時間以現場公告為準）」的括號註記。改成用結構樣式（年月日的形狀，不管中間用「年月日」「.」還是空格分隔）加上 `[^\d]{0,30}` 容忍標籤跟日期之間的短註記，而不是每多一種寫法就多加一條規則。
   - **補了一批新的 NOISE_KEYWORDS**（1500 SOUND ACADEMY 的一對一課程、Basilica 的爵士沙龍/咖啡課程系列、曉韵的講座、TECA 音響大展、POP! POP! POP! 互動展）——這些都是 KKTIX「音樂」類別裡真實存在、但不是演出的內容，全站掃描上線後才第一次接觸到這個問題。
   - **逐一查證補齊 35 筆真實藝人**（HANAZAWA KANA、LEE MINHYUK、Gareth Gates、Engelbert Humperdinck、SKR FAMILY PARTY、天韻、BENI NINAGAWA 等），方法跟之前一樣：開真實票券頁確認身分，不是憑標題猜。

**還沒解決、誠實記錄的殘留缺口（27 筆）**：一部分是本節修好的地理過濾/日期樣式沒能涵蓋到的個案（例如某些香港場地名稱還沒進 `OUTSIDE_TAIWAN_VENUE_RE`，或日期文字格式還有沒見過的寫法），另一部分是身分/來源地真的需要開頁面查證但這次沒時間逐一確認的藝人（Cello In Between 的演奏者是誰、晚安莉莉這場到底在不在台灣、Ponpon/MISTERK/HITORI-ESCAPE 的正確身分等）——這些寧可留在待整理清單裡誠實承認「還沒查證」，也不要用標題猜一個可能錯的身分或地區標籤硬塞進 `artists.yml`。

## 首頁介紹卡改成彈出視窗、日韓分類拆成日本／韓國（2026-09-23）

**首頁介紹卡改彈出視窗**：Max 貼了介紹卡的截圖，指出常駐在頁首的說明卡「應該可以在新增回報機制的說明，但我覺得他會變得有點長所以我想改成彈出視窗」。先把機制說明講清楚讓 Max 確認過（觸發方式選項用 `AskUserQuestion` 問，Max 選了「常駐 ⓘ 圖示按鈕」而不是把說明塞進其他選單裡），才動手做：`index.html` 拿掉整塊可關閉的 `#intro-card`，改成 `.topbar` 裡搜尋按鈕旁邊加一顆 `#intro-info-btn`（ⓘ 圖示），點了開 `openIntroDialog()`（`src/interactions.js` 新函式，跟其他說明性彈窗一樣是 `.dialog-box` 樣式，不是 `.sheet`）。內容比原本的卡片多兩行，把這個 session 新增的兩個功能也一併寫進說明：「🚩 場次資訊有誤？卡片的 ✕ 選單裡可以直接回報。」「🔔 尚未開賣的場次可以加入行事曆，開賣前會提醒你。」`state.js` 的 `loadIntroDismissed`/`dismissIntro`（原本用來記「使用者關掉過卡片」的 localStorage 邏輯）整段刪掉——彈出視窗本來就不需要「記得使用者關過」這件事，每次點 ⓘ 才會跳出來。

**日韓分類拆成日本／韓國**：Max 要求「日韓分類可以分開成日本韓國兩個類別」。查證方式先問過 Max（三個選項：憑既有知識直接分、逐筆開票券頁/搜尋查證、混合），Max 明確選了**逐筆開票券頁/搜尋查證（推薦，最準確）**、不要用既有知識猜——`data/artists.yml` 裡標 `日韓` 的有 105 筆，**逐一**用 WebSearch 查證每個藝人的真實國籍/出身，不是照名字或團名的既有印象分類。

查證結果：66 筆歸日本、35 筆歸韓國，**過程中順便抓到 4 個原本被 `日韓` 這個合併分類掩蓋掉的真實資料錯誤**（這正是 Max 之前對「銷售截止」白名單那次回饋點出的同一種問題——分類粗糙會讓底下的錯誤沒人發現）：

- **W!nky 被誤標成日韓，實際是台灣選秀節目（宇宙少女應援團）出身的 9 人女團** → 修正成 `本地`。
- **JUST YOU & WIN 被誤標成日韓，「WIN」其實是泰國演員 Win Metawin（薇恩）** → 修正成 `亞洲其他`。
- **HANAZAWA KANA（花澤香菜）跟 LEE MINHYUK 各自有兩筆重複的 `artists.yml` 條目**（應該是不同批次補藝人時沒檢查已存在條目造成的），逐一比對後合併，保留有 alias 的那筆、刪掉沒有 alias 的重複筆。

修正過程用暫時腳本 `scripts/_split-origin.mjs`（跑完即刪除，不留在 repo 裡）批次改寫 `tags_origin_default`，過程中三次漏查（先是 3 筆條目因為 canonical 那行帶了行內註解導致正則沒吃到、後來發現 9 筆條目其實已經有查證註解但還沒改值、最後又漏了 5 筆完全沒被納入查證清單）——每次都是靠 `grep -B2 "tags_origin_default: 日韓"` 重新掃一次抓出遺漏，不是查完一輪就假設做完了。最終確認 0 筆殘留 `日韓`。

**踩到跟先前 Chevon/岡崎體育同一個雷：增量抓取的 `reuse_previous` 機制**——`data/artists.yml` 改完後直接跑 `npm run fetch` 是沒用的，因為現有 358 場正式場次全部已經是「已知」場次，`reuse_previous: true` 會直接沿用舊的 `tags_origin`，不會重新跑 `normalize()`。寫了暫時腳本 `scripts/_recompute-origins.mjs`（同樣跑完即刪除），直接對 `data/events.json` 每一筆已知場次重算 `tags_origin`（邏輯跟 `normalize.mjs` 的「聯集所有已辨識演出者的 `tags_origin_default`」完全一致，不是另外寫一套），跑完顯示「recomputed tags_origin for 116 of 359 event(s)」。

**順便清掉一批被同一種增量快取機制放過的舊資料**：瀏覽器裡人工檢查時發現有 5 場已經快取的 KKTIX 場次場地在香港（麥花臣場館、AXA安盛創夢館等），這是因為這幾筆是在這個 session 稍早新增 `isOutsideTaiwanVenue()` 地理過濾**之前**就已經抓進來的舊資料，同樣不會被增量抓取自動重新過濾掉。寫了另一個暫時腳本 `scripts/_remove-outside-taiwan.mjs`（跑完即刪除）直接比對現有的 `OUTSIDE_TAIWAN_VENUE_RE` 從 `events.json` 移除這 5 筆（Yuki Kajiura in Hong Kong、YUURI IN HONG KONG、5 Seconds of Summer Live in Hong Kong、U-KNOW PROJECT in HONG KONG、Simple Plan Live in Hong Kong）。**這是一個值得記住的通用模式**：任何時候修改 `artists.yml` 的分類邏輯或新增/調整排除規則，都要記得增量抓取的「已知場次不會重新 normalize」這個特性會讓舊資料卡住不會自動套用新規則，需要額外一個直接патch `events.json` 的腳本，不能只靠重跑 `npm run fetch`。

**其他程式碼改動**：`src/app.js` 的 `ORIGIN_DISPLAY_ORDER` 從 `[本地, 日韓, 歐美, 亞洲其他]` 改成 `[本地, 日本, 韓國, 歐美, 亞洲其他]`；`add.html` 的手動新增場次表單「來源地」chip 群組同步更新（順便修掉一個更早以前就存在、這次才發現的舊 bug：清單裡還留著改名前的舊字「海外」，這次一起換成「亞洲其他」）；`src/interactions.js` 的 `openAssignArtistDialog()` 指派來源地下拉選單同步更新；`src/filter.test.js` 的測試 fixture 把 `"日韓"` 改成 `"韓國"`（原本測試變數命名就叫 `kpop`，改完更貼合語意）。

**驗證方式**：`npm test` 147 個全過；瀏覽器裡開發伺服器實測，`get_page_text` 確認畫面上多筆真實場次（TREASURE→韓國、藤井風→日本、BTS→韓國）標籤正確，篩選 chip 的 bottom sheet 正確列出「全部地區／本地／日本／韓國／歐美／亞洲其他」五個選項；確認 console 無錯誤。

`npm test` 147 個全過（新增 6 個：`SOLD_OUT_TEXT_RE` 語意化樣式 2 個、`isOutsideTaiwanVenue` 地理過濾 2 個、噪音關鍵字批次 1 個）。`npm run fetch` 這次分三輪驗證（地理過濾/日期樣式修好 → 加確認的藝人 → 最終日期樣式再擴充），最終 358 場正式場次、27 筆待整理。
