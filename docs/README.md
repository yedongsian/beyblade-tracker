# Beyblade Tracker 文件中心

> 文件狀態：Active
> 文件負責人：Project Owner／PM
> 最後盤點：2026-07-28
> 目前產品版本：1.0.0
> 目前資料庫版本：schema 10

本目錄是執行團隊、維運人員與後續 AI 協作者的主要文件入口。文件以繁體中文為主，保留英文技術名稱、程式識別字與 API path。

## 閱讀順序

| 角色／情境 | 建議先讀 |
|---|---|
| 一般安裝使用者 | [使用教學](USER_GUIDE.md) → [錯誤代碼](ERROR_CODES.md) |
| 新加入的產品或工程成員 | [PRD](PRD.md) → [Roadmap](ROADMAP.md) → [Tech Spec](TECH_SPEC.md) |
| 要接手開發 | [Tech Spec](TECH_SPEC.md) → [API Spec](API_SPEC.md) → [Data Schema](DATA_SCHEMA.md) → [Tickets](TICKETS.md) |
| 要部署、維運或排障 | [Runbook](RUNBOOK.md) → [Post-mortem](POST_MORTEM.md) |
| 要提交變更 | [PR Description](PR_DESCRIPTION.md) → [CHANGELOG](CHANGELOG.md) |
| 要驗收團隊成果 | [PRD](PRD.md) 的成功指標與非功能需求 → Ticket 驗收條件 → Runbook 驗證程序 |

## 正式文件

| 文件 | 用途 | 更新時機 |
|---|---|---|
| [PRD](PRD.md) | 產品目標、使用者、範圍、需求及成功指標 | 產品方向或範圍改變時 |
| [Roadmap](ROADMAP.md) | 已完成基線、後續階段、依賴與發布閘門 | 優先順序或里程碑改變時 |
| [Tech Spec](TECH_SPEC.md) | 架構、元件、資料流、安全與技術決策 | 架構或重要行為改變時 |
| [API Spec](API_SPEC.md) | Local Web API 契約 | 路由、request、response 或安全規則改變時 |
| [Data Schema](DATA_SCHEMA.md) | SQLite schema、關聯、狀態與 migration 規則 | migration 或資料生命週期改變時 |
| [Runbook](RUNBOOK.md) | 安裝、啟停、備份、還原、發布與故障處理 | 操作程序或告警條件改變時 |
| [使用教學](USER_GUIDE.md) | 一般使用者的安裝、主要功能、更新與問題回報 | 使用流程或公開發布資訊改變時 |
| [錯誤代碼](ERROR_CODES.md) | 穩定 user-facing error code contract 與自助處理 | 新增或調整錯誤處理時 |
| [Support Spec](SUPPORT.md) | GitHub Issue Form、通知與維護者 triage | Support channel 或表單改變時 |
| [Tickets](TICKETS.md) | 唯一正式 backlog 與驗收條件 | 工作建立、執行、阻塞或驗收時 |
| [Post-mortem](POST_MORTEM.md) | 事故制度、索引與模板 | 事故結案後五個工作日內 |
| [PR Description](PR_DESCRIPTION.md) | PR 描述與驗收交接模板 | 模板欄位或交付流程改變時 |
| [CHANGELOG](CHANGELOG.md) | 使用者可感知及重大工程變更 | 每次 release 或重要合併時 |

## 文件治理規則

1. **事實優先。** 已實作能力須能由程式、測試、migration、設定或 Git 歷史證實；無法證實的內容標為 Proposed、Assumption 或待確認。
2. **單一來源。** Roadmap 與 backlog 分別只維護於 `docs/ROADMAP.md` 和 `docs/TICKETS.md`。根目錄舊文件只保留導向說明。
3. **完成定義。** Ticket 只有在實作、測試、文件、驗收證據均完成後才能標為 Done；已寫程式但未通過驗收不得標為完成。
4. **狀態一致。** PRD 說明「為何與做什麼」，Tech Spec 說明「如何運作」，Roadmap 說明「何時做」，Ticket 說明「誰要交付什麼」。不要在四處維護同一份細節。
5. **敏感資料。** 文件不得包含 Token、Webhook、私鑰、完整使用者資料、可識別的診斷資料或付費帳務憑證。
6. **變更連動。** API 或 schema 變更必須同步更新 API Spec／Data Schema、Ticket、測試與 CHANGELOG；維運行為改變必須同步 Runbook。
7. **時間格式。** 文件日期使用 `YYYY-MM-DD`；系統 timestamp 使用 ISO-8601 UTC。
8. **保留歷史。** 不重寫已發布版本的 CHANGELOG；重大決策、事件與驗收結果以日期和證據保存。

## 根目錄文件的例外

Windows release builder 目前會把 `README.md`、`INSTALL.md`、`PRIVACY.md`、`SOURCE_POLICY.md`、`SOURCE_DEVELOPMENT.md`、`TROUBLESHOOTING.md` 與 `RELEASE_GUIDE.md` 放入安裝包。這些檔案是使用者隨產品取得的發佈文件；團隊規劃、規格與 backlog 仍以本目錄為準。

## 當前證據基線

- Git 最新完成基線：`51652dc`（2026-07-18，Phase 7 release and hardening）。
- 工作樹在本次文件整理前已有一項使用者修改：`ROADMAP.md` 新增 Phase 7 後暫停點；已合併至新 Roadmap，不視為本次新產品決策。
- `npm run config:check`：2026-07-28 通過，3 個來源。
- `npm run status:tracker`：2026-07-28 顯示服務已停止。
- `npm test`：Launcher regression test 加入後完整 suite 為 134 項；proxy-free child process 已通過 134/134。一般 shell 仍有 11 項 Local Web 測試受環境 HTTP Proxy 對 localhost 回傳 403 影響，追蹤於 `BT-P1-001`。
