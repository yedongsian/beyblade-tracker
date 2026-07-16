# Beyblade 商品追蹤器：第一版待辦清單

## 目標

建立一個可在單台 Windows 電腦長時間運行的獨立專案，定期擷取多個商店的戰鬥陀螺商品資訊，將同一商品的不同商店刊登合併，偵測「新品出現」及「變成可購買」事件，彙整後透過可替換的通知管道推播。

第一版以「可靠的資料管線與可測試架構」為主，不宣稱覆蓋全網，也不繞過 CAPTCHA、登入、付費牆或網站的存取限制。

## 第一版範圍與驗收條件

- [x] 使用 Node.js 22+，可在目前電腦的 Node.js 25 執行。
- [x] 專案可用 `npm install` 安裝，並提供清楚的 README。
- [x] 使用 SQLite 保存來源、標準商品、商店刊登、觀測紀錄、事件及通知紀錄。
- [x] 商品 `Product` 與商店刊登 `Offer` 分離。
- [x] 每個來源實作統一 Connector 介面，單一來源失敗不可中斷其他來源。
- [x] 具備 Fixture Connector，可完全離線重現新品、現貨、缺貨及補貨流程。
- [x] 具備通用 JSON-LD／HTML 商品頁 Connector，可由設定檔加入公開商品頁。
- [ ] 優先以條碼、SKU／型號合併商品；不確定時不可強行合併。
- [ ] 可辨識 `discovered`、`coming_soon`、`preorder`、`in_stock`、`out_of_stock`、`unknown`。（目前首次發現以事件表示，Offer 不會進入 `discovered` 狀態。）
- [x] 只有狀態轉換或重要資料變化才建立事件，重複掃描不得重複通知。
- [x] 通知需先進入彙整佇列，同商品的多商店結果可合併成一則摘要。
- [x] 實作 Console 通知器，並提供可選的 Telegram Bot 與 Discord Webhook 通知器。
- [x] 未設定 Token／Webhook 時不可傳送外部訊息，也不可讓程式崩潰。
- [x] 提供一次性掃描命令及持續排程命令。
- [x] 提供簡單的唯讀 Web 管理頁面，能查看商品、可購買刊登、來源健康狀態及最近事件。
- [x] 提供健康檢查端點，例如 `/health`。
- [ ] 所有網路要求具備 timeout、User-Agent、網域限速、有限次重試與指數退避。
- [x] 保存錯誤摘要及來源最後成功／失敗時間，不保存敏感 Token。
- [x] 提供 `.env.example`、來源設定範例和 Windows 啟動說明。
- [x] 提供自動化測試，至少涵蓋解析、商品合併、狀態轉換、去重與通知彙整。
- [x] `npm test` 全部通過。

## 資料模型

- [x] `sources`：商店、連接器類型、網址、啟用狀態、檢查週期及健康資訊。
- [x] `products`：標準名稱、品牌、系列、型號、條碼、發售日期及圖片。
- [x] `offers`：來源、商品網址、商店標題、價格、幣別、可購買狀態及可信度。
- [x] `observations`：每次觀測到的價格、庫存訊號、時間及原始資料摘要。
- [x] `events`：新品、預購、現貨、補貨、缺貨及價格變動事件。
- [x] `notifications`：事件彙整、通知管道、傳送時間、結果及防重複鍵。
- [x] `crawl_runs`：每個來源的執行時間、成功／失敗、筆數及錯誤訊息。

## 擷取與標準化

- [x] 定義 `Connector` 介面與標準化輸出格式。
- [x] 解析 JSON-LD 的 Product／Offer／AggregateOffer。
- [x] 支援設定 CSS selector 作為 JSON-LD 缺失時的備援。
- [x] 正規化網址、空白、全半形文字、幣別、價格及戰鬥陀螺型號。
- [x] 從中、英、日文標題辨識常見型號，例如 `BX-38`、`CX-00`、`UX-00`。
- [ ] 排除明確的二手、零件拆售或無法判定為目標商品的項目，並保留排除原因。
- [x] 原始 HTML 只在除錯模式或解析失敗時落盤，並設定保存期限。

## 可購買狀態與事件

- [x] 使用結構化 availability、價格、購物按鈕及庫存文字計算可信度。
- [x] `preorder` 是否視為可購買由設定檔控制。
- [x] 首次看到商品建立 `product_discovered`。
- [x] `out_of_stock/unknown -> in_stock` 建立 `back_in_stock` 或 `became_available`。
- [x] 相同狀態重複掃描不可建立相同事件。
- [x] 設計事件冷卻時間，避免商店頁面抖動造成洗版。
- [x] 通知摘要按現貨優先、價格及來源排序。

## 執行與維運

- [x] `npm run crawl:once`：執行一次所有啟用來源。
- [x] `npm run worker`：持續排程與通知，並遵守各來源自己的檢查週期。
- [x] `npm run web`：啟動管理頁面。
- [x] `npm run dev`：開發模式啟動。
- [x] 程式收到 Ctrl+C／終止訊號時安全關閉資料庫與工作。
- [x] 提供 Windows 工作排程器或登入後自動啟動的說明。
- [x] 日誌不得輸出 Bot Token、Webhook 或其他密鑰。
- [x] 提供資料庫備份與還原說明。

## 測試情境

- [x] 第一次讀取 fixture：建立 Product、Offer 及新品事件。
- [x] 第二次讀取相同 fixture：不建立重複事件或通知。
- [x] 商品由缺貨變成有貨：只建立一次補貨事件。
- [x] 同型號兩家商店：合併為一個 Product、兩個 Offers。
- [x] 同名但不同型號：不可誤合併。
- [x] 來源 timeout／解析失敗：記錄錯誤，其餘來源繼續。
- [x] 未設定外部通知憑證：Console 正常、外部通知跳過。
- [x] Web 頁面與 `/health` 能在本機開啟。

## 第一版尚待完成

- 將 `sku` 納入商品合併鍵，並處理同型號的限定版／顏色版本。
- 將排除原因持久化，並更可靠地判定「不是戰鬥陀螺商品」的頁面。
- 讓 Telegram／Discord 通知請求也使用明確 timeout 與退避重試。
- 決定是否保留 Offer 的 `discovered` 狀態；目前首次發現由事件表示。

## 第二階段：實際商店與快速控制（2026-07-15）

- [x] 參考既有 `start_bot`／`restart_bot`／`stop_bot` 的 PID、日誌與安全停止設計。
- [x] 提供 `start_tracker.cmd`、`restart_tracker.cmd`、`stop_tracker.cmd`、`status_tracker.cmd`。
- [x] 以單一背景服務同時管理抓取排程與 Web 管理頁，防止重複啟動。
- [x] 停止時只針對本專案的 PID，並在強制終止前核對程序命令列。
- [x] 加入 Yodobashi UX-20 商品頁並實際解析。
- [x] 加入しまむら UX-20 商品頁；一般 HTTP 被拒時使用螢幕外 Chrome 讀取公開頁。
- [x] 加入 HobbyLink Japan UX-20 商品頁並實際解析 JSON-LD。
- [x] 補上日文「販売休止中／予約終了／再入荷予定なし」等缺貨狀態判定。
- [x] 管理頁的可購買數量與清單只計算目前啟用的來源。
- [x] 實測啟動、防重複啟動、重啟、停止後再啟動與 `/health`。
- [x] 自動化測試 38/38 通過。

目前三個實際頁面均成功擷取，但在本次測試時皆為不可購買狀態。下一步是加入更多商品頁／
商店清單，以及選定 Telegram、Discord 或其他正式推播管道。

## Roadmap Phase 0：資料升級與復原基礎（2026-07-16）

- [x] schema version 2、依序執行且記錄校驗碼的 migration runner。
- [x] 自動／手動一致性 SQLite 備份、30 天／30 份保留週期。
- [x] 安全還原命令：完整性檢查、運行中拒絕覆蓋、保留還原前 DB、舊版自動 migration。
- [x] 跨獨立測試資料夾還原驗收，商品、事件與觀測筆數不遺失。
- [x] `data/` 與 `runtime/`、`logs/`、debug HTML 分離。
- [x] 啟動時復原未完成的 crawl run。
- [x] 環境與來源設定 validation，提供繁中可操作錯誤訊息。
- [x] Connector semantic version、Recipe version、Fixture 與 Connector 契約測試。
- [x] 歷史 Demo DB 與正式 DB 中的 Demo 專屬資料歸檔；正式 UX-20 資料保留。
- [x] 48/48 項自動化測試通過，背景服務與 `/health` 驗收正常。

## Roadmap Phase 1：一般使用者介面與商店登錄（2026-07-16）

- [x] 唯讀頁升級為繁中 Local Web App，保留商品、Offer、事件與健康頁。
- [x] 首次啟動導覽：語言、通知、掃描頻率、資料保存。
- [x] 貼網址 → 安全連線 → 預覽 → 確認加入垂直流程。
- [x] URL canonicalization、registrable domain、`Site` 與 `SeedUrl` schema version 3。
- [x] 同一商店警告與 SeedUrl 合併，不重複建立 Site。
- [x] 預覽顯示候選商品、解析狀態、錯誤、網域範圍及一頁資源預算。
- [x] 來源連線測試與解析結果 API。
- [x] 安全停用／重新啟用；預設保留所有歷史資料。
- [x] 公開 HTTP(S) 驗證、內網封鎖、redirect 重驗證、2 MB 下載上限及 CSRF 防護。
- [x] 鍵盤焦點、跳到主要內容、live region、mobile responsive 與 reduced motion。
- [x] 62/62 項自動化測試、7/7 Web 路由煙霧測試及真實 Yodobashi 預覽／連線測試通過。

## Roadmap Phase 2：受控站內探索與 Review Queue（2026-07-16）

- [x] schema version 4：探索設定、Recipe、Discovery Run、Crawl Frontier 與 Product Candidate。
- [x] `SeedUrl` 區分 discovery／monitor，分類頁不會誤進 Offer 監控。
- [x] 同 Site 安全邊界、redirect 重驗證、robots Allow／Disallow 與 Sitemap／Sitemap index。
- [x] 公開搜尋表單、分類／分頁、商品網址樣式及有限深度連結探索。
- [x] URL 指紋去重、持久化 Frontier、優先級、深度、嘗試與錯誤狀態。
- [x] 預設 100 頁、深度 2、300 秒、50 MB、瀏覽器 3 頁、並行上限 2、間隔 1 秒。
- [x] 品牌、型號、多語關鍵字與排除詞候選分類，保存信心分數與列入原因。
- [x] `/review` 單筆／批次核准、排除、稍後處理；只有核准才建立 Product／Offer 與監控。
- [x] 每站探索安全預算、24 小時排程、Recipe 包含／排除詞及 CSS selector 微調。
- [x] 網站拒絕、預算耗盡、Recipe 失效停掃；失效 Recipe 不由排程盲目重試。
- [x] 異常關閉時復原未完成的 Discovery Run 與 fetching Frontier。
- [x] Takara Tomy Mall BEYBLADE X 離線 fixture 驗收通過。
- [x] 正式 schema 3 備份的隔離副本成功升級至 schema 4，完整性 `ok` 且既有資料筆數不遺失。
- [x] 73/73 項 Node 自動化測試與 8/8 條 Web 路由煙霧測試通過。
- [ ] 重啟正式背景服務，驗證 schema version 3 → 4 migration 與正式 DB 完整性。
- [ ] 使用 Takara Tomy Mall 真實分類頁完成探索及 Review Queue 核准驗收。

## 明確不包含於第一版

- 自動購買、登入商店或操作購物車。
- 繞過 CAPTCHA、Cloudflare 或其他反自動化措施。
- 宣稱搜尋所有網路商店。
- 多使用者帳號、付費訂閱、雲端部署或手機 App。
- AI 商品合併；第一版使用可解釋的條碼、型號及規則比對。

## Claude Opus 執行要求

1. 先閱讀本待辦，建立短執行計畫後直接實作，不只產生設計文件。
2. 優先完成垂直切片：fixture 擷取 → SQLite → 合併 → 事件 → Console 通知 → Web 顯示。
3. 再加入通用 JSON-LD／HTML Connector 與外部通知介面。
4. 不使用需要付費金鑰才能執行測試的服務。
5. 不修改桌面其他專案，不讀取或複製其他專案的秘密檔案。
6. 安裝必要 npm 套件可以執行，但避免沒有必要的大型依賴。
7. 完成後實際執行測試、一次 fixture 掃描及健康檢查。
8. 在回覆中列出完成項目、未完成項目、測試結果及已知限制。
