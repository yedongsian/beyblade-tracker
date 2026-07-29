# Operations Runbook — Beyblade Tracker

> 狀態：Active
> 適用版本：1.0.0／schema 10
> 最後更新：2026-07-29

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

自動處理：

1. 執行 `npm test`；`scripts/run-tests.js` 會保留現有 proxy 設定，合併既有 `NO_PROXY`，並只加入 `127.0.0.1,localhost,::1`。
2. runner 以隔離的 child process 執行測試，不修改 shell、使用者或系統環境。
3. 若仍出現 proxy 403，只讀檢查 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 與 npm proxy 設定；不要把含帳密的 proxy URL 貼進文件。
4. 若 loopback 已 bypass 仍失敗，依第一個 application stack／assertion 建立 Bug Ticket。

2026-07-29 驗收：Windows／Node v25.7.0、ambient proxy variables 存在且 `NO_PROXY` 原為空值；一般 `npm test` 通過 139/139。修正追蹤於 `BT-P1-001`。

## 13. Windows release procedure

### Launcher error verification

以隔離的測試安裝目錄分別製造 `current.json` 缺失、runtime 缺失、service failure 與 health timeout。每個 hidden Launcher 路徑都必須顯示 native dialog，包含固定 `BT-LCH-*` code、繁中 recovery、「複製錯誤資訊」與「問題回報」。複製內容只能含 code、App version、UTC 與 safe support reference；不得附完整 path、stack、Token、Webhook 或 URL。完成時記錄 code 與測試結果，不要保存使用者資料。

### Build

```powershell
npm test
npm run config:check
npm run release:windows
npm run test:release:windows
```

Windows Launcher 含繁中文案，`release/windows/launcher.ps1` 必須保持為 UTF-8 with BOM，讓系統內建的 Windows PowerShell 5.1 正確解析。Build／review 時確認檔案開頭 bytes 為 `EF BB BF`；不得由 formatter 或 editor 移除 BOM。

### Release gate

- Version、schema、CHANGELOG 一致。
- Test 100% 通過；DB integrity `ok`、0 FK orphan。
- Installer payload 含 bundled Node 與必要發佈文件。
- Windows PowerShell 5.1 執行 Launcher 時，繁中錯誤、狀態提示及匯入／匯出對話框文字無亂碼。
- HTTPS installer URL、SHA-256、Ed25519 signature 驗證成功，`publishReady=true`。
- Setup.exe 已 Authenticode sign 且 signature 可驗證。
- 一般使用者由雙擊 Setup.exe 到首次開啟管理頁不需 PowerShell 或開發工具。
- Installer／Launcher／Update failure 顯示 [Error Code Catalog](ERROR_CODES.md) 中的固定代碼與 recovery。
- Update check 不會自動下載；只有使用者確認指定版本與 manifest 後才開始下載及安裝。
- User Guide、Error Code Catalog 與正式 GitHub Issues URL 已納入 release payload／App。
- Clean Windows VM 完成 install、first run、startup、update、migration、rollback、transfer、uninstall、data retention、SmartScreen。
- Release owner 與 rollback owner 確認 Go。

目前缺少公開簽章／hosting／clean VM final acceptance，因此不得把現有 artifact 標為公開 production release。

## 14. Rollback

Rollback 前先停止 service 並備份。使用：

```powershell
npm run update:rollback
```

驗證 current version pointer、pre-update DB restore、schema compatibility、health、source counts 與 UI。若新 migration 不可逆，必須使用 release 前 DB backup，不可只切換 binary。

### Update defer and rollback recovery

1. A deferred verified update may be resumed in Settings without downloading.
2. Retain the last verified manifest after a transient scheduled-check failure and retry in five minutes.
3. Treat rollback as complete only after the previous service starts; handle `BT-UPD-007` before any stale `BT-UPD-006` marker.
4. Do not clear a previous rollback failure until the next update has fully prepared its verified installer, backup, rollback record, and pending health marker. A failed download, validation, hash, or backup step must retain it.
5. A manual update-check error must preserve the last verified result and timestamp. Settings may safely resume an active apply from the status summary after reload; no file locations or URLs appear in that summary.

### Update consent 與健康檢查

1. Update check 只讀 signed stable manifest；不會下載 installer。
2. 使用者先檢視 target version、release notes、publisher、size 與 manifest digest，再選擇「稍後更新」或「下載並安裝」。
3. 確認必須綁定該 target version 與 manifest digest；manifest 變更後要求重新確認。
4. 下載完成並驗證 SHA-256 後才建立 update 前 backup、啟動 installer 與寫入 rollback record。
5. 新版服務啟動後檢查 target version 與 SQLite integrity。健康結果一旦寫入即保持不變；失敗顯示 `BT-UPD-006`，並依既有 rollback procedure 回復。
6. Web rollback 會先接受請求並安全停止服務，之後由外部 rollback runner 還原資料與 version pointer；不得在仍開啟 Tracker DB 的 Web process 中直接執行還原。
7. 不在 Ticket、Issue 或 log 分享 manifest URL、backup 位置、簽章資料或完整診斷資料。
8. 若 Settings 顯示 `BT-UPD-006`，使用者可選擇回滾；rollback runner 的結果會保存在安全狀態摘要中。若結果為 `BT-UPD-007`，重新開啟 Tracker 後查看 Settings，再依既有 backup procedure 處理。
9. Windows release candidate 至少執行 `npm run release:windows` 與 `npm run test:release:windows`。後者以隔離資料目錄驗證 silent install、服務啟動、packaged health、同步 stop、uninstall 與 user-data preservation；Inno Setup 自清理最多等待 60 秒，逾時即視為驗收失敗。

## 15. GitHub Support operations

公開 repository 建立後，Repository Owner 執行：

1. 啟用 Issues，加入繁中 Issue Form 與 privacy checkbox，關閉 blank issues。
2. 設定 labels 與 triage owner。
3. 在 repository 右上選 `Watch → Custom → Issues`。
4. 在 GitHub `Settings → Notifications` 啟用 `On GitHub` 與 `Email`，確認接收信箱已驗證。
5. 使用第二個一般帳號送出測試 Issue，驗證 owner 收到通知；owner 回覆後再驗證 reporter 收到通知。
6. 把 repository、Issues、Releases URL 填入 [Support Spec](SUPPORT.md)、[User Guide](USER_GUIDE.md) 與 App 設定。

日常 triage：

- 一個工作日內確認收到。
- 先判斷 data loss、secret exposure、unauthorized network 或 update integrity；符合條件時升級 Incident。
- 以 error code、App／Windows version、safe support reference 與使用者步驟重現。
- 不在 public Issue 要求 `.env`、Token、Webhook、DB、transfer bundle、full logs 或 private URLs。
- 可重現問題連結正式 `BT-*` Ticket；修復發布後回覆 fixed version 與 verification 再關閉。

GitHub 是否寄 Email 由個人 notification delivery 設定決定；只建立 repository 或 Issue Form 不足以保證寄信。

## 16. Incident handling

符合以下任一條件即開 incident：資料遺失／損壞、秘密外洩、未授權外部請求、重複大量通知、全部來源長時間失效、更新導致無法啟動或錯誤顯示 stale stock 為 fresh purchasable。

順序：

1. 保護使用者與資料：pause network／stop service／保存 backup。
2. 記錄 UTC timeline、version、schema、影響與已採取動作。
3. 不破壞原始 evidence；不在未備份前直接修改 DB。
4. 恢復最小安全服務。
5. 建立 Ticket，並依 [Post-mortem](POST_MORTEM.md) 在五個工作日內完成檢討。

## 17. 日常維護週期

| 頻率 | 工作 |
|---|---|
| 每次使用／變更後 | Health、source failures、pending queue、freshness。 |
| 每週 | 檢查連續失敗、stale／archived 異常、backup 是否持續產生。 |
| 每月 | Restore drill、retention、dependency／source policy review、X budget 保持符合預期。 |
| 每次 release | Full tests、schema／DB integrity、clean install／upgrade／rollback、docs／CHANGELOG。 |
