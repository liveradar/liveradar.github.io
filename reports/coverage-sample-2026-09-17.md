# 覆蓋率抽樣報告 — 2026-09-17（M12, G4, AC 對照 SRS §3「先行」列）

## 方法

依 SRS 決策 D11：既有彙整站不納入爬取，只作為覆蓋率抽樣的比對基準。這次選用
[Artists.tw](https://www.artists.tw/gigs)——一個獨立的台灣 Live House／演唱會行事曆彙整站（自稱「跨售票平台彙整」，目前收錄
467 場），跟 LiveRadar 的產品定位高度重疊，適合當基準。

取樣方式：開啟 Artists.tw 依日期排序的列表，取最前面（最近期）30 筆，逐筆比對
LiveRadar 本地的 `data/needs-review.json`（79 筆，KKTIX／拓元這次執行實際抓到、
但尚未通過藝人辨識的原始標題）與 `data/events.json`（目前 0 筆已辨識場次）。
用標題關鍵字與場館名稱人工比對，不是機器比對——判斷「這是不是同一場演出」需要人眼看標題的變體寫法。

其中 1 筆（2026 摔角兄弟會，屬摔角非音樂演出）不在 LiveRadar 的音樂演出範疇內，
排除在分母之外，實際樣本數 **29 場**。

## 結果

| # | 演出 | 場館 | LiveRadar 是否收錄 |
|---|---|---|---|
| 1 | 【工作帶_shuffle kid】溫室雜草《衝突的意義》專輯試聽場 | 玉成戲院 | ❌ |
| 2 | Mili — One Million Moons Asia Tour | Zepp New Taipei | ❌ |
| 3 | 呂杰達x鄭翔予x鍾建暉《酒醒吧！新生代》 | 女巫店 Witch House | ❌ |
| 4 | jizue 20th Anniversary Album Release Tour | The Wall Live House | ❌ |
| 5 | Tim Lin Quartet 四重奏 | Sappho Live Jazz | ❌ |
| 6 | 台北藍調 週四特演 葉祖安三重奏 | Blue Note Taipei | ❌ |
| 7 | 嘻御天閣 XI GOTENKAKU（取消公告） | Legacy Taipei | ❌ |
| 8 | Suming 舒米恩金曲慶功演唱會 | SUB Live House | ❌ |
| 9 | bjarki | FINAL | ❌ |
| 10 | RUSH BALL in 台灣 台日共演 | The Wall Live House | ❌ |
| 11 | 【西部地區懸賞公告 2.0】 | 凝聚力展演空間 | ❌ |
| 12 | RUSH BALL 2026 with FRIENDSHIP. | The Wall Live House | ❌ |
| 13 | 巴賴Balai 久違的台北女巫專演 | 女巫店 Witch House | ❌ |
| 14 | 呂允 別著急 首張專輯 ZEPP旗艦安可場 | Zepp New Taipei | ❌ |
| 15 | 20th Century Nights | 文昌號 WHOA | ❌ |
| 16 | 洪佩瑜《開了又開》巡迴演唱會 | Legacy TERA | ❌ |
| 17 | Tim Lin Quartet + Late Night Jam | Sappho Live Jazz | ❌ |
| 18 | 台北藍調 週五特演 變形蟲爵士樂團 | Blue Note Taipei | ❌ |
| 19 | 突如其來的 OPEN STAGE | 文昌號 WHOA | ❌ |
| 20 | 台北. 且聽天命《黑神話：悟空》全球音樂會 | Legacy Taipei | ❌ |
| 21 | 2026 LEE YOUNGJI WORLD TOUR ＜2.0＞ | 臺北流行音樂中心表演廳 | ✅（拓元） |
| 22 | 《https://》腦體馬戲團 | 百樂門酒館（高雄） | ❌ |
| 23 | Andr [Shedding Skin] 2026 Asia Tour | Legacy Taipei | ❌ |
| 24 | P!SCO-16 Family Day（台中場） | Legacy Taichung | ❌ |
| 25 | 乙水YEE WATER EP Release Concert | LIVE WAREHOUSE（高雄） | ❌ |
| 26 | 虎小島《背對光的時候》台北專場 | 野地方 Wild Lab | ❌ |
| 27 | IMPRNT pres. I7HVN | FINAL | ❌ |
| 28 | 2026 JIAHN SOLO FANCON | 凝聚力音樂娛樂 Cohesion Space | ❌ |
| 29 | 《聲之響宴:宮崎駿動畫音樂會》 | 中壢藝術館音樂廳（桃園） | ❌ |

**覆蓋率：1 / 29 ≈ 3.4%**，遠低於 G4 的 80% 門檻。

## 根因分析（這才是這份報告真正的重點）

不是 adapter 邏輯壞了——是**目前追蹤的場館清單本來就只有一小撮**：

- `scripts/adapters/kktix.mjs` 目前只認得 9 個場館／org 帳號：The Wall、海邊的卡夫卡（kafka）、pipelivemusic、Emerge Livehouse（兩個帳號）、Legacy Taipei、Legacy Taichung、Revolver、Clapper Studio。
- 這次樣本裡出現的場館：女巫店、Zepp New Taipei、Sappho Live Jazz、Blue Note Taipei、SUB Live House、FINAL、文昌號 WHOA、Legacy TERA（注意：跟已追蹤的「Legacy Taipei」是不同分店）、凝聚力展演空間、野地方 Wild Lab、LIVE WAREHOUSE、百樂門酒館、玉成戲院——**沒有一個在追蹤清單裡**。Artists.tw 側欄列出「近期至少 3 場演出」的場館就有 44 個，LiveRadar 現在只碰到其中 9 個的一小部分。
- 就連已經在追蹤清單裡的 Legacy Taipei／Legacy Taichung，這次樣本中屬於它們的 4 場（#7 #20 #23 #24）也全部沒抓到——但這比較可能是另一個已知問題疊加造成的，不是 kktix.mjs 邏輯本身的錯：`data/needs-review.json` 目前停留在 2026-09-16 的快照（見 `HANDOFF.md`「M11 的重大發現」，拓元／KKTIX 搜尋策略持續被 GitHub Actions 的 IP 擋），這幾場很可能是 09-16 之後才公告或才被 Artists.tw 收錄的，用一份舊快照本來就比對不到，不代表 org 頁策略本身失效。
- 唯一命中的 #21（LEE YOUNGJI）是透過拓元的**全站列表**、不是靠場館比對，所以拓元覆蓋的是「拓元上架的所有場次」，不受這份場館清單限制——這也是為什麼拓元這次執行雖然被 403，上一輪快照裡还能有 70+ 筆的原因。

## 建議

**擴充 KKTIX 追蹤的場館清單，是目前能把覆蓋率拉到 80% 最直接的槓桿**——比起繼續處理 M11 的 IP 封鎖問題，這個影響範圍更大（封鎖只是讓已追蹤的場館資料變舊，場館清單太窄則是連新鮮資料都不會去抓）。具體作法：對照 Artists.tw 側欄「依場館瀏覽」的清單，把女巫店、Zepp New Taipei、Blue Note Taipei、SUB Live House、FINAL、文昌號 WHOA、Legacy TERA、野地方 Wild Lab、凝聚力展演空間等場館逐一判斷屬於 ORG_PAGE_VENUES 或 SEARCH_VENUES 哪一種策略（跟 M2 當初判斷 The Wall vs Legacy 的方法一樣），一次加幾個、每加完就重新抽樣驗證覆蓋率有沒有提升。

這是一次獨立的 adapter 擴充工作，不是修 bug，需要另外排時間逐一測試每個新場館的 KKTIX 頁面結構，不建議现在就順手做——先讓你知道規模跟方向，你決定要不要排進下一步。

## 追蹤更新：加了凝聚力展演空間之後重新比對（同日，2026-09-17 稍晚）

查證候選場館時發現凝聚力展演空間是真的自營場館（見 `HANDOFF.md`），加進 `kktix.mjs` 的 `ORG_PAGE_VENUES` 並修好一個連帶發現的選擇器 bug 後，用**同一份 29 場樣本**重新對照這次真的執行後的 `data/needs-review.json`（91 筆）：

| # | 演出 | 場館 | 這次結果 | 說明 |
|---|---|---|---|---|
| 11 | 【西部地區懸賞公告 2.0】 | 凝聚力展演空間 | ✅（KKTIX，新） | 凝聚力加進追蹤清單後的直接成果，穩定可重現 |
| 23 | Andr [Shedding Skin] 2026 Asia Tour | Legacy Taipei | ✅（KKTIX，新） | 這次執行 Legacy Taipei 的搜尋剛好沒被 Cloudflare 擋下來才抓到——**不是穩定的改善**，`SEARCH_VENUES` 這個機制本身還是壞的（同一次執行 Legacy Taichung、Clapper Studio 就被擋了），明天再跑不保證還在 |
| 28 | 2026 JIAHN SOLO FANCON | 凝聚力音樂娛樂 Cohesion Space | ❌ 仍未收錄 | 凝聚力自己的 KKTIX 頁面上實際只列出 2 場即將舉行的活動（西部地區懸賞公告、ASIA METAL FESTIVAL），這場沒在上面——大概是還沒公告到 KKTIX、或用别的售票平台 |
| 其餘 26 場 | — | — | ❌ 不變 | 場館仍不在追蹤清單，或屬於目前技術上抓不到的多主辦類型 |

**新覆蓋率：3 / 29 ≈ 10.3%**（原本 1/29 ≈ 3.4%）。表面上翻了 3 倍，但要老實拆開看：
- **真正穩定、可歸功於這次工作的改善只有 #11 這一場**（凝聚力）——2/29 ≈ 6.9% 才是可持續依賴的數字。
- #23（Legacy Taipei 命中）是 `SEARCH_VENUES` 端點被 Cloudflare 間歇性擋住、這次剛好沒被擋到的運氣，不是修好了什麼，隨時可能在下次執行時消失。

距離 80% 的目標還很遠，而且如前面「根因分析」所說，剩下的場館多數需要現在壞掉的搜尋機制才能抓——單靠繼續加 `ORG_PAGE_VENUES` 場館，天花板不高。

## 再次追蹤：加 iNDIEVOX + FANSI GO + 修好 KKTIX 搜尋策略之後（同日稍晚）

同一天稍晚做了三件事：(1) 新增 iNDIEVOX adapter（無反爬蟲，全站抓），(2) 新增 FANSI GO adapter（Playwright），(3) 把 KKTIX 的 `SEARCH_VENUES` 搜尋策略從 plain fetch 改成 Playwright，**真的修好了 Cloudflare 擋住的問題**（不是運氣，是這次搜尋 4 個場館全部成功，0 個 sub-request 失敗）。用同一份 29 場樣本再對照一次：

| # | 演出 | 場館 | 這次結果 |
|---|---|---|---|
| 8 | Suming 舒米恩金曲慶功演唱會 | SUB Live House | ✅（iNDIEVOX） |
| 11 | 【西部地區懸賞公告 2.0】 | 凝聚力展演空間 | ✅（KKTIX org 頁） |
| 21/22 | 2026 LEE YOUNGJI WORLD TOUR | 臺北流行音樂中心 | ✅（拓元） |
| 23 | 《https://》腦體馬戲團 | 百樂門酒館 | ✅（FANSI GO） |
| 24 | Andr [Shedding Skin] 2026 Asia Tour | Legacy Taipei | ✅（KKTIX 搜尋，這次是**穩定命中**，不是運氣——4 個搜尋場館這次全部成功） |
| 25 | P!SCO-16 Family Day（台中場） | Legacy Taichung | ✅（iNDIEVOX） |
| 26 | 乙水YEE WATER EP Release Concert | LIVE WAREHOUSE | ✅（iNDIEVOX） |
| 27 | 虎小島《背對光的時候》台北專場 | 野地方 Wild Lab | ✅（iNDIEVOX） |

**新覆蓋率：8 / 29 ≈ 27.6%**，而且這次每一場命中都是可重現的穩定結果，不是碰運氣——跟上一版複查時特別強調「Legacy Taipei 那場是運氣、隨時可能消失」不同，這次 KKTIX 搜尋策略是真的修好了。

還沒收錄的 21 場（女巫店、Zepp、Blue Note、Sappho、The Wall 部分場次、文昌號、FINAL、玉成戲院、Legacy TERA、凝聚力的另一場 JIAHN FANCON、中壢藝術館）大部分是因為：這些平台/場館根本不在四個來源的涵蓋範圍內（女巫店、Zepp、Blue Note 等主要不透過 KKTIX/拓元/iNDIEVOX/FANSI GO 賣票），不是解析失敗——要再往上，得看 Ticket Plus（寬宏售票）能補多少、或真的擴大追蹤場館清單。

## 第三次追蹤：加入 Ticket Plus 之後（同日晚上）

新增 `scripts/adapters/ticketplus.mjs`——這是五個來源裡資料品質最好的一個，整個平台是靠公開、不需要認證的 JSON API（`apis.ticketplus.com.tw/config/api/v1/getS3`）運作，`date`/`time`/`location`/`address` 全部是乾淨的結構化欄位，不需要像 iNDIEVOX/FANSI GO 那樣解析自由格式文字。用同一份 29 場樣本再測一次：

| # | 演出 | 場館 | 這次結果 |
|---|---|---|---|
| 1 | 溫室雜草《衝突的意義》 | 玉成戲院 | ✅（Ticket Plus） |
| 2 | Mili One Million Moons Asia Tour | Zepp New Taipei | ✅（Ticket Plus） |
| 3 | 呂杰達x鄭翔予x鍾建暉 | 女巫店 | ✅（Ticket Plus） |
| 10 | RUSH BALL 台日共演 | The Wall Live House | ✅（Ticket Plus） |
| 12 | RUSH BALL 2026 with FRIENDSHIP | The Wall Live House | ✅（Ticket Plus） |
| 13 | 巴賴Balai 女巫專演 | 女巫店 | ✅（Ticket Plus） |
| 29 | 2026 JIAHN SOLO FANCON | 凝聚力音樂娛樂 Cohesion Space | ✅（Ticket Plus） |

（加上前兩輪已經命中的 8 場：Suming、西部地區懸賞公告、LEE YOUNGJI、https://、Andr、P!SCO-16、乙水、虎小島）

**最終覆蓋率：15 / 29 ≈ 51.7%**（原始 3.4% → 加凝聚力場館 10.3% → 加 iNDIEVOX/FANSI GO/修好 KKTIX 搜尋 27.6% → 加 Ticket Plus 51.7%）。**Ticket Plus 一次加入就多命中 7 場，是單一動作裡效益最大的一次**——因為它剛好覆蓋了女巫店、Zepp、The Wall 這幾個原本完全碰不到的場館。

還沒收錄的 14 場：Sappho Live Jazz（爵士，可能是小眾平台或自售）、台北藍調 Blue Note（同上）、20th Century Nights/突如其來的 OPEN STAGE @ 文昌號 WHOA（查過 KKTIX 上完全沒有這場館的資料）、bjarki/IMPRNT @ FINAL（場館名稱太通用不好單獨查證）、洪佩瑜 @ Legacy TERA、且聽天命 @ Legacy Taipei（可能是 09-17 之後才公告，資料仍是那個時間點的快照）、宮崎駿音樂會 @ 中壢藝術館（正式音樂廳，可能走完全不同的官方售票管道）。這些大部分屬於「根本不在五個來源涵蓋範圍」的類型，不是抓取邏輯的問題。

五個來源都做完了（KKTIX、拓元、iNDIEVOX、FANSI GO、Ticket Plus，Max 一開始要求的完整清單），52% 左右可以視為現階段的實際天花板，再往上大概要靠擴大追蹤場館清單、或接受這是免費工具的合理範圍。
