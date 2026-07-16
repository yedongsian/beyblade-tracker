# Beyblade Tracker 專案記憶與交接文件

> 更新日期：2026-07-16（Asia/Taipei）
> 專案階段：第一版 MVP 已可運行；Roadmap Phase 0、Phase 1、Phase 2 已完成實作
> 專案位置：`C:\Users\yedon\OneDrive\桌面\Beyblade`

## 1. 這份文件的用途

這是跨 Codex／Claude 對話使用的專案記憶檔。開啟新對話時，先請協作者完整閱讀：

1. `PROJECT_MEMORY.md`（本文件）
2. `ROADMAP.md`（尚未確認的未來規劃）
3. `README.md`（目前版本的操作方式）
4. `TODO.md`（已完成與既有技術債）

除非使用者明確確認 Roadmap 的範圍，否則不要直接開始大規模改造。先核對目前程式、資料庫與
服務狀態，保留使用者既有資料與設定。

### 2026-07-16 完成基線（後續協作者必讀）

以下工作已完成，**不要重新設計、重建或從 Phase 0 開始**：

- Phase 0：migration、備份／還原、執行資料分離、異常復原、設定驗證、Connector 契約測試及 Demo 歸檔。
- Phase 1：首次導覽、來源網址安全預覽、Site／SeedUrl 去重、確認加入、測試、停用／重新啟用及手機／無障礙 UI。
- Phase 2：同 Site 受控探索、robots／Sitemap／公開搜尋／有限連結、持久化 Crawl Frontier、每站安全預算、Recipe、Review Queue 與核准後正式監控。
- Git 初始完成基準：`689c181f94076a6146e1e1409e1c978dd6d6067b`（`feat: complete phase 0 and phase 1`）。
- 正式資料庫已升級至 schema version 3，保留 3 個真實來源與既有 UX-20 歷史；完整性檢查通過且沒有 orphan foreign key。
- 驗收結果：62/62 項 Node 測試、7/7 條 Web 路由煙霧測試均通過，真實 Yodobashi 預覽及來源測試成功。
- Local Web App 位於 `http://127.0.0.1:8787`，完成時 `/health` 回傳 `ok`。

Phase 2 程式已完成，離線 Takara Tomy Mall 驗收 fixture、73 項 Node 測試與 8 條 Web 路由煙霧
測試均通過。正式背景服務仍是本輪修改前啟動的程序，尚未套用 schema version 4；依使用者決定，
下一次共同重啟後再做正式 DB migration 與 Takara Tomy Mall 實站驗收。除非出現可重現的回歸問題
或使用者明確要求，後續工作不得重做 Phase 0、Phase 1 或 Phase 2。

## 2. 產品願景

目標是製作一個一般人也能使用的 Beyblade 商品與情報追蹤 App：

- 使用者預設沒有寫程式經驗，操作必須簡單、直覺、有清楚的錯誤指引。
- 可加入許多商店來源，從使用者提供的任一商店頁面辨識主網域並尋找 Beyblade 商品。
- 主要支援日文、英文與台灣繁體中文的商店與介面。
- 已發現商品要持續更新價格與可購買狀態，不能把過期現貨永久留在清單中。
- 整合官方新品資訊，並允許使用者用商品編號、型號或關鍵字建立期待清單。
- 整合公開論壇／社群消息，協助使用者較早取得新品與補貨線索。
- 不自動購買、不繞過 CAPTCHA／登入／付費牆，也不違反網站的存取限制。

## 3. 目前已完成的版本

### 執行環境

- Node.js 22 以上；目前在 Node.js 25 驗證。
- SQLite 使用 Node 內建 `node:sqlite`。
- HTML 解析使用 `cheerio`。
- 必須以瀏覽器讀取的公開頁面使用 `playwright-core` 搭配已安裝的 Google Chrome。
- 目前快速服務控制是 Windows 專用。

### 目前資料流程

```text
設定檔中的商品頁
  → HTTP 或 Chrome Connector
  → JSON-LD／CSS selector 解析
  → 標準化商品、型號、價格與庫存
  → 合併 Product 與各商店 Offer
  → SQLite 保存觀測與事件
  → 彙整通知
  → Console／可選 Telegram／Discord
  → 可操作 Local Web App
```

### 已有能力

- 依各來源自己的週期持續掃描。
- 擷取商品名稱、型號、品牌、價格、幣別、庫存訊號、圖片與網址。
- 辨識 `coming_soon`、`preorder`、`in_stock`、`out_of_stock`、`unknown` 等狀態。
- 支援部分日文缺貨文字，例如「販売休止中」「予約終了」「再入荷予定なし」。
- 用型號／SKU／條碼等可解釋規則合併跨商店商品；不確定時不強行合併。
- 保存來源、商品、Offer、觀測紀錄、事件、通知與抓取紀錄。
- 只有狀態轉換或重要資料變化才建立事件，並有冷卻與通知去重。
- 單一來源失敗不會中止其他來源。
- Console 通知永遠可用；Telegram Bot 與 Discord Webhook 為選用。
- Local Web App：`http://127.0.0.1:8787`，可預覽、加入、測試、停用及重新啟用來源。
- 來源首頁／分類頁可啟動受控探索；候選先進 `/review`，核准後才建立 Product／Offer 與監控網址。
- `/health` 提供服務與來源健康資訊。
- 62 項 Node 自動化測試已通過，另有 7 條 Web 路由煙霧測試。
- Phase 2 完成後為 73 項 Node 自動化測試與 8 條 Web 路由煙霧測試。

### Phase 0 已完成（2026-07-16）

- SQLite schema version 目前為 3；`src/db/migrations/` 由 migration runner 依序升級並記錄校驗碼。
- 正式 DB 啟動前預設每 24 小時建立一致性自動備份，保留 30 天且最多 30 份。
- `npm run db:backup` 可立即備份；`npm run db:restore` 會驗證完整性、拒絕覆蓋運行中的服務，
  並可還原到另一個測試資料夾。
- `data/` 只保留可移交正式資料；PID／status／stop／debug 位於 `runtime/`，日誌位於 `logs/`。
- 啟動時會把上次異常終止留下的 `running` crawl run 標為失敗並保存繁中原因。
- `npm run config:check` 正式驗證環境數值、來源欄位、HTTP(S) 網址及 Connector 必要設定。
- Connector 與 Recipe 有版本欄位；Fixture／JSON-LD／Browser 已有契約與固定樣本測試。
- 歷史 `manual-demo.db` 與正式 DB 中可明確識別的 Demo 資料已移至 `archive/demo/`；
  清理前完整快照已保留。

### Phase 1 已完成（2026-07-16）

- 首次啟動導覽保存語言、通知、掃描頻率與資料保存偏好；尚未完成時會自動顯示。
- `/sources` 提供貼網址、單頁安全預覽、候選商品、錯誤、資源預算與確認加入。
- URL 身份去重會移除 tracking、統一 HTTPS／`www`；實際連線仍保留網站需要的主機名稱。
- `Site` 以 registrable domain 去重，`SeedUrl` 保存使用者提供的頁面；設定檔與 UI 來源可共存。
- 同一 Site 再貼網址時只加入 SeedUrl；只有使用者確認後才建立新來源並進入 Monitor 排程。
- 來源可測試連線與解析；停用／移除預設只停用並保留商品、Offer、事件及價格歷史。
- 任意網址預覽封鎖本機／內網、逐次驗證 redirect、限制 2 MB 與最長 30 秒，並具 CSRF 防護。
- UI 提供繁中人類化錯誤、鍵盤焦點、skip link、live region、手機版與 reduced-motion 支援。
- 真實 Yodobashi UX-20 預覽與來源測試通過；正確辨識既有 Site、UX-20 與缺貨狀態。

### Phase 2 已完成實作（2026-07-16；正式服務待重啟驗收）

- schema version 4 新增探索設定、網站 Recipe、Discovery Run、Crawl Frontier 與 Product Candidate。
- 分類頁與商品監控網址以 `SeedUrl.purpose` 分流，不會把分類頁誤當商品頁持續建立 Offer。
- 探索只允許同一 registrable domain，重新導向後再次驗證；遵守 robots 並優先 Sitemap、公開搜尋與高相關連結。
- 預設每站最多 100 頁、深度 2、5 分鐘、50 MB、瀏覽器頁面 3、並行上限 2、請求間隔至少 1 秒。
- 網站拒絕、超出預算或既有 Recipe 失效時停止；失效 Recipe 不會由每日排程盲目重試。
- `/review` 顯示候選來源、價格、型號、信心分數及列入原因，支援單筆／批次核准、排除與稍後處理。
- 只有核准候選才會建立或合併 Product／Offer、產生首次事件並加入正式商品監控。
- 每站可在來源管理調整安全預算、探索間隔、網址包含詞／排除詞及必要的 CSS selector Recipe。
- Takara Tomy Mall BEYBLADE X fixture 垂直切片通過；實際網站探索保留到下一次重啟後進行。
- 修改前已建立正式 DB 備份：`backups/manual-20260716-032419Z.db`，完整性 `ok`、schema version 3。
- 該正式備份的隔離副本已成功 migration 至 schema version 4；完整性 `ok`、0 個 foreign key orphan，且 1 Product／3 Offers／1 Event 均保留。

### 目前正式來源

| 來源 | Connector | 檢查週期 | 目前範圍 |
|---|---|---:|---|
| Yodobashi | HTTP／JSON-LD／CSS | 15 分鐘 | 一個 UX-20 商品頁 |
| しまむら Birthday | 螢幕外 Chrome／CSS | 30 分鐘 | 一個 UX-20 商品頁 |
| HobbyLink Japan | HTTP／JSON-LD | 15 分鐘 | 一個 UX-20 商品頁 |

注意：目前是監控三個已知商品頁，不是搜尋三家商店的所有 Beyblade 新品。

### Windows 快速控制

- `start_tracker.cmd`：背景啟動排程器與管理頁，防止重複啟動。
- `restart_tracker.cmd`：安全停止目前服務後重新啟動。
- `stop_tracker.cmd`：只停止本專案，不會終止其他 Node.js 程式。
- `status_tracker.cmd`：顯示 PID、最後掃描、下次掃描與日誌位置。
- 日誌：`logs\tracker.log`
- 資料庫：`data\tracker.db`
- 執行狀態：`runtime\tracker.pid`、`runtime\tracker-status.json`、`runtime\stop.request`

## 4. 已驗證的實際商店結果

在 2026-07-15 測試時，三個頁面均成功解析，但都不可購買：

- Yodobashi：¥2,450，販売休止中。
- しまむら：未稅 ¥2,200／含稅 ¥2,420，在庫なし／再入荷予定なし。
- HLJ：¥2,455，`Discontinued`。

しまむら會拒絕一般 HTTP，而且 headless Chrome 無法穩定完成，因此目前使用移到螢幕外的
一般 Chrome 視窗讀取公開頁面。不使用使用者登入狀態，也不處理 CAPTCHA。

## 5. 目前尚未具備

- 尚未提供 Recipe selector 的一般使用者進階編輯介面。
- 不會從任一商品頁自動搜尋整個主網站。
- 不會自動發現全新的商品網址或官方公告。
- 沒有完整的介面國際化與多語解析字典管理。
- 沒有 Watchlist／預期商品功能。
- 沒有論壇、RSS、社群或官方情報彙整。
- 沒有安裝程式、自動更新、跨裝置同步或多使用者帳號。
- 不會自動購買、登入商店、操作購物車或繞過反自動化措施。

## 6. 移交到其他裝置

目前最容易移交到另一台 Windows 電腦。新電腦需要 Node.js 22+、Google Chrome 與網路。

建議流程：

1. 在舊電腦先執行 `stop_tracker.cmd`。
2. 複製整個專案；可排除 `node_modules`、`logs` 與 `runtime`。
3. 若要保留歷史資料，保留正常關閉後的 `data\tracker.db`。
4. 不要複製 `runtime`；新電腦會自行建立 PID、status 與 stop 檔。
5. 在新電腦執行 `npm.cmd install` 與 `npm.cmd test`。
6. 執行 `start_tracker.cmd`，再檢查管理頁與 `/health`。

`.env` 可能含 Telegram／Discord 憑證，必須以安全方式移交。不要讓兩台電腦透過 OneDrive
同時執行同一份 SQLite 資料庫；這會有同步衝突、資料損壞或重複通知風險。

## 7. 重要設計原則與限制

- 「無限擴充商店」代表產品層不設定固定筆數上限，不代表可以無限制地抓取網站。
- 每個網站都必須設定同網域限制、頁數／深度／時間預算、合理頻率與停止條件。
- 新增網址時要先正規化成商店／主網域；同一商店已有紀錄時，提示並帶使用者前往既有來源。
- 商品發現與商品狀態監控必須分開排程：發現可以較慢，庫存監控可以依關注度較快。
- 所有清單都要顯示「最後檢查時間」；過期、失敗或長期未確認的結果不能看起來像即時現貨。
- 自動判斷要有信心分數與人工確認入口，避免把非 Beyblade 商品或討論誤列為商品。
- 優先使用官方 API、RSS、Sitemap、JSON-LD；一般 HTTP 次之；瀏覽器是成本較高的最後手段。
- 遵守 robots、服務條款、存取限制及個別網站合理頻率；不繞過 CAPTCHA 或登入。
- 設定、資料庫、日誌與密鑰必須分離；備份與升級要有資料庫 migration。

## 8. 新對話建議開場指令

可在新對話中貼上：

> 請先完整閱讀 `C:\Users\yedon\OneDrive\桌面\Beyblade\PROJECT_MEMORY.md`、
> `ROADMAP.md`、`README.md` 與 `TODO.md`。Phase 0、Phase 1 已完成並驗收，Git 基準為
> `689c181`，Phase 2 工作樹已完成但尚未建立新 commit；不要重做已完成部分。正式服務仍待重啟
> 套用 schema version 4。先確認備份、73 項測試、8 條 Web 路由與服務狀態，再執行 Takara
> Tomy Mall 實站探索及 Review Queue 核准驗收。

## 9. 已確認的未來架構決策

2026-07-15 已由使用者確認：

1. 第一個正式產品採用**個人單機版**，運行於 Windows，不先做多人雲端服務。
2. 新增商店採用**預覽後確認**：使用者貼入網址後，先顯示辨識到的商店、掃描範圍與
   候選結果；只有使用者確認沒問題，才加入正式掃描清單並開始排程。
3. 第一個官方來源已指定為 Takara Tomy Mall 的 BEYBLADE X 分類頁：
   `https://takaratomymall.jp/shop/c/cBeyX/?wovn=english`。其他官方來源之後再補。
4. **通知預設已確認為 Telegram 私人聊天。**App 內事件中心仍保存所有事件，Windows
   本機通知可作為選用輔助；尚未設定 Telegram 時不得丟失事件或反覆顯示錯誤。
5. 第一個社群情報來源已指定為 X 帳號 `@bey_sokuhou`：
   `https://x.com/bey_sokuhou`。此帳號屬非官方社群速報，內容不可直接視為官方公告或庫存事實。

### 通知方案初步結論

- Telegram Bot API 免費，個人私聊建議控制在每秒 1 則以下；對單機個人版已非常充足。
- Discord Webhook 免費且容量足夠，但速率限制依回應動態調整，使用者還需有 Discord
  伺服器與頻道。
- Gmail 個人帳號約每日 500 封，不適合高頻事件，較適合作為每日摘要。
- Windows 本機通知與 App 內紀錄沒有第三方訊息費用，但只能在該電腦上看到。
- 已確認的預設組合是「App 內永久紀錄 + Telegram 私聊推播」，並保留事件彙整與防洗版。
- X 官方 API 目前按量付費；`@bey_sokuhou` 的免費、穩定且符合平台規範的取得方式仍待評估。

## 10. 本次執行狀態

- Roadmap Phase 0、Phase 1 已完成驗收；Phase 2 已完成實作與離線驗收。
- 升級前後商品與事件未遺失；version 0 備份已在另一個測試資料夾成功還原並升級。
- 正式 DB 已清除可明確識別的 Demo 資料，目前只保留三個真實商店與 UX-20 歷史。
- 背景服務已在新版 Local Web App 下啟動，`/health` 回傳 `ok`。
- 正式背景服務尚未重啟，因此正式 DB 目前仍為 schema version 3；新版啟動時才會 migration 至 4。
- 下一次先完成 Takara Tomy Mall 實站探索與 Review Queue 核准驗收，再討論 Phase 3。
- 2026-07-16 已建立 Git repository 與初始 commit `689c181`；作者為 Darren Ye，使用 GitHub noreply Email。
