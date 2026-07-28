# Legacy TODO（已封存）

> 本檔只保留 2026-07-18 以前的歷史紀錄，不再更新。
> 正式 backlog：[`docs/TICKETS.md`](docs/TICKETS.md)
> 優先順序與里程碑：[`docs/ROADMAP.md`](docs/ROADMAP.md)
> 已完成歷史：[`docs/CHANGELOG.md`](docs/CHANGELOG.md)

以下內容已合併進正式文件；不得把舊 checkbox 當成目前工作狀態。

---

# Beyblade 商品追蹤器：第一版待辦清單（歷史快照）

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
- [x] 優先以條碼、正規化 SKU／型號合併商品；SKU 衝突或限定版／顏色特徵不同時不強行合併。
- [x] 可辨識 `coming_soon`、`preorder`、`in_stock`、`out_of_stock`、`unknown`；首次發現固定以 `product_discovered` 事件表示，Offer 不另存瞬時 `discovered` 狀態。
- [x] 只有狀態轉換或重要資料變化才建立事件，重複掃描不得重複通知。
- [x] 通知需先進入彙整佇列，同商品的多商店結果可合併成一則摘要。
- [x] 實作 Console 通知器，並提供可選的 Telegram Bot 與 Discord Webhook 通知器。
- [x] 未設定 Token／Webhook 時不可傳送外部訊息，也不可讓程式崩潰。
- [x] 提供一次性掃描命令及持續排程命令。
- [x] 提供簡單的唯讀 Web 管理頁面，能查看商品、可購買刊登、來源健康狀態及最近事件。
- [x] 提供健康檢查端點，例如 `/health`。
- [x] HTTP、安全預覽與外部通知要求具備 timeout、User-Agent／瀏覽器身分、網域／排程限速、有限次重試、`Retry-After` 與指數退避；回應下載大小受限。
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
- [x] 排除明確的二手、零件拆售與明確非目標商品，持久化來源、網址、原因、首次／最後出現及累計次數。
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

## 第一版技術債清理（2026-07-18 完成）

- [x] schema version 9：加入 `normalized_sku`、`variant_key` 與 `listing_exclusions` 稽核資料。
- [x] 商品合併採條碼 → 正規化 SKU → 相容型號；SKU 衝突及限定版／顏色特徵不同時分開保存。
- [x] 排除原因持久化，明確非目標商品使用保守白名單規則，不因缺少 Beyblade 關鍵字就直接排除。
- [x] Telegram／Discord 加入明確 timeout、429／5xx 有限重試、`Retry-After`、指數退避及 jitter。
- [x] 一般 HTTP／安全預覽補齊 `Retry-After`、下載上限與可測試的有限退避重試。
- [x] 確認 Offer 不保留 `discovered` 狀態；首次發現以永久事件表示，避免同一概念保存兩份狀態。
- [x] 118/118 項 Node 自動化測試通過。

## 人工修正與維運控制（2026-07-18 完成）

- [x] schema version 10：加入商品身分稽核、排除審核／覆寫及全域網路控制資料。
- [x] 商品詳情頁可選取 Offer 拆成新 Product，或把 Product 重併至另一商品；移動關聯事件與 Watchlist 資料並保存前後快照。
- [x] 既有 Offer 的人工身分決策優先於自動匹配，重新掃描不會把人工拆分結果自動合回。
- [x] 排除紀錄可確認、放行或重新檢視，完整保留原始理由、證據摘要、出現次數、審核註記與時間。
- [x] 來源管理頁提供外部網路總開關；停用後停止抓取、探索與通知，但保留資料及待送佇列，`NETWORK_ENABLED=0` 可作為環境層上限鎖。
- [x] 125/125 項 Node 自動化測試與 13 條 Web 路由煙霧測試通過。

## Roadmap Phase 7：Windows 發佈、移機與隱私（2026-07-18 完成）

- [x] 版本提升至 1.0.0，建立內含 Node runtime 的 per-user Windows 安裝器、開始功能表捷徑、登入後自動啟動與保留資料的解除安裝流程。
- [x] 偵測系統 Chrome，不強制打包大型瀏覽器；缺少 Chrome 時提供官方下載入口，HTTP-only 來源仍可使用。
- [x] 建立 HTTPS、SHA-256 與 Ed25519 驗證的更新機制，以及更新前資料庫備份、版本指標與回滾。
- [x] 建立單一 `.beyblade-transfer` 匯出／匯入流程，驗證每個檔案雜湊並排除密鑰、PID、log、raw HTML 與 debug 資料。
- [x] Telegram Token／Chat ID 改用 Windows DPAPI CurrentUser 保護，設定頁提供 BotFather、Start、儲存與測試引導。
- [x] 建立隱私說明、來源政策、需明確同意的去識別診斷匯出，以及繁中／日文／英文設定介面。
- [x] Windows 隔離安裝驗收完成：安裝、封裝版健康檢查、解除安裝及使用者資料保留均通過。
- [x] 133/133 項 Node 自動化測試與 16 條 Web 路由煙霧測試通過。
- [ ] 公開發佈閘門：取得 Authenticode 憑證與 HTTPS 發佈站後，簽署安裝器／manifest，並在全新 Windows 測試機驗證線上更新及 SmartScreen。這是發佈憑證與基礎設施工作，不是未完成的 Phase 7 程式功能。

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
- [x] 重啟正式背景服務，驗證 schema version 3 → 4 migration、正式 DB 完整性及 live 路由。
- [ ] 使用 Takara Tomy Mall 真實分類頁完成探索及 Review Queue 核准驗收；2026-07-16 乾淨 Chrome 被導向 Queue-it 等候室，依政策不繞過，待網站恢復後重試。

## Roadmap Phase 3：多語言與商品辨識（2026-07-16）

- [x] schema version 5：CatalogProduct、CatalogPart、商品組成、多語別名、來源證據與 Product 連結。
- [x] 繁中／日文／英文 UI i18n 與介面即時切換。
- [x] 三語庫存狀態詞典、原始商店文字與翻譯狀態並列顯示。
- [x] BX／UX／CX 商品身分、Unicode／全半形／大小寫／連字號別名正規化。
- [x] Blade／Ratchet／Bit／Assist Blade 零件類型與商品關聯。
- [x] JPY／TWD／USD、含稅／未稅、發售日期與時區正規化。
- [x] 未知庫存詞彙與無型號商品進人工佇列；庫存詞彙核准後才成為解析覆寫規則。
- [x] 既有 Product 回填 Catalog 身分與來源證據，正式資料筆數不遺失。
- [x] 80/80 項 Node 自動化測試與 9 條 Web 路由煙霧測試通過。
- [x] 正式 DB 升級至 schema version 5，完整性 `ok` 且 0 個 foreign key orphan。

## Roadmap Phase 4：持續更新、資料新鮮度與排程（2026-07-16）

- [x] schema version 6：Offer freshness 欄位、來源監控設定與立即重查佇列。
- [x] Discovery Scheduler 與 Offer Monitor Scheduler 分離，服務等待時間取兩者最早到期工作。
- [x] 可購買／發售日／未來 Watchlist 優先級、自適應週期、jitter、指數 backoff 與每網域限速。
- [x] stale 不再計入可購買；連續缺失、404 或停售封存，重新出現時恢復。
- [x] 商品詳情顯示價格與庫存時間線；來源頁顯示健康、下次監控與連續失敗。
- [x] 庫存狀態連續兩次確認、事件去重及 stale 現貨通知抑制。
- [x] 「立即重新檢查」API／UI、60 秒冷卻與服務喚醒。
- [x] 87/87 項 Node 自動化測試與 10 條 Web 路由煙霧測試通過。
- [x] 正式 DB 升級至 schema version 6，完整性 `ok`、0 個 foreign key orphan，既有資料完整。

## Roadmap Phase 5：官方情報與 Watchlist（2026-07-16）

- [x] schema version 7：Watchlist、匹配、通知偏好、官方來源、公告與首次掃描預覽。
- [x] Watchlist UI／API 支援商品號、型號、條碼、關鍵字、排除詞、語言與 Catalog 商品／零件。
- [x] 精確、包含、進階 Regex、已驗證別名與零件組成匹配。
- [x] Takara Tomy Mall 官方商店 Registry、Seed、Discovery Recipe 與 `wovn` 身分去重。
- [x] 正式首次掃描預覽預設停用，顯示候選上限、範圍、排除與請求預算，確認後才啟用。
- [x] 官方商品先更新已驗證 Catalog；公告與商店 Offer 分層，低信心／衝突可人工處理。
- [x] Watchlist 命中提高 Discovery／Offer Monitor 優先級。
- [x] 新品公告、預購、發售、現貨／補貨及價格異常通知偏好與一次性去重。
- [x] CX-99 尚未上市型號的官方公告 → 商店現貨 → 單次通知離線驗收通過。
- [x] 95/95 項 Node 自動化測試與 11 條 Web 路由煙霧測試通過。
- [x] 正式 DB 升級至 schema version 7，完整性 `ok`、0 個 foreign key orphan，既有資料完整。

## Roadmap Phase 6：論壇與社群情報（2026-07-16）

- [x] schema version 8：社群來源、貼文、原始出處、連結、Watchlist 命中與來源執行紀錄。
- [x] `@bey_sokuhou` 登錄為第一個非官方社群速報；官方、媒體、論壇、社群與零售資料維持分層。
- [x] 新品、抽選、預購、再入荷、商店連結、語言與 BX／UX／CX 型號辨識。
- [x] 文章 ID、canonical URL 與內容指紋去重；重複讀取及轉貼合併並保留原始出處。
- [x] 社群線索可命中 Watchlist，但不建立官方公告、Offer、庫存事件或現貨通知。
- [x] 原始作者、時間、連結、取得方式、未驗證標籤與機器摘要標示。
- [x] 來源靜音、關鍵字排除、敏感內容、垃圾訊息過濾及 7–365 天保存／刪除政策。
- [x] X API 每讀取一則 US$0.005 的成本已查核；來源預設 `user_setup_required`、停用、專案月預算零。
- [x] 本專案不代付 X 費用；點選自費設定先顯示單價、月費估算、價格變動與自動加值警告。
- [x] 使用者確認警告後才開啟 X Developer Console，以自己的帳戶、App、credits 與帳單設定。
- [x] 開啟 Console 不會啟用來源或呼叫 API，也不使用未授權 HTML 抓取或繞過反自動化。
- [x] 105/105 項 Node 自動化測試與 12 條 Web 路由煙霧測試通過。
- [x] 正式 DB 升級至 schema version 8，完整性 `ok`、0 個 foreign key orphan，既有資料完整。

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
