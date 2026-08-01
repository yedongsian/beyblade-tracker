# Beyblade 商品追蹤器（Beyblade Tracker）

Beyblade Tracker 是一個 Windows 優先的本機商品追蹤工具，定期讀取使用者核准的公開商店頁面，合併同一 Beyblade 商品的不同刊登，保存價格／庫存歷史，並在新品、預購、現貨、補貨或價格變動時通知使用者。

目前版本：`1.0.0`；SQLite schema：`10`。

> **非官方專案聲明：** 本專案是獨立開發的非官方工具，與 Takara Tomy、Hasbro 或其他 Beyblade 品牌權利人沒有隸屬、授權或代言關係。Beyblade 及相關商標屬各自權利人所有。

## 產品邊界

- 只讀公開頁面，不登入、不自動購買。
- 不繞過 CAPTCHA、Queue-it、付費牆、robots 或反自動化限制。
- 不宣稱覆蓋全網。
- 官方公告、商店 Offer 與社群線索分層保存；社群線索不會直接成為庫存事實。
- 預設為 single-user、local-first，不含雲端同步或外部遙測。

## 主要能力

- Fixture、JSON-LD／HTML、system Chrome Connector。
- Product／Offer 分離與可解釋的 barcode／SKU／model／variant identity。
- `coming_soon`、`preorder`、`in_stock`、`out_of_stock`、`unknown` 狀態。
- Observation timeline、Event、fresh／stale／archived lifecycle、通知彙整與去重。
- 安全來源預覽、Site／Seed URL、bounded Discovery、Review Queue。
- 繁中／日文／英文 UI、Catalog、Watchlist、官方與社群情報。
- Product split／merge、exclusion review 與 audit trail。
- Network kill switch、health、備份／還原、transfer、diagnostics、update／rollback。
- Console、Telegram、Discord 通知；Windows Telegram secret 使用 DPAPI CurrentUser。

## 快速開始

### Windows 安裝版

執行 `BeybladeTracker-1.0.0-Setup.exe`，再由開始功能表啟動並開啟：

<http://127.0.0.1:8787>

安裝與移機參閱 [INSTALL.md](INSTALL.md)，常見問題參閱 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。目前 installer 是 release candidate；公開簽章、HTTPS release channel 與 clean Windows SmartScreen 驗收尚未完成。

### 原始碼開發

需求：Node.js 22+；Browser Connector 另需 system Chrome。

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run config:check
npm test
```

`.env` 與外部通知皆為選填。正式 `config/sources.json` 不應被 example file 覆蓋。

## 日常控制

可雙擊根目錄的 `start_tracker.cmd`、`restart_tracker.cmd`、`stop_tracker.cmd`、`status_tracker.cmd`，或使用：

```powershell
npm run start:tracker
npm run status:tracker
npm run restart:tracker
npm run stop:tracker
```

開發與維運命令：

```powershell
npm run crawl:once
npm run worker
npm run web
npm run health
npm run config:check
npm run db:backup
npm test
```

日常請使用 managed service，不要同時啟動多份 worker。

## Local Web App

| Path | 用途 |
|---|---|
| `/` | Overview 與 health |
| `/products`、`/products/:id` | Product、Offer、price／stock timeline、identity review |
| `/offers`、`/events` | 刊登與事件 |
| `/catalog` | Catalog、aliases、parts、terminology review |
| `/watchlist` | Watchlist、alerts、official preview |
| `/community` | Unverified community clues |
| `/review`、`/exclusions` | Candidate 與 listing exclusion review |
| `/sources` | Source、Discovery、network control |
| `/settings` | Language、notification、transfer、diagnostics、update |
| `/health` | JSON health endpoint |

## 資料與安全

- 開發預設 DB：`data/tracker.db`。
- Runtime／PID：`runtime/`；logs：`logs/`；backups：`backups/`。
- Raw observation summary／debug HTML 預設保留 72 小時。
- 自動 backup 預設每 24 小時，保留 30 天且最多 30 份。
- Token／Webhook 不寫入 DB；transfer／diagnostics 排除 credentials。
- 緊急停止所有 external acquisition／notification：在 `/sources` pause network；hard lock 可設 `NETWORK_ENABLED=0` 後 restart。

## 文件

Repository 的產品、工程與執行團隊文件入口是 [docs/README.md](docs/README.md)：

- [PRD](docs/PRD.md)
- [Roadmap](docs/ROADMAP.md)
- [Tech Spec](docs/TECH_SPEC.md)
- [API Spec](docs/API_SPEC.md)
- [Data Schema](docs/DATA_SCHEMA.md)
- [Runbook](docs/RUNBOOK.md)
- [使用教學](docs/USER_GUIDE.md)
- [錯誤代碼](docs/ERROR_CODES.md)
- [GitHub Support 設定](docs/SUPPORT.md)
- [Tickets](docs/TICKETS.md)
- [Post-mortem](docs/POST_MORTEM.md)
- [PR Description](docs/PR_DESCRIPTION.md)
- [CHANGELOG](docs/CHANGELOG.md)

Windows release package 另保留 `INSTALL.md`、`PRIVACY.md`、`SOURCE_POLICY.md`、`SOURCE_DEVELOPMENT.md`、`TROUBLESHOOTING.md`、`RELEASE_GUIDE.md` 作為隨產品交付的使用者文件。

問題回報請使用 [GitHub Issues 繁中表單](https://github.com/yedongsian/beyblade-tracker/issues/new/choose)。Issue 內容會公開，請勿上傳 Token、Webhook、`.env`、資料庫、移機檔、完整 log、private URL 或個人資料。

## 當前已知狀態

- Phase 0–7 已完成；未來工作以 `docs/TICKETS.md` 為準。
- Takara Tomy Mall 真實 Discovery 仍等待 Queue-it 自然解除。
- X community source 預設 disabled／zero budget，未經使用者明確費用同意不啟用。
- 2026-07-28 設定檢查通過（3 sources），service 為 stopped。
- `npm test` 會保留外部 proxy 設定，只在測試子程序以 `NO_PROXY` bypass loopback。ambient proxy 環境的完整 suite 目前基線為 **219/219**（2026-08-02）；修正當時的驗收數字為 139/139（`BT-P1-001`）。
- 下一公開版本已核准雙擊安裝驗收、固定錯誤代碼、使用者確認後更新及公開 GitHub Issue Form。固定錯誤代碼（`BT-UX-002`）、使用者確認後更新（`BT-UPD-001`）與 GitHub Issue Form（`BT-SUP-001`）已實作，狀態為 `In Review`，尚待簽章 release channel、乾淨 Windows VM 與通知 end-to-end 等外部驗收；雙擊安裝驗收（`BT-UX-001`）仍待執行。
