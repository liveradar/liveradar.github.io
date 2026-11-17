# 交接文件 — 換電腦/換 session 接續開發前先看這份

寫於 2026-09-15，最近一次大整理 2026-09-25。**這份文件的目的**：讓一個完全沒看過對話紀錄的人（未來的你、另一台電腦的全新 session）在 5 分鐘內知道現在做到哪、能不能信任目前的程式碼、下一步該做什麼。

**怎麼讀這份文件**：這份只放「現在的狀態」「已知還沒解決的問題」、接手步驟、踩過的坑與測試／決策的索引，每次都值得讀。照時間順序寫的完整開發記錄（各功能與 bug 的根因分析）在 2026-11-17 搬到 [`HANDOFF-HISTORY.md`](./HANDOFF-HISTORY.md)——那份**內文不會回頭更新**，讀到「還沒做」「尚未解決」不代表現在還是這樣，一律以這份為準；需要查某個功能的來龍去脈時用關鍵字搜尋那份即可，不需要整份讀。

## 現在的狀態（2026-09-25）

M1~M12 全部完成，十個來源（KKTIX/拓元/iNDIEVOX/FANSI GO/Ticket Plus/Billboard Live TAIPEI/ibon/OPENTIX/寬宏/年代）都在運作。抓取不走 GitHub Actions（拓元／Ticket Plus 會被其 IP 擋掉，決策 S5），改由上班電腦的 Claude 排程任務 `liveradar-daily-fetch` 每天約上午 10:00 自動跑（`git pull` → `npm ci` → `node scripts/fetch.mjs` → `npm test` → 通過才 commit+push）。跨裝置同步已經是真帳號登入（Supabase + Google OAuth），取代了最早的 Gist token 機制。

近期重大變動：
- **9/24**：五個平台的已收錄場次每天會複查售票狀態（不再永遠停在剛發現時的狀態）；新增 `fetch-one`／`renormalize` 兩個工具，改抓取程式或補完藝人不用再跑整套 `npm run fetch`；同一時間只允許一個抓取在跑（`.fetch.lock`）；查證藝人身分的規則定案（看在哪個音樂圈成名，不是國籍，見「別再踩的坑」第 11~14 條）。
- **9/25**：KKTIX 新增 Strategy 4，掃「其他」分類抓沒被主辦方標任何分類的場次；`register_info` 優先改看頁面 JSON-LD，大幅降低被 Cloudflare 擋的次數；修好 Disney 兩場被誤合併、合併卡片複查只看第一個來源的 bug；**修好一個嚴重的資料遺失 bug**——`reconcileSupabaseSync()` 會把全新裝置的空白預設值覆蓋掉雲端真實收藏資料，已修好並測試涵蓋，但當天發生的一次真實資料遺失沒能救回來（見下方「已知問題」）；約 300 筆藝人分類補上查證依據；**新增第 6 個來源 Billboard Live TAIPEI**（單一場館自己賣票，不在其他 5 個平台上架，22 場零重疊）——技術細節見 LIVERADAR-SPEC.md §5.8，測試已涵蓋（`scripts/billboard.test.mjs`），等下次排程真實跑過確認端到端行為。

- **9/26**：新增「舞台劇／音樂劇分類＋同場館合併一張卡」這個共同基礎（PLAN-1-theater-runs.md，四份加來源規格的第一份）。`normalize.mjs` 新支援 RawEvent 的 `category`／`run_key` 兩個選填欄位；新模組 `scripts/runs.mjs`（`groupRuns()`，在 `dedupe()` 前把同一檔戲、同場館的所有場次合併成一張帶 `sessions` 陣列的卡）；`dedup.mjs`／`diff.mjs`／`renormalize.mjs`／`fetch.mjs` 的待整理清單都配合跳過或改判斷已合併的「run」事件；前端新模組 `src/runs.js`（`materializeRun`／`eventDates`，把「資料一天只更新一次」跟「場次每天在演完」這兩件事橋接起來），`filter.js`／`app.js`（月份篩選、收藏月曆）／`render.js`（多場次卡片的「🎭 檔期」行）都已串接。**目前還沒有任何 adapter 會實際帶出 `category`／`run_key`**（PLAN-2/3/4 那三個新來源都還沒做），所以這次上線不會改變任何一張現有卡片的外觀，純粹是幫 PLAN-3/PLAN-4 先把地基做好。測試涵蓋（`scripts/runs.test.mjs`、`src/runs.test.js`，加上 dedup/diff/normalize/filter/render 各自補的回歸測試，`npm test` 260 個全過），並用假資料在本機 dev server 手動驗證過時間表分組、月份跨月篩選、類型篩選、收藏月曆跨月點點都正確（驗證完已還原 `data/events.json`，沒有進 commit）。

- **9/26（第二筆）**：新增第 7 個來源 **ibon**（PLAN-2-ibon.md，只收「娛樂」類，跟現有 6 個來源零重疊）。技術細節見 LIVERADAR-SPEC.md §5.9。順便修了 `parsePriceFromText` 兩個真實 bug（用 ibon 真實內文發現的，會一起改善所有來源的票價解析）：①「票價｜」單獨一行、票種寫在下面幾行時原本只抓到第一個票種；②標籤跟分隔符號之間文字太長（例如雙語標籤「票價資訊 Ticket Price：」）原本比對不到，會誤抓文中一個年份當票價。加寬比對範圍時差點引入新的回歸（讓比對跳過標籤自己的分隔符號、抓到後面不相干的另一個分隔符號），已修正並補了回歸測試。`normalize.mjs` 的 `statusFromTickets` 也新增支援「沒有票種表格、但有結構化開賣時間訊號」的來源（ibon 屬於這種）。`data/venues.yml` 補了 3 個 WebSearch 查證過的場館（花漾展演空間 HANASPACE、MOONDOG、台大綜合體育館）。測試涵蓋（`scripts/ibon.test.mjs`，加上 normalize 的回歸測試，`npm test` 278 個全過），並用真實抓取的一次性腳本驗證過每一場的日期/狀態/開賣時間/票價/城市（跑完即刪），跟 ibon 網頁逐場對照正確；等下次排程真的跑過整套 pipeline 確認端到端行為。

- **9/26（第三筆）**：新增第 8 個來源 **OPENTIX**（PLAN-3-opentix.md，戲劇-音樂劇/現代戲劇＋音樂-流行/爵士/世界民族 5 個分類，排除親子節目）。技術細節見 LIVERADAR-SPEC.md §5.10。這是**第一個真的用到「舞台劇／音樂劇分類＋合併卡片」機制的來源**（PLAN-1 上線時還沒有任何 adapter 實際帶出 `category`/`run_key`）：搜尋 API 一次拿到節目清單＋每一場的結構化排程/票價資料，售完狀態要另外從活動頁的 JSON-LD 讀，用「開演時間（到分鐘）＋場館名稱」而不是陣列順序對應回搜尋結果（9/25 實測有 2 檔節目兩邊場次數不一樣）。把 `billboard.mjs` 裡的時區轉換函式抽成共用的 `scripts/taiwan-time.mjs`，`billboard.test.mjs` 照樣全過。測試涵蓋（`scripts/opentix.test.mjs`，含一個 normalize+groupRuns 端到端整合測試，`npm test` 304 個全過）。用真實抓取驗證過：《三個傻瓜》多場館各一張卡、《神隱少女》1 張卡 50 場、《鶯鶯》(取消) 顯示「結束販售」都跟網站對照正確；也在本機 dev server 用真實抓到的資料手動驗證過卡片外觀、月份跨月篩選、類型篩選（驗證完已還原 `data/events.json`）。**這次真實抓取（660 個場次）裡沒有任何一場是「尚未開賣」狀態**——不是 bug，OPENTIX 目前上架的節目剛好都已經開賣了，`COMING_SOON` 這條路徑已經用合成資料的單元測試涵蓋過，行為正確。

- **9/26（第四筆）**：新增第 9、10 個來源 **寬宏／年代**（PLAN-4-kham-era.md，四份加來源規格的最後一份；演唱會、音樂劇、戲劇三個分類，不收「音樂」類）。技術細節見 LIVERADAR-SPEC.md §5.11。兩個平台是同一套「UTK」售票系統，共用一套 adapter（`scripts/adapters/utk.mjs`，`kham.mjs`／`era.mjs` 各自只傳 host 名稱），是繼 OPENTIX 之後第二個用到「舞台劇／音樂劇分類＋合併卡片」機制的來源。關鍵真實資料坑：不管賣不賣完「立即訂購」按鈕文字都不變，唯一售完訊號是價格數字被 `<s>`（寬宏）／`<del>`（年代）劃線；一場真實演出常被拆成好幾個表格列（不同價位、輪椅場），靠「日期＋時間＋場館」合併；尚未開賣的節目場次表整張是空的（甚至會被 302 導到另一個樣板頁），直接跳過等下次排程。順手排除年代一筆偽裝成戲劇票的贊助方案（「星火計畫」，加進 `NOISE_KEYWORDS`）。測試涵蓋（`scripts/utk.test.mjs`，26 個測試全用真實 HTML 片段/真實案例，`npm test` 330 個全過）。用真實抓取驗證過：BIGBANG 高雄 sold_out、WILD WILD 三場館各一張卡、XG WORLD TOUR 輪椅票排除、Jason Mraz 正常收錄、年代親子演唱會確認排除，全部跟網站對照正確；也在本機 dev server 用真實資料驗證過卡片外觀（驗證完已還原 `data/events.json`）。**已知限制，接受不處理**：跟其他平台之間沒有跨平台去重，場館名稱異體字（「臺北」vs「台北」）差異會讓同一場演出如果在兩個平台都上架，各自出一張卡不會合併——目前沒遇到真實案例。

- **9/26（第五筆）**：修好 KKTIX group-hub 頁面重複卡片的 bug（真實案例：花澤香菜台北公演明明已開賣，畫面上卻多一張卡卡在「尚未開賣」）——KKTIX 有些頁面自己不賣票、只連到真正賣票的子頁面，這種頁面以前會被當成獨立卡片收進資料，若它的子頁面又剛好被獨立抓到，同一場演出就會出現重複卡，而且這張多餘的卡因為沒有自己的票，狀態會永遠卡住不會被排程複查更新。新增 `findChildEventIds()`／`isRedundantGroupHub()`（`scripts/adapters/kktix.mjs`）：只有當一個頁面完全沒有自己的票、而且它連到的每個子頁面這次都有被獨立抓到時，才在抓取收尾時把它排除；只要有子頁面沒被獨立抓到就保留（避免刪掉唯一的入口）。測試涵蓋（`kktix.test.mjs` 新增 6 個測試，用真實頁面 HTML 結構驗證，`npm test` 336 個全過），另外用一次性腳本對真實頁面驗證過（跑完即刪）。手動移除了這個 bug 唯一已知的現存重複卡（`data/events.json`，id `ca414f99a3edbd63`），之後同類情況會在抓取時自動擋掉。

- **9/26（第六筆）**：篩選器改版（Max 需求：地區合併＋多選＋點擊已選項目取消選取）。①城市篩選的「台北」「新北」合併成一個「雙北」選項——`src/filter.js` 新增 `cityBucket()`／`DOUBLE_BEI_CITIES`，只影響篩選比對，`event.city` 本身還是原本抓到的「台北」/「新北」，卡片顯示不受影響。②五個篩選器（城市/月份/類型/音樂人地區/價格）全部改成可以多選，同一篩選器內多個選項是「或」的關係（例如城市選「雙北」＋「高雄」＝顯示這兩個地區），不同篩選器之間仍是「且」的關係，跟原本一樣。③`src/interactions.js` 的 `openFilterSheet()` 從「單選、點了就關閉」改成「多選、點擊已選項目會取消選取，點擊再次套用，視窗維持開啟直到按『完成』」——只有第一個「全部XX」選項例外，點它會清空所有選取並立刻關閉（原本的「重設」行為維持不變）。`viewFilters`（`liveradar:view_filters` localStorage）的每個欄位從單一值改成陣列；`filter.js` 的 `passesViewFilters` 同時接受單一值和陣列（`toValues()` 正規化），舊的已存 localStorage 資料或用單一值呼叫的測試都不用遷移就能繼續動。測試涵蓋（`src/filter.test.js` 新增 8 個測試，涵蓋雙北合併比對、多選 OR 邏輯、清空篩選，`npm test` 342 個全過），並在本機 dev server 用真實資料手動驗證過：城市清單正確只顯示「雙北」不再分開列台北/新北、多選城市（雙北＋高雄）正確疊加、點擊已選項目正確取消、按「全部城市」正確清空並關閉視窗（驗證完已清掉測試用的 `liveradar:view_filters`，沒有動到 `data/events.json`）。

- **9/26（第七筆）**：修好「2026 囪擊音樂祭」重複卡片（跟花澤香菜那筆一模一樣的 KKTIX group-hub bug，只是這次卡在 `city: 未知` 而不是「尚未開賣」——都是舊資料在解析邏輯變好「之前」抓到的，之後排程只複查狀態不會回頭修）；已用 `isRedundantGroupHub()` 驗證過真的會被擋下，手動清掉這筆已卡住的舊資料。新增 **`npm run health-check`**（`scripts/health-check.mjs`）：Max 問「要怎麼防範這種問題」後決定寫的——掃 `data/events.json` 揪出城市未知／場館空白／售票中卻缺票價／沒辨識出主唱／疑似重複（同日期＋時間＋場館但 id 不同，就是這兩次真實 bug 的形狀）5 種可疑資料，唯讀不會自動改，列成清單給人工判斷。測試涵蓋（`scripts/health-check.test.mjs` 8 個測試，`npm test` 351 個全過）。**第一次真的對 `data/events.json` 跑了一次**：找到 3 筆城市未知、4 筆場館空白、18 筆缺票價、5 組疑似重複（其中至少幾組——林鼓子、小宮有紗、韓東、瑋瑋、OrmFolk——看起來很像同一種 KKTIX group-hub 重複卡，還沒逐筆查證處理，留給下次）。建議定期（比如每週）手動跑一次，或以後考慮接進 `liveradar-daily-fetch` 排程自動跑完貼結果，這次沒做。

- **9/30**：處理兩則 Discord 收到的使用者回報（`event_reports` → Discord 通知 9/30 當天剛上線，見 `supabase/schema.sql`）。①**Charlie Puth 桃園場已取消卻顯示售票中**（真的 bug）：拓元活動整場取消／改地點後，購票頁只剩「目前無場次資訊」，舊邏輯看不懂這句就當作還能買。Max 決定**這類場次直接從資料移除**，不新增「已取消」狀態。②順便抓到 **Malcolm Todd 10/3 才開賣卻顯示售票中**：`parseOnSaleAt` 只看第一個標籤的 bug，所有平台共用。③《班會別鬧！》已完售（OPENTIX）不是 bug，只是當天中午抓完之後才賣完，下次排程會自動更新。詳見文末「使用者回報：拓元取消場次、開賣日解析（2026-09-30）」。commit `abd8951`。

**四份加來源規格（PLAN-1～PLAN-4）已全部完成，目前沒有待處理的 PLAN-*.md。**

Max 已經拍板的範圍：同場館合併卡片、戲劇只收音樂劇＋現代戲劇（不收兒童劇、戲曲、脫口秀）、OPENTIX 音樂只收流行／爵士／世界、寬宏／年代不收「音樂」類（多為古典和社區音樂會）。

## 目前已知還沒解決的問題

**等真實驗證的（不是 bug，只是還沒等到下次排程跑完確認端到端行為）**：
- 9/25～9/26 新增/修改的多項功能（KKTIX Strategy 4、`register_info`→JSON-LD 優化、四平台每日複查、Disney 合併修正、id 穩定性修正、`refreshedStatus` 過期場次強制轉 ended、**新增 Billboard Live TAIPEI 來源**、舞台劇／音樂劇分類基礎、**新增 ibon 來源**、**新增 OPENTIX 來源**、**新增寬宏／年代來源**）都只用單元測試＋一次性腳本手動比對過，沒有跑過真實完整抓取（`npm run fetch`）。下次排程跑完看 log／`sources.json` 確認，Billboard Live 應該新增約 20 個場次，ibon 應該新增約 35 個場次，OPENTIX 合併成 run 卡後預計新增約 100～150 張卡（660 個原始場次，大部分是戲劇多場次合併），寬宏／年代合計約 54 個原始場次（實測 29+25，扣除 3 筆噪音）合併後應新增約 43 張卡。

**2026-09-25 又查到、修好的（Max：「都沒東西要修嗎」／「還有什麼要修的」，逐筆查資料才發現，不是回報的）**：
- ~~7 場日期已經過去、status 還停在 on_sale 的已知場次~~ ✅ 已修好。前端 `isPast()` 會獨立擋掉過期場次，這個**不是使用者看得到的 bug**，但底層資料本身是錯的，指出 `refreshedStatus`（每日複查已知場次售票狀態）原本完全沒有「日期過了就該轉成 ended」這條規則，只在 SOLD_OUT/REGISTRATION_CLOSED 訊號分支裡順便算過——一旦訊號查詢失敗或沒查到，status 就會永遠停在舊值。改成日期優先判斷，不依賴任何訊號，已知場次日期一旦過去一律轉 ended。已套用到 7 場已知的殘留案例。
- ~~2 場（AIOZ《SELL MY SAD》巡演｜台北、Jane Remover 亞洲巡迴．台北首演）開賣時間已過卻還停在「尚未開賣」~~ ✅ 已修好。追查發現這兩場都是 KKTIX 來源，走 `statusFromTickets()` 專屬路徑，不會碰到 `normalize.mjs` 那段「非 KKTIX 開賣時間已過就直接轉 on_sale」的邏輯——**查證後確認 `normalize.mjs` 初始建立資料時的邏輯本身沒有漏洞**，這兩場只是單純還沒等到當天稍早才修好的 `refreshedStatus()` 每日複查跑過，不是新的獨立 bug。直接把這兩筆已快取資料轉成 on_sale（跟上面 7 場一樣的模式），不用等明天排程。

**刻意不修、已記錄清楚原因的殘留風險**：
- KKTIX 4 場大型體育場/巨蛋座位制演出（Fujii Kaze 高雄場等）只能靠常被 Cloudflare 擋的 `register_info` 判斷售票狀態，這類場次的票會持續回流重新販售，KKTIX 本身沒有「售完」這種二元狀態可以顯示，不是解析漏洞。
- `pushToSupabase()` 無條件覆蓋雲端資料，同時開兩個分頁編輯可能互相覆蓋——只有 Max 一人使用、單一裝置，實務影響極低，完全解決要上 CRDT 等級的機制，對個人專案不成比例。
- 拓元取消場次的判斷（2026-09-30）：已經是 sold_out 的場次不會再複查購票頁，「先完售、後來才取消」的場次抓不到；購票頁空白但介紹寫不出開賣日、又沒有同日同場館的已確認取消頁陪著的，一律保留（寧可留著也不誤刪）。另外 `parseOnSaleAt` 的改動沒辦法拿全部資料回歸比對（`events.json` 不存原始介紹文字），只影響之後新出現的場次，有人回報開賣時間怪怪的優先查這裡。
- KKTIX 完全沒被主辦方標任何分類的活動（例如 iri），目前仍只能靠 `ORG_PAGE_VENUES` 白名單找到；9/25 新增的「其他」分類掃描只能抓到「完全沒有標籤」的，如果活動被標了某個跟音樂無關的既有分類（例如誤標成「學習」），一樣抓不到。

**小、低優先度、觀察到但沒決定要不要處理**：
- `data/artists.yml` 裡約 64 筆藝人分類已經補上查證依據，但目前沒有任何場次在用（純資料庫存貨）；有新場次用到時，正常查證流程會自然覆蓋到，不用主動處理。
- SUB LIVE 底下至少一個主辦方用英文地址，城市判斷邏輯只認中文城市名稱，這場 `city` 會落成「未知」（2026-09-21 觀察到的單一案例，這次（9/25）查 city:未知 清單時沒再看到這個案例，可能已經自然解決，也可能只是巧合沒抓到，不確定）。

**2026-09-25 city:未知 清單追查結果（原本 12 筆降到 5 筆，剩下的都是真的該顯示未知）**：
- ~~KKTIX 場地欄位只有地址、沒有場地名稱時，城市判斷會完全失效~~ ✅ 已修好。`parseKktixVenue` 沒有 "/" 分隔符時整串地址會被誤判成場地名稱，`cityFromAddress` 因此收到空字串（真實案例：TECHNO BUS，地址明明寫著「台中市」）。改成 addressPart 找不到城市時，再把 venuePart 本身當地址試一次。
- ~~X-Formosa 彩虹音樂節的場地欄位抓到網頁分頁標籤文字~~ ✅ 已修好。iNDIEVOX 的 `parseVenueLine` 標籤比對太寬鬆，頁面自己的分頁導覽列「場地交通住宿｜活動時程｜表演者｜注意事項」裡「場地」後面接的「交通住宿」被當成標籤填充字，後面整串分頁名稱被誤判成場地內容。排除這一個已確認的假陽性複合詞（不是通用規則——類似的「票價資訊 Ticket Price：」這種合法標籤後面也會接更多中文字，沒辦法用「後面不能接中文字」這種通用規則解決，只能排除已知案例）。套用新邏輯後這個頁面真的沒有可解析的場地資訊，改用標題比對 `venues.yml`（原本 9/21 就有「X-Formosa」這筆，但因為 venue_raw 非空所以從沒機會觸發），現在正確顯示新北。
- ~~漁光島（TINY ISLAND 小島沙灘派對）、金滿山露營山莊（奇蹟 MIRACLE FESTIVAL）沒收錄進 venues.yml~~ ✅ WebSearch 查證後補上（台南、苗栗）。
- 剩下 5 筆城市未知都是真的該顯示未知，沒有勉強塞資料：兩場邱冠瑜線上音樂會（線上活動，沒有實體地點）、蕭景鴻多場地巡演合併售票頁、囪擊音樂祭的總覽頁（已正確拆出的 3 個確切日期場次都有 city:台南，這筆是額外的總覽/父頁面）、MOB PARTY 26（辦在泰國清邁，OUTSIDE_TAIWAN_VENUE_RE 目前沒有涵蓋泰國，但只有這一筆觀察案例，還沒決定要不要加）。

**需要持續維護、不是一次性任務**：
- `NOISE_KEYWORDS`（非音樂雜訊過濾；**2026-11-17 起清單本體在 `data/noise.yml`**，連同古典／見面會關鍵字、手動排除網址、排除的 KKTIX 帳號，`normalize.mjs` 只剩判斷邏輯）跟 `OUTSIDE_TAIWAN_VENUE_RE`（海外場次地理過濾）都是「看到新的就加」的清單，KKTIX 掃描範圍每次擴大都可能冒出新的漏網案例，這是預期中的常態工作，不是缺陷。**2026-09-25 又一次證明這句話**：查 city:未知 清單時發現麥花臣場館、亞洲國際博覽館（AsiaWorld-Expo）兩個香港場地從來沒被真的加進規則裡（只在程式碼註解裡提過），兩場香港秀因此真的顯示在正式網站上，不是卡在待整理；已經補上規則，並清掉包含一場規則早就涵蓋、但因為是舊資料從沒被重新檢查過的 AXA WONDERLAND 香港場（同一種「增量抓取不會回頭檢查舊資料」的坑，這個 session 已經是第 N 次踩到），共移除 3 場。

## 這是什麼專案

個人用的獨立/地下音樂演出雷達。**完整需求**看 [`LIVERADAR-SRS.md`](./LIVERADAR-SRS.md)，**技術架構與所有踩過的坑**看 [`LIVERADAR-SPEC.md`](./LIVERADAR-SPEC.md)——這兩份是唯一該信任的來源，這份 HANDOFF 只是導覽，內容有衝突以那兩份為準。

## 里程碑總覽（歷史記錄——現況以上面「現在的狀態」為準）

**M9 已經過時**：Gist 同步後來整個被 Supabase 帳號登入取代（見下方「Supabase 帳號登入上線」），下面這列描述的機制已經不存在，保留只是留紀錄。

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
| M9 | ~~Gist 同步~~（連接/斷開/雙向同步/離線 fallback）＋ FR-63/64 匯出匯入、設定頁的嚴格模式與靜音關鍵字順便一起接上 | 🗑️ 已被 Supabase 帳號登入取代，見「Supabase 帳號登入上線」章節 |
| M10 | 來源異常告警（GitHub issue）、設定頁來源狀態儀表、時間表異常 banner | ✅（真的開 issue 那段沒有跑過真實 CI，見下方說明） |
| M11 | GitHub Actions 排程上線 | ✅ 當時排程已重新打開；後來（9/21）確認拓元/Ticket Plus 會被 GitHub Actions 的 IP 擋掉，排程改到上班電腦的 Claude 排程任務，GitHub Actions 排程本身已經不再使用 |
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

`npm run fetch` 會打五個平台的真實網站。2026-09-24 優化前一輪約 30 分鐘，優化後預估 10~15 分鐘（實測數字見文件尾端 9/24 章節）。**一天只跑一次**，改了抓取程式要驗證用 `npm run fetch-one`，補完藝人用 `npm run renormalize`，跑完覆寫 `data/*.json`。`data/artists.yml` 已經有 400 多筆真實藝人；辨識不到藝人的場次一樣會上架（D15 reversal），只是會列進 `data/needs-review.json` 等待查證補登記。（2026-09-23 更正：這裡原本寫「`artists.yml` 只有兩筆示範資料，fetch 完 `events.json` 一定是空的」，那是專案最早期的狀況，早就不成立了。）

**上班電腦**（`/Users/megamount/Documents/personal/liveradar`）有 Claude 排程任務 `liveradar-daily-fetch`，每天約上午 10:00 自動 `git pull` → `npm ci` → `node scripts/fetch.mjs` → `npm test` → 測試通過才 commit + push。那台的環境（相依套件、Chromium）都已經裝好，也實際跑過。要手動多跑一次的話，直接 `npm run fetch` 就好。

## 開發時踩過、別再踩一次的坑

1. **絕對不要在一個 `export async function fetch()` 的檔案裡呼叫裸的 `fetch(...)`**——會遮蔽全域 Fetch API，變成無窮遞迴呼叫自己（花了很久才抓出來）。一律用 `globalThis.fetch(...)`。見 `scripts/adapters/kktix.mjs` 開頭的註解。
2. **拓元 tixcraft 的活動詳情頁抓不到**——有 JS 反爬蟲挑戰，一般 fetch 會被擋（`{"response":"identify"}`）。目前拓元 adapter 只抓列表頁（標題/日期/場館，沒有價格）。這是刻意的取捨（見 SPEC D16），不是沒做完。
3. **本機測試用瀏覽器開發時，如果改了 `.js` 檔案但畫面沒反應**，通常是瀏覽器快取住舊的 module 檔案，換個 port（例如 `python3 -m http.server 8001`）重開就會抓到新的，比硬重整可靠。
4. **背景執行長時間指令時，Node 的 `console.log` 在 stdout 被導向檔案時是全緩衝的**，不會即時寫入，會看起來像卡住。要看即時進度得用 `fs.appendFileSync` 寫檔（`scripts/progress-log.mjs` 已經這樣做了，看 `fetch-progress.log`，這個檔案不會進 git）。
5. **前端 `fetch("./data/events.json")` 一定要加 `{ cache: "no-store" }`**——不加的話瀏覽器分頁開著、或同一個 session 內重複導覽，會一直吃到舊的快取版本，即使檔案內容已經在磁碟上更新了。M7 測「手動新增場次被真實抓到後應該消失」時就是被這個絆住，才發現這個問題，已經修在 `src/app.js` 的 `loadEvents()`。
6. **日期比較不要用 `new Date(dateStr) > new Date()`**——`new Date("2026-10-15")` 會被當成 UTC 午夜，跟本地/台灣時間的「現在」比較時，同一天的場次在某些時段會被誤判成「已過期」。`scripts/normalize.mjs` 的 `statusFromTickets` 和 `src/filter.js` 的 `isPast()` 都踩過這個坑，兩處都已經改成用日期字串（`YYYY-MM-DD`）直接比較，不要再改回 Date 物件比較。
7. **`normalize()`（或任何 per-item 的 pipeline 處理函式）處理陣列時一定要包 try/catch**——單一筆原始資料格式異常就丟例外的話，會讓整個 pipeline run 中斷，當天完全不會更新，而不是只把那一筆丟進待整理。`scripts/fetch.mjs` 已經修好，之後新增 per-item 處理邏輯要延續這個模式。
8. **`npm run fetch` 跑完之後，只要 `data/needs-review.json` 非空，不要等 Max 發現才處理**——主動逐筆開真實頁面查證（能開票券頁就開票券頁，查不到細節再用 WebSearch），能查到身分就直接補進 `data/artists.yml`（含來源地、真正查到的判斷依據寫進註解），查不到才留著誠實記錄不要用標題猜。這是 2026-09-23 Max 明確要求的標準流程（"能不能把整個待整理清單自動批次用 WebSearch 查完，不用等我手動發現才處理"），不是選擇性的加分項——任何一個 session（包含上班電腦那個 `liveradar-daily-fetch` 排程任務）跑完 fetch 後都要照做。
9. **改了抓取程式，不要用整套 `npm run fetch` 驗證**——用 `npm run fetch-one -- <活動網址> [<活動網址> ...]`，挑幾場這次修改應該會影響的真實場次（售完的、新版型的、被回報漏抓的），幾秒鐘就能看到會存成什麼、跟現有 `events.json` 差在哪，不會寫入任何檔案。整套抓取要 25~30 分鐘、發幾百個請求，2026-09-23~24 兩天因為「改一點就整套重跑確認」跑了約 14 輪，佔掉 Max 大量等待時間，反覆重跑也很可能是 register_info 被 Cloudflare 403 暴增的原因之一。一天只該有排程那一次完整抓取；補完藝人用 `npm run renormalize`（不發網路請求）。目前 `fetch-one` 只支援 KKTIX。
10. **同一時間只能有一個抓取在跑**（2026-09-24 起有鎖定檔保護）：`npm run fetch` 跟 `npm run renormalize` 開始時會建 `.fetch.lock`，另一個啟動時如果發現有人在跑，會印出是誰、跑多久了，然後以結束碼 2 停止，不會兩邊同時改 `data/*.json`。9/23 兩個 session 加排程在同一個資料夾同時跑，差點把改動弄丟，也讓請求量翻倍。前一個程序被強制中止留下的鎖定檔會自動接手，不用手動刪。**注意這只保護抓取，不保護程式碼**：兩個 session 同時改同一個 git 工作目錄還是會互相覆蓋，開新 session 前先確認另一個已經收尾（`git status` 乾淨）。
11. **查證藝人身分要防撞名，不能用名字判斷國籍**（2026-09-24）：搜尋結果要跟票券頁對照（主辦、類型、巡演名、頁面自己寫的出身、同場演出者），至少一項對得上才能寫進 artists.yml，註解寫出對照了什麼、在哪查到。過去查錯的四種模式：從名字猜（W!nky；琉璃花 9/23 因「RURIKA 是日文讀音」被標成日本，其實是台灣日系地下偶像）、把演出地點當國籍（JUST YOU & WIN 辦在大阪但是泰國演員）、把巡演企劃名當藝人（Yoshinani）、撞名（搜到同名的另一個人）。排程指令已同步寫入這條規則。
12. **來源地看「在哪個音樂圈成名、被認識的」**（2026-09-24 Max 定的規則）：不是國籍，也不是現在住哪或演出地；成名後才移居的仍算原本成名的地方；查不出在哪成名才退回用國籍。案例：蔡健雅（新加坡籍）、巫啟賢（馬來西亞籍）在台灣成名 → 本地；韓東（中國籍，Dreamcatcher 成員）在 K-pop 圈成名 → 韓國；ONE OK ROCK 後來長年在歐美發展，仍是日本。排程指令已同步。
13. **派對、音樂節一律判定本地**（2026-09-24 Max 定的規則）：多位音樂人參與，無法用單一藝人判斷，直接登記品牌名為本地（例：SLUTs 派對）。排程指令已同步。
14. **非音樂人的見面會、夜店派對都要收錄**（2026-09-24 Max 決定）：多少跟音樂或偶像有關，不要加進 NOISE_KEYWORDS 排除。見面會照常查主角在哪成名；夜店派對登記品牌名為本地。排程指令已同步。

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
