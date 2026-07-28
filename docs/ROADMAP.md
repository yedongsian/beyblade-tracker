# Beyblade Tracker Roadmap

> 狀態：Active
> 更新日期：2026-07-28
> 規劃原則：每一階段獨立驗收；未通過發布閘門不得以「程式已完成」取代實際驗收。

## 1. 現況摘要

Phase 0–7 與既有技術債清理已完成。2026-07-28 已核准「一般使用者易用性與安全更新」方向；下一階段先完成雙擊安裝驗收、可見錯誤代碼、使用者確認更新、使用教學及 GitHub Support，再進入公開發佈閘門。Takara 實站驗收、X 付費 API 啟用與跨裝置同步仍不是已核准實作。

## 2. 已完成里程碑

| 階段 | 日期 | 交付內容 | 主要證據 |
|---|---|---|---|
| Phase 0–1 | 2026-07-16 | migration、備份／還原、執行資料分離、Connector 契約、來源安全預覽、Site／Seed 管理、首次導覽及基礎 Web UI | `689c181`；schema 3；62 Node tests；7 Web smoke routes |
| Phase 2 | 2026-07-16 | 受控 Discovery、robots／Sitemap、Crawl Frontier、Recipe、Review Queue | `de77719`、`d42a293`；schema 4；Takara fixture 驗收 |
| Phase 3–5 | 2026-07-16 | 三語 UI、Catalog、詞彙審核、freshness scheduler、Watchlist、官方 Registry／公告 | `7b22537`；schema 5–7 |
| Phase 6 | 2026-07-16 | 社群來源 Registry、未驗證線索、去重、Watchlist match、過濾與 retention | `b709f0e`；schema 8 |
| Phase 7 | 2026-07-18 | SKU／variant hardening、排除與身分 audit、network control、HTTP／通知 resilience、Windows 安裝／更新／rollback／transfer／diagnostics | `51652dc`；schema 9–10；歷史基線 133 Node tests、16 Web routes |
| Launcher encoding fix | 2026-07-28 | Windows PowerShell 5.1 Launcher 改為 UTF-8 with BOM，新增 byte-level regression test | `BT-P1-003`；待與目前工作樹一併 commit |

### 不可誤標為完成的項目

- Takara Tomy Mall 真實分類頁仍受 Queue-it 阻擋；目前只有 fixture acceptance。
- Windows installer 已建立 release candidate，但公開簽章、HTTPS release channel、線上更新與 SmartScreen 驗收尚未完成。
- X `@bey_sokuhou` Registry 與 UI 已完成，但 API 存取預設為 `user_setup_required`／disabled／zero budget。

## 3. 建議執行順序

### R0 — P0 一般使用者易用性與 Support

目標：讓沒有開發經驗的使用者能安裝、啟動、理解錯誤、確認更新並完成問題回報。

- 驗證正式 Setup.exe 雙擊安裝、GUI first run、捷徑啟動與保留資料重裝；正常流程不使用 PowerShell 指令。
- 建立中央錯誤代碼 Registry，讓 hidden Launcher、Installer、Update 與核心資料錯誤顯示繁中 modal、recovery、copy 與 report actions。
- 實作啟動後及每 24 小時 stable channel check；顯示 release notes，只有使用者確認後才下載及安裝。
- 把使用教學、錯誤代碼與 Support link 納入安裝包、App 及公開 repository。
- 建立公開 GitHub repository、繁中 Issue Form、privacy warning、labels、watch Issues 與 Email notification。
- 完成一般使用者帳號與 maintainer 帳號的 Issue notification end-to-end 測試。

完成條件：`BT-UX-001`、`BT-UX-002`、`BT-UPD-001`、`BT-SUP-001`、`BT-DOC-002` 完成，且 clean Windows usability acceptance 通過。

### R1 — P0 公開發佈閘門

目標：在 R0 完成後，把現有 Windows release candidate 轉成可公開下載、可驗證、可更新及可回滾的正式版本。

- 取得並安全保管 Windows Authenticode 程式碼簽章憑證。
- 建立 HTTPS installer／manifest 發佈站與正式 release channel。
- 離線產生及保管 Ed25519 私鑰，將公鑰寫入正式 release 設定；私鑰不得提交 Git。
- 簽署 Setup.exe 與 manifest，驗證 SHA-256、manifest signature 與 Windows file signature。
- 在全新 Windows VM／測試機驗證安裝、首次設定、自動啟動、更新、migration、rollback、transfer、解除安裝及 SmartScreen。
- 完成發布 Go／No-Go checklist 與 rollback owner。

完成條件：所有驗收證據附於 Ticket／PR，且不存在未接受的 P0 blocker。

### R2 — P1 可觀測性

目標：不依賴外部遙測，也能由 Local Web App 與結構化日誌判斷服務、來源、解析與通知健康度。

- 統一 service、source、parser、notification、update 的 structured log schema。
- 顯示來源成功率、連續失敗、解析失敗率、最後成功與下一次執行時間。
- 顯示待送／失敗通知、queue length、stale／archived Offer 數量。
- 建立本機 operations／health page 與可匯出的低敏感度診斷摘要。
- 定義 freshness、source health、notification delivery 的本機 SLO 與告警門檻。

完成條件：Runbook 能只靠本機資料定位常見故障；預設仍不向外部服務上傳遙測。

### R3 — P2 效能與資源控制

目標：在不犧牲資料新鮮度與來源禮貌性的前提下，降低不必要網路與 browser 成本。

- 加入 ETag／Last-Modified 條件式 HTTP 請求與有界 cache。
- 建立 Chrome browser pool 與 concurrency 上限。
- 為 Discovery、Monitor、Notification queue 加入 backpressure、priority 及資源上限。
- 建立 cold／warm crawl、記憶體、CPU、network bytes 與 browser 啟動數基準。

完成條件：基準可重現，優化前後數據可比較，且 robots、rate limit、source isolation 測試不退化。

## 4. 外部條件完成後再執行

### Takara 真實 Discovery 驗收

- Queue-it 自然解除後，使用真實公開分類頁完成 Discovery、Review Queue approve 與 monitor 驗收。
- 不使用 bypass、登入、人工代解 CAPTCHA 或其他規避方式。
- 將驗收日期、頁面範圍、request budget 與結果記入 Ticket。

### X 社群來源啟用

- 只有在使用者接受當時費用、提供自己的 Developer Project 並明確設定 monthly budget 後才可啟用。
- 實作前必須重新查核官方 API 價格與條款，不沿用 2026-07-16 的價格假設。
- HTML scraping 不得作為繞過 API／平台限制的備援。

## 5. 未來選配範圍

- 跨裝置同步：先做 threat model、資料所有權、帳號／權限、encryption、conflict resolution，再決定是否開發。
- 使用者自訂進階 Recipe selector：需提供 preview、validation、versioning、rollback 與安全 budget。
- 更多通知 channel 或 connector：必須遵守現有 contract、secret handling、source policy 與 failure isolation。

## 6. Roadmap 變更規則

1. Roadmap 項目進入執行前，先在 [Tickets](TICKETS.md) 建立可驗收工作。
2. 產品範圍改變時同步更新 [PRD](PRD.md)。
3. 架構或資料契約改變時同步更新 [Tech Spec](TECH_SPEC.md)、[API Spec](API_SPEC.md) 或 [Data Schema](DATA_SCHEMA.md)。
4. 完成後必須更新 CHANGELOG；重大故障則依 [Post-mortem](POST_MORTEM.md) 流程處理。
