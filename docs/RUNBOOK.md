# Operations Runbook — Beyblade Tracker

> 狀態：Active
> 適用版本：1.0.0／schema 10
> 最後更新：2026-07-28

## 1. 服務摘要

| 項目 | 值 |
|---|---|
| 服務類型 | Single-user local Windows service／source development CLI |
| Web | `http://127.0.0.1:8787` |
| Database | `data/tracker.db`（安裝版依 user data layout） |
| Config | `.env`、`config/sources.json` 或安裝版 user sources path |
| Runtime | `runtime/`：PID、status、stop request、debug |
| Logs | `logs/tracker.log` |
| Backups | `backups/` |
| Health | `GET /health` 或 `npm run health` |
| Owner | Project Owner；公開發布前需指定 release owner 與 rollback owner |

## 2. 安全操作原則

- 日常只用 `start_tracker.cmd`／`restart_tracker.cmd`／`stop_tracker.cmd`／`status_tracker.cmd` 或對應 npm script。
- 不以 Task Manager 批次終止所有 Node process；只管理本專案記錄的 PID。
- 還原、transfer import、update／rollback 前先建立備份；restore 前必須停止服務。
- 不把 `.env`、DPAPI secret file、signing key、Token、Webhook 或完整 log 貼到 Ticket／PR。
- 不繞過 CAPTCHA、Queue-it、robots、登入或付費牆。
- Network 異常或來源行為可疑時，先使用 `/sources` 的 network pause；必要時設 `NETWORK_ENABLED=0` 作 hard lock。

## 3. 安裝與首次啟動

### Windows 安裝版

1. 執行 `BeybladeTracker-1.0.0-Setup.exe`。
2. 依 per-user installer 完成安裝，不需另裝 Node.js。
3. 由 Start Menu 啟動 Beyblade Tracker。
4. 開啟 `http://127.0.0.1:8787`，完成語言、通知、掃描與 privacy／source policy 設定。
5. 在 `/sources` 確認來源狀態；未準備對外連線時先 pause network。
6. 執行 health check 並記錄 release、schema、source count 與 status。

目前安裝器是 release candidate；公開部署前仍需完成 [Roadmap R1](ROADMAP.md)。

### 原始碼開發環境

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run config:check
npm test
```

需求：Node.js 22+。Browser Connector 需要支援的 system Chrome。

## 4. 啟動、停止與狀態

```powershell
npm run start:tracker
npm run status:tracker
npm run restart:tracker
npm run stop:tracker
```

預期：

- Start 同時啟動 scheduler 與 Web UI；已啟動時不得重複啟動。
- Restart 等待目前 crawl 安全結束後重啟。
- Stop 只停止記錄的本專案 PID。
- Status 顯示 running／stopped、PID、最後與下一次 scan。

開發時可使用：

```powershell
npm run crawl:once
npm run worker
npm run web
npm run dev
node bin\crawl-once.js --source demo-fixture
```

不要同時以 service 與 `npm run worker` 啟動兩份排程器。

## 5. 標準健康檢查

```powershell
npm run config:check
npm run status:tracker
npm run health
```

並檢查：

1. `/health.status` 是 `ok`；若為 `degraded`，找出 `consecutiveFailures >= 3` 的 enabled source。
2. `network.enabled` 與預期一致。
3. Release version、schema version、browser detection 正確。
4. Enabled source、Product、Offer、pending notification／candidate count 無異常跳變。
5. `logs/tracker.log` 沒有連續相同 error；分享前必須再確認無敏感資訊。
6. 資料庫 integrity 為 `ok`，foreign key orphan 為 0（release／restore 時必做）。

2026-07-28 盤點狀態：config 有效、3 個來源、service stopped。這是盤點快照，不是持續狀態保證。

## 6. 來源操作

### 新增來源

1. 到 `/sources` 貼入公開 HTTP(S) URL。
2. 檢查 normalized URL、registrable domain、既有 Site warning、candidate 及 request budget。
3. 明確確認後才加入。
4. Product page 使用 monitor seed；category／home page 使用 discovery seed。
5. Test source；若有 candidate，至 `/review` 人工 approve／defer／exclude。

### 停用來源

在 `/sources` 選 Disable。此操作保留歷史 Product、Offer、Event、health 與 audit。API DELETE 也只做 disable。

### Source failure triage

1. 檢查 network control 與 DNS／Internet。
2. 檢查 last error、last success、consecutive failures。
3. 用 Test source 驗證 connector，不要立刻增加 retry frequency。
4. 若 HTTP source 可讀但 parser 為 0 items，檢查 JSON-LD／selector 是否失效。
5. Browser source 先確認 system Chrome detected、版本可用、頁面未出現 access restriction。
6. 遇到 CAPTCHA、Queue-it、登入或拒絕時停用／等待，不繞過。
7. Recipe 修復應建立 Ticket、fixture 與 regression test。

## 7. Network emergency pause

優先在 `/sources` 按 Pause network。需要無法由 UI 解除的 hard lock 時，在 `.env` 設定：

```text
NETWORK_ENABLED=0
```

然後 restart。Pause 行為：

- 停止 source acquisition、Discovery、update check 及 outbound notifications。
- 保留既有資料及 queued notifications，不將舊資料重新標為 fresh。
- 解除前記錄原因、影響時間與待驗證項目。

## 8. 備份

程式啟動正式 DB 前會檢查 backup policy。預設每 24 小時一致性備份，保留 30 天且最多 30 份。

手動備份不需停止服務：

```powershell
npm run db:backup
```

驗證：命令成功、backup file 存在、integrity `ok`、schema version 合理。重要 release／migration／restore 前另記錄 filename、size、timestamp 與 checksum。

## 9. 還原

```powershell
npm run stop:tracker
npm run db:restore -- --from backups\manual-YYYYMMDD-HHMMSSZ.db
npm run start:tracker
npm run health
```

Restore contract：

- Service PID 仍存活時拒絕 restore。
- 來源 backup 先做 integrity check。
- 現有 DB 先保存為 pre-restore backup。
- 舊 schema 透過正式 migration runner 升級。
- 完成後驗證 integrity、foreign keys、Product／Offer／Event counts、UI 與 source settings。

測試至另一個 path：

```powershell
npm run db:restore -- --from backups\manual-YYYYMMDD-HHMMSSZ.db --to C:\test\data\tracker.db
```

## 10. Transfer

- Export 產生 `.beyblade-transfer` gzip bundle，包含 DB、sources 與 hash manifest。
- Bundle 不含 Telegram／Discord credentials、DPAPI file、PID、status、logs、raw debug HTML。
- Import 先 stage 並驗證 hash，需 restart 才套用。

操作後檢查 schema、source count、Product／Offer counts、Watchlist、policy settings；通知憑證必須在新機重新設定。

## 11. Notification triage

1. 確認 network enabled。
2. 確認 channel 已設定；Windows Telegram 憑證屬 CurrentUser，換帳號／換機不可直接使用。
3. 由 Settings 執行 test notification。
4. 429：尊重 `Retry-After`，不要人工高頻重試。
5. Permanent 4xx：檢查 Token／chat／webhook，不進行無限 retry。
6. Timeout／5xx：檢查連線與服務狀態，保留 failed channel queue。
7. 驗證成功 channel 未因另一 channel 失敗而重送。

## 12. 測試故障：localhost 被 proxy 攔截

症狀：`test/web.test.js` 出現 `Proxy response (403) !== 200 when HTTP Tunneling`，而非應用 assertion failure。

處理：

1. 只讀檢查目前 shell 的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 與 npm proxy 設定；不要把含帳密的 proxy URL 貼進文件。
2. 確認 `NO_PROXY` 包含 `127.0.0.1,localhost,::1`，或在隔離的測試 process 明確 bypass loopback proxy。
3. 重跑 `npm test`；必須取得 133/133 才可判定 Web regression 已排除。
4. 若移除環境影響後仍失敗，才依第一個 application stack／assertion 建立 Bug Ticket。

此問題追蹤於 `BT-P1-001`；未經重驗不可把 2026-07-28 的 122/133 寫成產品通過。

## 13. Windows release procedure

### Build

```powershell
npm test
npm run config:check
npm run release:windows
npm run test:release:windows
```

### Release gate

- Version、schema、CHANGELOG 一致。
- Test 100% 通過；DB integrity `ok`、0 FK orphan。
- Installer payload 含 bundled Node 與必要發佈文件。
- HTTPS installer URL、SHA-256、Ed25519 signature 驗證成功，`publishReady=true`。
- Setup.exe 已 Authenticode sign 且 signature 可驗證。
- Clean Windows VM 完成 install、first run、startup、update、migration、rollback、transfer、uninstall、data retention、SmartScreen。
- Release owner 與 rollback owner 確認 Go。

目前缺少公開簽章／hosting／clean VM final acceptance，因此不得把現有 artifact 標為公開 production release。

## 14. Rollback

Rollback 前先停止 service 並備份。使用：

```powershell
npm run update:rollback
```

驗證 current version pointer、pre-update DB restore、schema compatibility、health、source counts 與 UI。若新 migration 不可逆，必須使用 release 前 DB backup，不可只切換 binary。

## 15. Incident handling

符合以下任一條件即開 incident：資料遺失／損壞、秘密外洩、未授權外部請求、重複大量通知、全部來源長時間失效、更新導致無法啟動或錯誤顯示 stale stock 為 fresh purchasable。

順序：

1. 保護使用者與資料：pause network／stop service／保存 backup。
2. 記錄 UTC timeline、version、schema、影響與已採取動作。
3. 不破壞原始 evidence；不在未備份前直接修改 DB。
4. 恢復最小安全服務。
5. 建立 Ticket，並依 [Post-mortem](POST_MORTEM.md) 在五個工作日內完成檢討。

## 16. 日常維護週期

| 頻率 | 工作 |
|---|---|
| 每次使用／變更後 | Health、source failures、pending queue、freshness。 |
| 每週 | 檢查連續失敗、stale／archived 異常、backup 是否持續產生。 |
| 每月 | Restore drill、retention、dependency／source policy review、X budget 保持符合預期。 |
| 每次 release | Full tests、schema／DB integrity、clean install／upgrade／rollback、docs／CHANGELOG。 |
