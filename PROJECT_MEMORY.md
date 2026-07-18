# Beyblade Tracker 專案記憶與交接文件

> 更新日期：2026-07-18（Asia/Taipei）
> 專案階段：版本 1.0.0；Roadmap Phase 0 至 Phase 7 與既有技術債清理已完成
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
- Phase 3：三語 UI／狀態詞典、Catalog、多語別名、來源證據、零件關聯與未知詞彙審核。
- Phase 4：獨立 Discovery／Offer 排程、Offer freshness、stale／archived／恢復、時間線、來源健康、穩定確認與手動重查冷卻。
- Phase 5：Watchlist、官方來源 Registry、官方 Catalog／公告、匹配優先級、通知偏好與首次掃描預覽。
- Phase 6：社群來源 Registry、未驗證線索、文章／轉貼去重、Watchlist 命中、來源過濾與保存政策。
- Phase 3 至 Phase 5 完成基準 commit：`7b22537`（`feat: complete phases 3 through 5`）。
- Git 初始完成基準：`689c181f94076a6146e1e1409e1c978dd6d6067b`（`feat: complete phase 0 and phase 1`）。
- 正式資料庫已升級至 schema version 3，保留 3 個真實來源與既有 UX-20 歷史；完整性檢查通過且沒有 orphan foreign key。
- 驗收結果：62/62 項 Node 測試、7/7 條 Web 路由煙霧測試均通過，真實 Yodobashi 預覽及來源測試成功。
- Local Web App 位於 `http://127.0.0.1:8787`，完成時 `/health` 回傳 `ok`。

Phase 2 程式已完成，離線 Takara Tomy Mall 驗收 fixture 通過；正式背景服務後續已完成 schema 4，
並在 Phase 3 升級至 schema 5。Takara Tomy Mall 實站驗收仍待 Queue-it 自然解除。除非出現可重現的
回歸問題或使用者明確要求，後續工作不得重做 Phase 0 至 Phase 6。

### 2026-07-16 Phase 2 正式重啟與實站測試

- Phase 2 已提交為 `de77719`（`feat: complete phase 2 discovery and review queue`），工作樹乾淨。
- 正式服務已安全重啟，新版正式 DB 已由 schema version 3 升級至 4。
- 正式 DB 完整性 `ok`、0 個 foreign key orphan；既有 1 Product／3 Offers／1 Event 均保留。
- 正在執行的 `http://127.0.0.1:8787` 共 7 條管理／健康路由皆回傳 HTTP 200，`/health` 為 `ok`。
- Takara Tomy Mall 真實分類頁在一般 HTTP 下 45 秒仍為 0 bytes；Headless Chrome 回傳 HTTP/2 protocol error；
  螢幕外一般 Chrome 被導向 `takaratomy.queue-it.net` 的「網站混雑」等候室。
- 依「不繞過排隊、CAPTCHA 或存取限制」原則，本次沒有把 Takara Tomy Mall 寫入正式來源、沒有建立候選，
  也沒有使用既有瀏覽器 session 代替 Tracker 的乾淨工作階段。待網站不再導向 Queue-it 時再重試。

### 2026-07-16 Phase 3 多語言與商品辨識

- Phase 3 已完成實作並正式升級至 schema version 5；升級前備份為
  `backups/manual-20260716-073425Z.db`（schema 4），升級後另有
  `backups/manual-20260716-073627Z.db`（schema 5）。
- UI 已導入翻譯 key，繁中／日文／英文可在介面切換；商品刊登同時顯示翻譯狀態、商店原文與最後檢查時間。
- 新增最小 Beyblade Catalog：BX／UX／CX 商品身分、Blade／Ratchet／Bit／Assist Blade、
  商品組成、多語別名、來源證據、可信度、人工驗證與授權備註欄位。
- 商店 Product 仍與 Catalog 分層；只用型號精確匹配，不用相似標題強制合併。既有 1 個 Product
  已回填為 1 個 CatalogProduct、1 個別名與 1 筆來源證據。
- 未知庫存文字與缺少商品身分的內容會進 terminology review queue；庫存詞彙經人工核准後，
  才寫入解析覆寫規則並於下一次觀測生效。
- 正規化涵蓋 Unicode NFKC、全半形、連字號、大小寫、JPY／TWD／USD、含稅／未稅、日期與時區。
- 驗收結果：80/80 項 Node 測試、9 條 Web 路由煙霧測試均通過；正式 DB 完整性 `ok`、
  0 個 foreign key orphan，既有 1 Product／3 Offers／1 Event 均保留。
- 正式服務已以 schema version 5 在 `http://127.0.0.1:8787` 運行，`/health` 回傳 `ok`。
- Takara Tomy Mall 實站探索仍待 Queue-it 自然解除，Phase 3 不以繞過等候室完成驗收。

### 2026-07-16 Phase 4 持續更新、資料新鮮度與排程

- Phase 4 已完成實作並正式升級至 schema version 6；升級前備份為
  `backups/manual-20260716-082702Z.db`（schema 5），升級後備份為
  `backups/manual-20260716-082753Z.db`（schema 6）。
- Discovery Scheduler 與 Offer Monitor Scheduler 已分離；服務依兩者最早到期工作喚醒。
- Offer 保存 `last_attempted_at`、`last_successful_at`、`fresh_until` 與 freshness 狀態；stale／archived
  不計入可購買，連續缺失或單一 Offer 的重複 404／410 可封存，重新出現時恢復。
- 排程具備自適應週期、jitter、指數 backoff、來源最小請求間隔與保守單工並行；已預留 Watchlist 優先級。
- 商品詳情顯示價格／庫存觀測時間線；來源管理顯示下次監控與連續失敗，並提供有 60 秒冷卻的立即重查。
- 庫存狀態預設連續兩次確認才轉換；stale 現貨事件會被消耗而不送出舊庫存通知。
- 驗收結果：87/87 項 Node 測試、10 條 Web 路由煙霧測試均通過；正式 DB 完整性 `ok`、
  0 個 foreign key orphan，既有 1 Product／3 Offers／1 Event 均保留。
- 正式服務 PID `352628` 以 schema version 6 在 `http://127.0.0.1:8787` 運行，`/health` 回傳 `ok`。
- Takara Tomy Mall 實站探索仍按原決定延後，Phase 4 驗收未嘗試繞過 Queue-it。

### 2026-07-16 Phase 5 官方情報與 Watchlist

- Phase 5 已完成實作並正式升級至 schema version 7；升級前備份為
  `backups/manual-20260716-093125Z.db`（schema 6），升級後備份為
  `backups/manual-20260716-093234Z.db`（schema 7）。
- `/watchlist` 可建立 Catalog 商品／零件或規則型 Watchlist，欄位包含商品號、型號、條碼、
  關鍵字、排除詞、語言、精確／包含／Regex 與同義詞擴充。
- Watchlist 通知偏好分為新品公告、預購、發售、現貨／補貨與價格異常；命中以唯一鍵去重，
  既有新鮮現貨可在新建 Watchlist 時回填，後續狀態事件只通知一次。
- Takara Tomy Mall 已登錄為 `official_store`，Site 為 `takaratomymall.jp`；Registry 明確區分
  官方商店、官方公告、媒體與零售商，取得優先序為 API／RSS／Sitemap／商品清單／HTML。
- Takara Recipe 包含分類、新品、補貨、分頁、商品詳情與排除規則；`wovn` 只影響顯示語言，
  不參與 URL／商品身分去重。
- 官方高信心商品會先建立／更新已驗證 CatalogProduct，再以候選進 Review Queue；低信心資料
  直接進人工審核，條碼衝突標為 `conflict`。官方公告不直接當成商店庫存。
- 正式 Takara Seed、Discovery 設定與掃描預覽保持停用／`pending`；預覽顯示最多 100 個候選、
  同站範圍、排除項目與 100 頁／5 分鐘／50 MB 預算。使用者日後確認前不得掃描。
- CX-99 離線 fixture 驗收已完成：先看到官方公告，商店現貨 Offer 出現後建立並傳送一次通知；
  Watchlist 命中把 Offer 監控週期提高到 5 分鐘。
- 驗收結果：95/95 項 Node 測試、11 條 Web 路由煙霧測試通過；正式 DB 完整性 `ok`、
  0 個 foreign key orphan，既有 1 Product／3 Offers／1 Event 均保留。
- 正式服務 PID `220908` 以 schema version 7 在 `http://127.0.0.1:8787` 運行，`/health` 回傳 `ok`。

### 2026-07-16 Phase 6 論壇與社群情報

- Phase 6 已完成實作並正式升級至 schema version 8；升級前備份為
  `backups/manual-20260716-102024Z.db`（schema 7），升級後備份為
  `backups/manual-20260716-102105Z.db`（schema 8）。
- `/community` 將社群線索與官方 Catalog／公告、商店 Offer／庫存事件分開顯示，所有內容標為
  `unverified`，並保留作者、發表時間、原始連結、語言、型號及取得方式。
- `@bey_sokuhou` 已登錄為第一個 `social`／非官方社群速報來源；可辨識新品、抽選、預購、
  再入荷及商店連結，並以文章 ID、canonical URL、內容指紋合併重複讀取與轉貼。
- 社群貼文可依型號／關鍵字命中 Watchlist，但不會建立官方公告、Offer、庫存事件或
  Watchlist 現貨通知；離線 fixture 已驗證此隔離邊界。
- 來源支援靜音、關鍵字排除、敏感內容、垃圾訊息過濾，以及每來源 7–365 天保存／到期刪除；
  可選摘要必須標示為機器摘要且不宣稱真偽。
- 2026-07-16 查核 X 官方 API 為按量付費，Post Read 每則 US$0.005；每日 20 則不重複貼文
  粗估約 US$3／月。使用者決定本專案不代付 X 費用，所以來源保持 `user_setup_required`、
  `enabled=0`、`monthly_budget_usd=0`。使用者點選自費設定會先看到費用、價格變動、自動加值與
  spending limit 警告，勾選理解後才開啟 X Developer Console，以自己的帳戶、App 與 credits 設定。
  開啟 Console 不會啟用來源或呼叫 API，也沒有使用 HTML 抓取繞過登入／反自動化。
- 驗收結果：105/105 項 Node 測試、12 條 Web 路由煙霧測試通過；正式 DB 完整性 `ok`、
  0 個 foreign key orphan，既有 1 Product／3 Offers／1 Event 均保留。
- 當時正式服務 PID `374536` 以 schema version 8 在 `http://127.0.0.1:8787` 運行；這是 Phase 6
  的歷史驗收紀錄，不可當成目前 PID 或服務狀態。

### 2026-07-18 技術債清理基線

- schema version 9 新增 `products.normalized_sku`、`products.variant_key` 與 `listing_exclusions`。
- 商品合併順序為條碼 → 正規化 SKU → SKU／限定版／顏色特徵相容的型號；不確定時建立不同 Product。
- 二手、拆售與明確非目標商品的排除原因會保存來源、URL、首次／最後出現及累計次數；不會只寫 debug log。
- 一般 HTTP、安全預覽、Telegram 與 Discord 已具 timeout、下載上限、429／5xx 有限重試、
  `Retry-After`、指數退避及 jitter；永久 4xx 不重試。
- Offer 不保存瞬時 `discovered` 狀態；首次發現固定建立 `product_discovered` 永久事件。
- `npm test` 為 118/118 通過；設定檢查仍為 3 個有效來源。
- 2026-07-18 檢查時正式背景服務為「已停止」。`npm run health` 的 `ok` 是在 8788 臨時啟動的
  健康煙霧測試，不代表 8787 正式背景服務正在執行。

### 2026-07-18 人工修正與維運控制基線

- schema version 10 新增 `product_identity_audit`、`listing_exclusion_overrides`、`network_control`，並為 `listing_exclusions` 加入審核狀態、註記與時間。
- 商品詳情頁可人工拆分 Offer 或重併 Product；操作會同步移動關聯事件、候選資料與 Watchlist 關聯，保存前後快照及 Offer ID 稽核資料。
- 既有 Offer 對 Product 的連結視為人工／既有身分決策，後續重掃優先沿用，不再由自動型號匹配覆蓋。
- `/exclusions` 可確認排除、放行單一來源 URL 或重新檢視；原始排除理由、證據摘要與累計次數不會被覆寫成只有最終結論。
- 來源管理頁提供外部網路總開關；停用後不啟動抓取、探索或外部通知，既有資料及待送通知保留。環境變數 `NETWORK_ENABLED=0` 可禁止 UI 重新開啟。
- `npm test` 為 125/125 通過；設定檢查為 3 個有效來源，Web smoke 為 13/13 路由。
- 正式 DB 已由 schema 9 升級至 10；升級前備份為 `backups/manual-20260718-090924Z.db`，升級後完整性 `ok`、0 個 foreign key orphan，1 Product／3 Offers／1 Event 均保留。
- 正式背景服務仍為停止狀態；資料庫網路開關預設為啟用，但不代表服務正在執行。

### 2026-07-18 Phase 7 Windows 發佈基線

- 版本為 `1.0.0`；per-user Inno Setup 安裝器內含 Node.js runtime，一般使用者不需另裝開發工具。
- 系統 Chrome 採偵測而非打包；缺少 Chrome 時提供官方下載入口，不影響 HTTP-only 來源。
- 更新 manifest 強制 HTTPS、SHA-256 與 Ed25519 簽章；更新前建立一致性資料庫備份，並保存版本指標與回滾紀錄。
- `.beyblade-transfer` 單檔移機包含資料庫與來源設定，逐檔驗證 SHA-256，排除 DPAPI 憑證、PID、log、raw HTML 與 debug 資料。
- Telegram Token／Chat ID 使用 Windows DPAPI CurrentUser 保護；設定頁提供 BotFather、Start、儲存、測試與清除流程。
- 隱私說明、來源政策與診斷資料同意已完成；診斷檔只可由使用者主動匯出，不會自動上傳。
- 修正版 Windows E2E 已驗證安裝、封裝 runtime 健康檢查、解除安裝、程式檔清除與使用者資料保留。
- 最終 release candidate：`dist/windows/installer/BeybladeTracker-1.0.0-Setup.exe`，27,449,237 bytes，SHA-256 `39edcaee697eaed7c9a1fb2d16ffca04c61930b7a28b5977f16a1b85e497e9c3`。
- `release-manifest.json` 雜湊與安裝器相符；因尚未設定 HTTPS 發佈 URL、Ed25519 私鑰與 Authenticode 憑證，`publishReady=false`，不得視為已公開上線。

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
- Local Web App：`http://127.0.0.1:8787`，可預覽、加入、測試、停用及重新啟用來源，並控制外部網路總開關。
- 來源首頁／分類頁可啟動受控探索；候選先進 `/review`，核准後才建立 Product／Offer 與監控網址。
- `/products/:id` 可人工拆分／重併商品；`/exclusions` 可審核及修正歷史排除判斷。
- `/health` 提供服務、來源健康與外部網路開關資訊。
- 目前為 133 項 Node 自動化測試，另有 16 條 Web 路由煙霧測試。

### Phase 0 已完成（2026-07-16）

- SQLite schema version 目前為 10；`src/db/migrations/` 由 migration runner 依序升級並記錄校驗碼。
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
- 受控站內探索、官方公告、Watchlist、三語介面與社群 Registry 已具備；Takara Tomy Mall
  真實分類頁仍待 Queue-it 自然解除後完成正式探索／Review Queue 驗收。
- X `@bey_sokuhou` 只有離線能力與 UI；未取得使用者自費 API 設定前維持停用與零預算。
- Windows 安裝程式、更新／回滾、移機與 OS 安全憑證儲存已完成；公開通路仍需 Authenticode 憑證、HTTPS 發佈站與乾淨 Windows 驗收。
- 尚未提供完整營運指標與條件式 HTTP 快取；全域網路開關、一般使用者商品拆分／重併及歷史排除修正介面已完成。
- 尚未提供跨裝置同步或多使用者帳號；單機版穩定發佈前不排入近期工作。
- 不會自動購買、登入商店、操作購物車或繞過反自動化措施。

## 6. 移交到其他裝置

一般使用者可用安裝器與單一 `.beyblade-transfer` 檔移交到另一台 Windows 電腦，不需安裝 Node.js。需要瀏覽器來源時建議安裝 Google Chrome。

建議流程：

1. 在舊電腦的「設定與移機」頁匯出 `.beyblade-transfer`。
2. 在新電腦安裝相同或更新版本的 Beyblade Tracker。
3. 從設定頁匯入移機檔；程式會先保留現有資料庫，再於重新啟動時套用。
4. 檢查管理頁、來源設定與 `/health`；Telegram 憑證受原 Windows 使用者 DPAPI 保護，必須在新電腦重新設定。

不要手動移交 `.env` 或加密憑證檔，也不要讓兩台電腦透過 OneDrive 同時執行同一份 SQLite 資料庫；這會有同步衝突、資料損壞或重複通知風險。

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
> `ROADMAP.md`、`README.md` 與 `TODO.md`。Phase 0 至 Phase 7 已完成並驗收；不要重做已完成部分。
> 目前程式版本 1.0.0、schema version 10；先確認備份、133 項測試、16 條 Web 路由與服務狀態；不要假設
> 舊 PID 仍在執行。Takara
> Tomy Mall 實站探索待 Queue-it 自然解除後再執行；X 由使用者以自己的 Developer Project 自費設定，
> 本專案保持停用與零預算。

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
- X 官方 API 目前按量付費，Post Read 每則 US$0.005；`@bey_sokuhou` 已完成離線能力與 UI。
  本專案不代付費用，使用者只能在費用警告後前往自己的 Developer Console 自費設定，且不以
  其他方式繞過平台限制。

## 10. 本次執行狀態

- Roadmap Phase 0 至 Phase 7 已完成工程實作與自動化驗收；Takara 實站驗收仍待 Queue-it 解除及使用者確認預覽。
- 升級前後商品與事件未遺失；version 0 備份已在另一個測試資料夾成功還原並升級。
- 正式 DB 已清除可明確識別的 Demo 資料，目前只保留三個真實商店與 UX-20 歷史。
- Phase 2 至 Phase 6 曾完成 schema version 4／5／6／7／8 正式重啟驗收；2026-07-18 技術債與人工修正工作把目前程式提升至 schema version 10。
- 133/133 項 Node 測試、設定檢查與 16 條 Web smoke 通過；正式 DB 已由 schema 9 升級至 10，
  完整性 `ok`、0 個 foreign key orphan，既有 1 Product／3 Offers／1 Event 均保留。最新手動備份為
  `backups/manual-20260718-101724Z.db`；schema 10 升級前備份 `backups/manual-20260718-090924Z.db` 亦保留。
- 正式背景服務目前為停止狀態；是否重新啟動應由使用者工作流程決定，不把臨時 health smoke 視為背景服務已啟動。
- 官方 Registry 與社群 Registry 已登錄，但 Takara 實站取得及 X 付費 API 均保持停用。
- Takara Tomy Mall 實站探索目前受 Queue-it 等候室阻擋；不要繞過，待網站允許乾淨工作階段存取後重試。
- Phase 7 Windows 發佈、更新／回滾、移機、DPAPI 憑證、Telegram 精靈、政策與診斷同意已完成；公開發佈憑證／站台屬外部閘門。
- 2026-07-16 已建立 Git repository 與初始 commit `689c181`；作者為 Darren Ye，使用 GitHub noreply Email。
