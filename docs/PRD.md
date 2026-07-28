# Product Requirements Document — Beyblade Tracker

> 狀態：Active／As-built baseline
> 產品版本：1.0.0
> 文件版本：1.0
> 最後更新：2026-07-28

## 1. 產品摘要

Beyblade Tracker 是一個 Windows 優先、可在單機長時間運行的個人商品情報與庫存追蹤工具。它定期讀取使用者核准的公開商店頁面，將同一 Beyblade 商品在不同來源的刊登合併，保存價格與庫存歷史，並在新品、預購、現貨、補貨或價格變動時透過本機介面及選用通知管道告知使用者。

第一版的核心價值不是「搜尋全網」，而是讓少量重要來源具備可解釋、可人工覆核、可備份且不重複洗版的追蹤流程。

## 2. 問題與機會

Beyblade 商品資訊分散在官方公告、零售商商品頁與社群線索中，且可能使用繁中、日文或英文。使用者若手動追蹤，容易遇到：

- 同一商品跨站名稱不同，難以快速比較。
- 缺貨、預購、補貨與停售用語不一致。
- 商店頁面失效或暫時載入失敗時，舊庫存資訊可能造成誤判。
- 高頻輪詢與重複通知造成噪音，也可能對來源網站造成不當負擔。
- 官方資訊、商店庫存及社群傳聞若混在一起，可信度難以判斷。
- 個人資料、通知憑證與資料移機需要安全且可恢復的方式。

## 3. 目標使用者

### 主要使用者

- 在單一 Windows 帳號使用本工具的 Beyblade 收藏者或購買者。
- 願意自行選擇來源、遵守來源政策並處理人工 Review Queue 的進階使用者。

### 次要使用者

- 維護 Connector、解析規則、安裝器與文件的執行團隊。
- 驗收需求、風險、發布閘門與事件改善措施的 PM／Owner。

## 4. 產品原則

1. **人工確認優先於猜測。** 低信心候選、未知庫存詞與商品身分衝突進入 Review Queue。
2. **證據分層。** 官方公告、商店 Offer、社群線索分開保存及呈現。
3. **安全且節制的網路存取。** 只讀公開 HTTP(S) 頁面，遵守 robots、網域界線、timeout、rate limit 與資源預算。
4. **不繞過限制。** 不登入、不解 CAPTCHA、不繞過 Queue-it、付費牆或反自動化控制。
5. **資料可攜且憑證不隨資料外流。** SQLite、來源設定可移機；Token、Webhook、日誌及原始除錯資料不得進入移機包。
6. **可解釋的自動化。** 商品合併以條碼、正規化 SKU／型號與 variant 規則為主，不使用不可解釋的 AI 自動合併。
7. **一般使用者不需開發工具。** 正式版本以雙擊安裝、單一啟動入口、可見錯誤與圖形化復原為標準，不要求 PowerShell。
8. **更新必須取得同意。** 可自動檢查新版，但只有使用者明確確認後才可下載及啟動更新，不做 silent forced update。

## 5. 產品範圍

### 已包含（v1.0.0）

- Fixture、JSON-LD／HTML、system Chrome 三種 Connector。
- Product／Offer 分離、商品合併、異色版與 SKU 衝突保護。
- `coming_soon`、`preorder`、`in_stock`、`out_of_stock`、`unknown` 五種 Offer 狀態。
- 新品、預購、可購買、補貨、缺貨與價格變動事件。
- 觀測歷史、fresh／stale／archived 生命週期及穩定確認。
- 來源管理、安全網址預覽、Site／Seed URL、受控 Discovery 與候選 Review Queue。
- 繁中、日文、英文 UI、Catalog、別名、零件及未知詞彙審核。
- Watchlist、官方來源／公告及未驗證社群情報。
- Console、Telegram、Discord 通知；同商品事件彙整與去重。
- 人工拆分／重併 Product、排除紀錄確認／放行／重開與完整 audit。
- 全域 network kill switch、本機健康檢查、備份／還原、資料移機、診斷匯出。
- Windows per-user 安裝、自動啟動、更新驗證與回滾基礎能力。

### 下一個公開版本已核准需求

- 對正式簽章的 Setup.exe 點兩下即可完成安裝，不要求 Node.js、PowerShell 指令或手動解壓。
- 開始功能表／桌面入口啟動失敗時顯示固定錯誤代碼、可操作說明及問題回報入口。
- 啟動後及每 24 小時最多檢查一次 stable update channel；先顯示版本與 release notes，由使用者選擇稍後或下載安裝。
- 更新前備份，下載與安裝前驗證 manifest、hash 與 publisher；失敗時顯示代碼及 rollback 指引。
- 隨產品提供繁中使用教學、錯誤代碼目錄及公開 GitHub Issue Form。
- 公開 repository 的 Support URL、Release URL 與 maintainer notification 必須在發布前完成設定。

### 明確不包含（v1）

- 自動下單、付款或搶購。
- 商店登入、帳號／Cookie 共用或繞過任何存取限制。
- 宣稱全網或所有零售商覆蓋。
- 多使用者、雲端帳號、跨裝置同步、手機 App。
- 將社群貼文直接視為官方公告、確定庫存或現貨事件。
- 未經使用者接受費用及自行設定的 X API 存取。
- 預設外部遙測或上傳本機使用資料。
- 未經使用者確認的背景下載、silent install 或 forced update。

## 6. 核心使用流程與需求

### FR-01 初次設定

使用者可選擇 UI 語言、通知方式、掃描頻率、資料保存與政策同意；未設定外部通知時系統仍可運作。

驗收重點：設定可保存；API 不回傳 Telegram 明文；未設定通知不應造成啟動失敗。

### FR-02 新增與管理來源

使用者貼入公開 URL 後，系統先驗證安全性、正規化網域與 URL，顯示候選及請求預算，確認後才建立來源或 Seed。停用來源保留歷史，不做 destructive delete。

驗收重點：拒絕 localhost／私網／不安全 redirect；相同 Site 不重複建立；停用後保留 Product、Offer 與 Event。

### FR-03 擷取、正規化與商品身分

Connector 回傳統一 Listing 契約。系統正規化標題、URL、價格、幣別、型號、SKU、條碼、版本／顏色，再建立或更新 Product／Offer。

驗收重點：同條碼或安全相同 SKU 可合併；衝突 SKU、明確異色版或不同型號不可強行合併；無身分證據的相似標題不可自動合併。

### FR-04 庫存、價格與事件

系統保存每次 Observation，只有穩定狀態轉換才改變 Offer 與建立 Event；首次發現建立永久的 `product_discovered` Event。同類事件受 cooldown 與 notification dedup 保護。

驗收重點：重複讀取相同狀態不重複通知；短暫解析失敗不得把舊庫存顯示為新鮮可購買；價格變動門檻由設定控制。

### FR-05 Discovery 與人工審核

Discovery 僅在單一 Site、robots 與預算內執行，優先 Sitemap／公開搜尋與有限連結。候選進入 Review Queue，經 approve 才建立正式監控資料。

驗收重點：不跨站、不重疊執行、預算達上限即停止；exclude／defer 可逆；低信心內容不得直接通知現貨。

### FR-06 Catalog、Watchlist 與情報分層

Catalog 保存官方或零售商證據、多語別名與零件；Watchlist 可依商品、零件、型號、條碼、關鍵字、排除詞與 Regex 匹配。官方公告與社群線索保留各自可信度。

驗收重點：社群資料不得建立 Offer 或確定庫存 Event；官方衝突須顯式呈現；Watchlist 需有可解釋的 match reason。

### FR-07 通知

系統支援 Console、Telegram 與 Discord。事件先彙整後依 channel 傳送；個別 channel 失敗可重試且不得讓已成功 channel 重送。

驗收重點：timeout、有限重試、`Retry-After`；密鑰不落 DB／log；network kill switch 停止外送且不消耗 queue。

### FR-08 維運與可恢復性

使用者可啟停、查狀態、執行健康檢查、建立一致性備份、停止服務後還原、匯出／匯入移機包及版本回滾。

驗收重點：migration 連續且具 checksum；較新 schema 不可由舊程式開啟；還原前驗證完整性並保留還原前 DB；移機包排除憑證與診斷敏感資料。

### FR-09 消費者安裝與啟動

一般使用者從正式 GitHub Release 下載單一 Setup.exe，點兩下後以 per-user 權限完成安裝。安裝器內含 runtime、建立清楚捷徑並可在完成頁直接啟動；正常流程不得要求 command line。

驗收重點：clean Windows 10／11、標準使用者帳號、全新安裝、覆蓋升級與保留資料重裝均由 GUI 完成；SmartScreen 顯示已驗證 publisher。

### FR-10 可操作的錯誤代碼

Installer、Launcher、Update、Database、Network、Browser、Source 與 Notification 的主要失敗必須映射至穩定的 `BT-<AREA>-<NNN>` 代碼。錯誤視窗顯示繁中說明、自助步驟、copy action、App version、UTC time 與安全 support reference。

驗收重點：隱藏的 launcher process 不得讓錯誤無聲消失；UI 不顯示 stack trace、secret 或 private data；每個公開代碼在 [Error Code Catalog](ERROR_CODES.md) 有相同語意與 recovery。

### FR-11 使用者確認的版本更新

程式可在啟動後與每 24 小時檢查 stable channel，但只顯示通知，不直接更新。使用者查看版本、release notes、檔案大小與 publisher 後，可選擇稍後或「下載並安裝」。只有明確確認才可下載／啟動 installer。

驗收重點：拒絕 unsigned／hash mismatch／non-HTTPS artifact；更新前 backup；下載中斷可安全重試；失敗可 rollback；關閉 network 或選稍後時不消耗使用者同意。

### FR-12 使用教學與 Support

正式安裝包、repository 與 App 都能找到繁中使用教學、錯誤代碼及問題回報入口。問題回報使用公開 GitHub Issue Form，引導非技術使用者填入錯誤代碼、版本、Windows 與重現步驟。

驗收重點：Issue Form 不要求 Git knowledge；明確警告內容為公開且不得上傳敏感資料；maintainer 已設定 Issues watching 與 Email notification，並完成雙帳號 end-to-end 測試。

## 7. 非功能需求

| ID | 領域 | 需求 |
|---|---|---|
| NFR-01 | Availability | 單一來源失敗不得中止其他來源；服務重啟後將遺留 running work 標為 failed。 |
| NFR-02 | Security | Web UI 預設只綁 `127.0.0.1`；mutation 需 localhost Host／Origin 與 CSRF token。 |
| NFR-03 | Privacy | 預設不外送遙測；Token／Webhook 不進 DB、log、diagnostics 或 transfer bundle。 |
| NFR-04 | Performance | Discovery、browser、response size、concurrency、rate limit 均有上限；後續需建立正式基準。 |
| NFR-05 | Accessibility | Local Web App 支援鍵盤導覽、skip link、live region、reduced motion 與三語 UI。 |
| NFR-06 | Maintainability | Connector 有 semantic version 與契約測試；schema 只透過連續 migration 演進。 |
| NFR-07 | Portability | 原始碼可在 Windows／macOS／Linux 執行；正式一般使用者交付以 Windows 為主。 |
| NFR-08 | Compliance | 尊重來源 Terms、robots 與授權；不繞過技術限制。 |
| NFR-09 | Usability | 正常安裝、啟動、更新與問題回報不要求 PowerShell、Git 或程式開發知識。 |
| NFR-10 | Supportability | 公開錯誤代碼語意穩定、可複製、可連到文件與 Issue Form，且不洩漏敏感資料。 |

## 8. 成功指標

目前尚未建立遙測，因此先採本機可驗證指標；正式目標值需在可觀測性完成後確認。

| 指標 | v1 驗收基準 | 後續目標 |
|---|---|---|
| 自動化測試 | Phase 7 歷史基線 133；Launcher test 加入後 proxy-free 134/134 | Main branch 及一般 release 環境 100% 通過 |
| 來源隔離 | 測試證明單一來源失敗不影響其他來源 | 每來源成功率與連續失敗可查 |
| 重複通知 | 相同事件具 cooldown／dedup 測試 | 重複通知率可量測且趨近 0 |
| 資料完整性 | SQLite integrity `ok`、0 FK orphan 為發布閘門 | 每次 release 與 restore 自動記錄證據 |
| 資料新鮮度 | fresh／stale／archived 行為有測試 | UI 顯示各來源 freshness SLO |
| 恢復能力 | 備份、還原、rollback、transfer 有自動化測試 | 定期 restore drill 有紀錄 |
| 消費者安裝 | Installer candidate 已存在 | Clean Windows GUI install／launch／upgrade 成功率 100% |
| 錯誤可處理性 | 現況為純文字、部分隱藏 | 發布閘門涵蓋的 failure 100% 顯示 catalogued code |
| 更新同意 | 有安全 update foundation | 0 次未確認下載／安裝；成功與 rollback 路徑皆通過 |
| Support intake | 尚無 remote／Issues URL | Issue Form end-to-end 通知測試通過 |

## 9. 依賴與限制

- Node.js 22+；開發基線曾在 Node.js 25 驗證。
- `node:sqlite`、`cheerio`、`playwright-core`；browser Connector 依賴已安裝的 system Chrome。
- 正式商店頁與第三方 API 可用性不受本專案控制。
- Takara Tomy Mall 真實 Discovery 受 Queue-it 外部狀態限制；不得繞過。
- 公開 Windows 發布依賴 Authenticode、HTTPS 發布站、Ed25519 金鑰治理及乾淨 VM 驗收。
- X 社群來源依賴使用者自己的 Developer Project、費用同意及可用額度；預設停用且 budget 為 0。

## 10. 開放決策

- 公開 GitHub repository 名稱／URL、Release URL、triage owner，以及誰持有簽章憑證與 Ed25519 離線私鑰。
- 可觀測性要只留本機，或提供明確 opt-in 的外部監控。
- 是否需要跨裝置同步；若需要，必須先完成 threat model 與資料所有權設計。
- 是否開放一般使用者編輯進階 Recipe selector。
