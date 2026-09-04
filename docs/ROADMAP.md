# Beyblade Tracker Roadmap

> 狀態：Active
> 更新日期：2026-09-04
> 規劃原則：每一階段獨立驗收；未通過發布閘門不得以「程式已完成」取代實際驗收。
> 目前驗證基線：`main` 於 2026-09-04 執行 `npm test` 通過 **288/288**（0 fail／0 skip／0 todo）。下表「已完成里程碑」保留各階段當時的歷史數字，不以目前基線回頭改寫。

## 1. 現況摘要

**公開發佈閘門已通過。** v1.0.7 為正式版，更新鏈於 2026-09-04 在乾淨 Windows VM 上完整驗證
（1.0.4 → 1.0.5，全程未設任何環境變數；原始輸出見 [`acceptance-evidence/`](acceptance-evidence/)）。
使用教學自 1.0.7 起隨產物出貨。

**唯一未完成的發佈條件是程式碼簽章憑證**（`BT-UX-001`）。在購買並簽署之前，
每一位新使用者第一次安裝都會遇到 SmartScreen 警告 —— 而那發生在他看到任何功能之前。
這是花錢而非寫程式能解決的項目。

Takara 實站驗收、X 付費 API 啟用與跨裝置同步仍不是已核准實作。

## 2. 已完成里程碑

| 階段 | 日期 | 交付內容 | 主要證據 |
|---|---|---|---|
| Phase 0–1 | 2026-07-16 | migration、備份／還原、執行資料分離、Connector 契約、來源安全預覽、Site／Seed 管理、首次導覽及基礎 Web UI | `689c181`；schema 3；62 Node tests；7 Web smoke routes |
| Phase 2 | 2026-07-16 | 受控 Discovery、robots／Sitemap、Crawl Frontier、Recipe、Review Queue | `de77719`、`d42a293`；schema 4；Takara fixture 驗收 |
| Phase 3–5 | 2026-07-16 | 三語 UI、Catalog、詞彙審核、freshness scheduler、Watchlist、官方 Registry／公告 | `7b22537`；schema 5–7 |
| Phase 6 | 2026-07-16 | 社群來源 Registry、未驗證線索、去重、Watchlist match、過濾與 retention | `b709f0e`；schema 8 |
| Phase 7 | 2026-07-18 | SKU／variant hardening、排除與身分 audit、network control、HTTP／通知 resilience、Windows 安裝／更新／rollback／transfer／diagnostics | `51652dc`；schema 9–10；歷史基線 133 Node tests、16 Web routes |
| Launcher encoding fix | 2026-07-28 | Windows PowerShell 5.1 Launcher 改為 UTF-8 with BOM，新增 byte-level regression test | `BT-P1-003`；commit `d23319d` |

### 不可誤標為完成的項目

- Takara Tomy Mall 真實分類頁仍受 Queue-it 阻擋；目前只有 fixture acceptance。
- Windows installer 已建立 release candidate，但公開簽章、HTTPS release channel、線上更新與 SmartScreen 驗收尚未完成。
- X `@bey_sokuhou` Registry 與 UI 已完成，但 API 存取預設為 `user_setup_required`／disabled／zero budget。

## 3. 下一階段（2026-09-04 起）

> R0 與 R1 的完成條件已全數達成，只剩 `BT-UX-001` 的簽章憑證。下列是接下來的優先順序；
> **backlog 本身仍統一維護於 [`TICKETS.md`](TICKETS.md)**，本節只決定順序與理由。

### 建議順序

| # | 項目 | 為什麼是這個順序 |
| --- | --- | --- |
| 1 | **先讓真人使用** | 真實使用會告訴你哪些 P2 其實是 P0。現在排序只是猜測，而且我們已經看過猜錯的代價：`BT-UPD-002` 這個「使用者根本收不到更新」的 P0，是在寫驗收步驟時偶然發現的，不是排出來的。 |
| 2 | **`BT-UX-002`（P0）D-8 剩下的路徑** | 可預期的錯誤仍被報成「未預期的內部錯誤 `BT-LCH-999`」。當時只修了冷卻與探索守門。純本機工作，不影響別人試用。 |
| 3 | `BT-UX-003`（P1） | recipe 行三語化未實機複驗；「dns 建議語在單純斷網時誤導」。 |
| 4 | `BT-UX-001` 簽章憑證 | 等確定要給更多人用再買。OV 一年約 200–400 美元且需累積下載信譽，EV 較貴但立即消除警告。 |
| 5 | `BT-UX-005`、`BT-UX-007`、`BT-API-001`（P2） | 沒有實際痛點驅動，等回饋。`BT-UX-007`（更新後是否開放回滾入口）是**產品決策**，不是缺陷。 |
| — | `BT-P2-001~003`、`BT-FUT-*` | 效能與未來範圍，等有實際痛點再排。 |

### 判斷新回饋要不要插隊

這幾天的驗收裡，真正昂貴的缺陷都不是「功能壞掉」，而是**畫面說了不真的話**。
`BT-UX-008`（收不到更新卻說「已是最新版本」）與 `BT-UX-009`（更新成功卻說「Failed to fetch」）
都屬於這一類，而 `BT-UX-008` 更是讓 `BT-UPD-002` 潛伏了好幾個版本的幫兇。

收到新回饋時，依序問：

1. **它會不會讓使用者相信一件不真的事？** 會的話最優先。使用者不會回報他不知道存在的問題 ——
   一個說謊的畫面同時造成損害並掩蓋損害。
2. **使用者能不能自己察覺出了問題？** 無聲失敗優先於吵鬧的失敗。
   會跳錯誤代碼的問題至少看得見，也回報得出來。
3. **有沒有繞道？** 有繞道（例如按 F5、重開）就降一級，但要記進工單，別當作沒事。
4. **是第一次使用還是長期使用？** 第一次使用的障礙優先 —— 撞到的人會直接放棄，而且不會告訴你。
   SmartScreen 警告就是這一類。

### 排序時容易犯的錯

- **把「畫面看起來正常」當成通過。** 2026-09-04 的 `BT-UPD-002` 驗證第一次就是這樣誤判的：
  版本號、狀態文字全都正確，只有 `/health` 回報的更新來源不對。**判準要放在伺服器端的事實上。**
- **一個 bug 會擋住另一個 bug。** `BT-UX-006` 在 `BT-REL-001` 修好之前不可能被看見，
  因為在此之前從來沒有一次更新真正完成過。修掉一個之後，要重新檢視它原本遮住了什麼。

## 4. 已完成階段的原始規劃（保留）

> 以下是 R0～R3 當初的完成條件，保留作為驗收依據的出處。
> R0 與 R1 已於 2026-09-04 全數達成（僅餘 `BT-UX-001` 的簽章憑證）；
> 目前的優先順序見上一節。

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

## 5. 外部條件完成後再執行

### Takara 真實 Discovery 驗收

- Queue-it 自然解除後，使用真實公開分類頁完成 Discovery、Review Queue approve 與 monitor 驗收。
- 不使用 bypass、登入、人工代解 CAPTCHA 或其他規避方式。
- 將驗收日期、頁面範圍、request budget 與結果記入 Ticket。

### X 社群來源啟用

- 只有在使用者接受當時費用、提供自己的 Developer Project 並明確設定 monthly budget 後才可啟用。
- 實作前必須重新查核官方 API 價格與條款，不沿用 2026-07-16 的價格假設。
- HTML scraping 不得作為繞過 API／平台限制的備援。

## 6. 未來選配範圍

- 跨裝置同步：先做 threat model、資料所有權、帳號／權限、encryption、conflict resolution，再決定是否開發。
- 使用者自訂進階 Recipe selector：需提供 preview、validation、versioning、rollback 與安全 budget。
- 更多通知 channel 或 connector：必須遵守現有 contract、secret handling、source policy 與 failure isolation。

## 7. Roadmap 變更規則

1. Roadmap 項目進入執行前，先在 [Tickets](TICKETS.md) 建立可驗收工作。
2. 產品範圍改變時同步更新 [PRD](PRD.md)。
3. 架構或資料契約改變時同步更新 [Tech Spec](TECH_SPEC.md)、[API Spec](API_SPEC.md) 或 [Data Schema](DATA_SCHEMA.md)。
4. 完成後必須更新 CHANGELOG；重大故障則依 [Post-mortem](POST_MORTEM.md) 流程處理。
