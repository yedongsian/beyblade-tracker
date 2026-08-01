# BT-UPD-001 剩餘修正指南

> 狀態：Implementation follow-up
> 對應分支基線：`codex/bt-upd-001`／`3b3b5b1`
> 建立日期：2026-07-29
> 範圍：只處理本文件列出的 update／rollback 狀態與 UI operation 問題；不包含正式 HTTPS hosting、Authenticode 或 clean Windows VM release gate。

## 1. 目的與完成條件

目前 `BT-UPD-001` 的主要流程已具備 signed manifest、明確同意、defer／resume、single-flight、下載驗證、backup、silent installer、post-update health 與 rollback handoff。完整測試在本基線為 152/152 通過，但 code review 仍確認五個邊界問題。

本輪完成時必須同時滿足：

1. 新 update preparation 失敗時，不會抹除既有 `BT-UPD-007` rollback failure。
2. 手動 update check 失敗時，保留最後一次已驗證結果及原本的 `lastCheckedAt`。
3. Scheduler 依「距離上次成功檢查還剩多久」安排下一次 timer，不會產生接近 48 小時的檢查空窗。
4. Settings 重新整理後能重新連接仍在執行的 update operation，且不會重新顯示可重複操作的按鈕。
5. Apply request 尚未回應時，重複點擊不會產生額外請求或多組 progress polling。
6. 新增的 regression tests、完整 `npm test`、設定檢查及 PowerShell parser 全部通過。

## 2. 建議實作順序

依下列順序修改，可降低狀態互相覆蓋造成的誤判：

1. 修正 rollback status 清除時機。
2. 統一 manual／scheduled check 的成功寫入規則。
3. 修正 scheduler 的 remaining-delay 計算。
4. 讓 server 提供 safe active-operation summary。
5. 讓 Settings 初始化、重新整理與 Apply click 共用同一套 operation state machine。
6. 補 regression tests，再執行完整驗證。

## 3. 可使用的工具與套件

本輪不需要新增 npm dependency。

| 用途 | 建議使用 |
|---|---|
| 檔案與 atomic status 操作 | Node.js built-in `node:fs`、`node:path` |
| Timer／clock 測試 | 現有 `setTimeoutImpl`、`clearTimeoutImpl` dependency injection；需要時新增 `nowImpl` |
| Unit／integration tests | Node.js built-in `node:test`、`node:assert/strict` |
| 暫存目錄與 fixture | `node:os.tmpdir()`、`mkdtempSync`、`Database(':memory:')` |
| Manifest fixture | `node:crypto` 的 `generateKeyPairSync`、`sign`、`createHash` |
| Local Web integration | 現有 `test/web.test.js`、`withServer`、Node `fetch` |
| 真實 UI／重新整理驗證 | 專案既有 `playwright-core` 與偵測到的 system Chrome；若 CI 沒有 Chrome，保留為 Windows E2E／manual gate |
| Windows launcher syntax | PowerShell `System.Management.Automation.Language.Parser` |
| Windows update／rollback acceptance | `scripts/phase7-e2e.ps1`、Inno Setup、clean Windows VM |

不要為 DOM 測試臨時加入 `jsdom`、`happy-dom` 等套件。能以 server integration 或抽出純函式測試的行為，優先使用既有工具；只有真正需要 browser lifecycle 的 refresh／click 行為才使用 `playwright-core`。

## 4. 修正項目 A：不要提前清除 rollback failure

### 現況與風險

位置：`src/release/update.js` 的 `prepareUpdate`。

目前在 manifest 驗證後、installer download 前就執行：

```js
rmSync(config.update.rollbackStatusFile, { force: true });
```

若使用者原本已有 `BT-UPD-007`，接著嘗試新更新但遇到 offline、hash mismatch、backup failure 或磁碟錯誤，舊 rollback failure 會消失；舊的 `BT-UPD-006` health marker 卻仍存在。Settings 下一次讀取時會再次顯示「可安全回滾」，讓使用者重試一個已知失敗的 rollback。

### 要做的事

1. 移除 `prepareUpdate` 開頭的 status deletion。
2. 只有在下列步驟全部成功後，才清除上一輪 rollback status：
   - installer 完整下載；
   - size 與 SHA-256 驗證成功；
   - consistent DB backup 成功；
   - 新 rollback record 寫入成功；
   - 新 health record 已寫成 `pending`。
3. 建議新增語意明確的 `clearRollbackStatus(config)` helper，不要在主要流程散落 `rmSync`。
4. 清除失敗時不要假裝 preparation 成功；保留可診斷錯誤並讓 apply operation 進入 `failed`。

建議流程：

```text
validate manifest
  → download and verify installer
  → create backup
  → write rollback record
  → write new pending health record
  → clear superseded rollback status
  → return prepared update
```

### 必加測試

- 既有 rollback status 為 `failed/BT-UPD-007`，download offline：status 仍存在且內容不變。
- hash mismatch：status 仍存在。
- backup failure：status 仍存在。
- preparation 全部成功：舊 status 才被清除。
- 成功建立的新 `pending` health 與 rollback record 必須仍存在。

### 常見雷點

- 不要在一開始先清除，再期待 catch 裡重建；process crash／斷電時 catch 不一定執行。
- 不要清除 health failure 後才建立新的 pending health，否則中間會出現沒有任何 recovery evidence 的空窗。
- 不要把完整 backup path、installer path、manifest URL 或 signature 寫入 UI status。
- Windows 上直接 rename 覆蓋既有檔案的行為與 POSIX 不完全相同；沿用專案既有 temp-file、remove、rename 慣例時要測失敗分支。

## 5. 修正項目 B：manual check 只記錄成功結果

### 現況與風險

位置：`src/web/server.js` 的 `GET /api/update`。

目前 route 使用 `finally` 呼叫 `recordUpdateCheck(db, update)`。`checkForUpdate` 發生 network 或 validation error 時，`update` 是 `undefined`，仍會覆寫：

- `updateLastCheckedAt` 為目前時間；
- `updateLatestResult.updateAvailable` 為 `false`；
- 已驗證的 manifest 摘要為 `null`。

這與已修正的 scheduled check 行為不一致，也會讓 scheduler 認為最近已完成檢查。

### 要做的事

1. 拿掉 manual route 的 `finally` 寫入。
2. `checkForUpdate` 成功回傳後才呼叫 `recordUpdateCheck`。
3. 發生 `BT-UPD-002` 或 `BT-UPD-003` 時：
   - API 仍回傳既有安全 error envelope；
   - DB 中最後一次成功結果完全不變；
   - `lastCheckedAt` 不前進。
4. 若產品希望顯示「上次嘗試失敗」，另建低敏感度的 `lastAttemptAt/lastAttemptCode`，不要挪用 `lastCheckedAt`。這不是本輪必要項目，除非同步更新 API Spec 與 UI。

### 必加測試

- 先保存一個 verified update，再讓 manual check offline；比對前後 `getUpdateState(db)` 必須 deep-equal。
- malformed manifest／invalid key 同樣不得覆寫最後成功結果。
- 成功的 no-update response 應正常更新 `lastCheckedAt` 及 latest result。
- Route error 仍維持正確 `BT-UPD-002`／`BT-UPD-003`。

### 常見雷點

- 不要把「嘗試過」與「成功驗證過」混在同一 timestamp。
- 不要為了保留 UI 卡片而吞掉 error；使用者仍需要知道本次檢查失敗。
- 不要在 catch 中把舊結果重新寫一次，否則會意外更新 setting 的 `updated_at`。

## 6. 修正項目 C：Scheduler 使用 remaining delay

### 現況與風險

位置：`src/release/update.js` 的 `runScheduledUpdateCheck` 與 `scheduleRecurringUpdateCheck`。

目前 initial timer 觸發時，如果距上次成功檢查只差一秒才滿 24 小時，`runScheduledUpdateCheck` 會因 `not due` 回傳 `null`；scheduler 卻把它當作 completed，安排完整 24 小時後再執行。因此相鄰兩次實際 network check 最長可能接近 48 小時。

### 建議設計

新增一個可單獨測試的 helper，例如：

```js
export function nextUpdateCheckDelay(db, config, {
  now = Date.now(),
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  retryDelayMs = UPDATE_RETRY_INTERVAL_MS,
} = {}) {
  if (!config.update?.manifestUrl) return intervalMs;
  if (!getNetworkState(db, config).enabled) return retryDelayMs;
  const { lastCheckedAt } = getUpdateState(db);
  const checkedAt = Date.parse(lastCheckedAt || '');
  if (Number.isNaN(checkedAt)) return 0;
  return Math.max(0, intervalMs - Math.max(0, now - checkedAt));
}
```

實際欄位與命名可調整，但行為應區分：

- 成功完成 network check：下次為 24 小時。
- network／validation failure：5 分鐘後重試。
- 尚未到期：只等待剩餘時間。
- network paused：不得發出請求；建議 5 分鐘重新檢查本機開關，或由 network resume 主動喚醒 scheduler。
- manifest URL 未設定：不得形成 tight loop，可維持長間隔。

若使用 clock injection，建議使用 `nowImpl: () => Date.now()`；不要把單一固定 `now` 值永久傳入 recurring timer，否則第二輪以後仍會使用舊時間。

### 必加測試

- 上次成功時間距到期剩 1 秒：下一 timer 約為 1 秒，不是 24 小時。
- 已逾期：立即或最小安全 delay 執行一次。
- 成功：下一 timer 為 24 小時。
- offline：下一 timer 為 5 分鐘，verified state 不變。
- network paused：fetch count 保持 0，且解除 pause 後不需再等 24 小時。
- 呼叫 stop 後，已排 timer 會被清除，也不會再排下一輪。

### 常見雷點

- 不要讓 `setTimeout(..., 0)` 在持續失敗或未設定 URL 時形成 busy loop。
- 要處理系統時間往前／往後調整；delay 至少 clamp 到 0，且不能成為負數。
- `runScheduledUpdateCheck` 回傳 `null` 的原因目前不唯一。不要只靠 truthy／falsy 判定成功、not-due、paused；可改成明確 reason，或把 delay 計算放在 scheduler 外層。
- `onResult` callback 本身拋錯不應把一次已成功且已記錄的 network check 誤判成 fetch failure。

## 7. 修正項目 D：Server 提供 safe active-operation summary

### 現況與風險

`updateOperations` 只存在 `createWebServer` 的記憶體中，`GET /api/update/status` 沒有回傳 active operation。Settings 重新整理後，browser 的 `activeUpdateOperation` 會重設為 `null`，導致：

- 下載進度消失；
- Apply／Defer 重新顯示；
- 使用者必須再次確認 Apply，才能由 single-flight response 找回 operation ID。

### 要做的事

1. 抽出 `findActiveUpdateOperation(updateOperations)`，server single-flight guard 與 status endpoint 共用同一判定。
2. `GET /api/update/status` 增加安全欄位，例如：

```json
{
  "operation": {
    "id": "safe-random-id",
    "targetVersion": "1.1.0",
    "phase": "downloading",
    "received": 1234,
    "total": 5678
  }
}
```

3. 不可回傳 installer path、backup path、manifest URL、signature、stack 或任意 exception message。
4. Settings 初始化取得 status 時，若 operation 是 `downloading`／`installing`，直接呼叫既有 `pollUpdate(operation.id)`。
5. Server-rendered page 最好也收到 active summary，避免頁面載入後到第一次 status fetch 之間短暫顯示可操作按鈕。可在呼叫 `settingsPage` 時傳入 safe summary，不要把整個 `Map` 傳進 template。
6. 定義 terminal operation 的 retention：
   - active lookup 只接受非 terminal phase；
   - terminal records 應在有限時間或有限數量後移除，避免 service 長期執行時 Map 無限成長；
   - progress endpoint 在 retention window 內仍可讀取 terminal result。

### 必加測試

- 阻塞 installer download，確認 `/api/update/status` 回傳同一 operation ID 與 `downloading`。
- 第二次載入 Settings 時不顯示可重複 Apply 的狀態，並可重新開始 polling。
- operation `failed`／`completed` 後不再被當成 active。
- response 不包含 URL、path、signature、backup record 或 stack。
- terminal cleanup 不會在原 browser 讀到結果前立刻造成 404。

### 常見雷點

- 不要建立第二份 client-only operation registry；server Map 才是單一來源。
- 不要把完整 operation object 直接 JSON serialize，未來新增敏感欄位時容易外洩。使用明確 allowlist mapper。
- 不要在 status request 中重新觸發 manifest fetch；此 route 必須保持本機、read-only、無外部網路。
- Service restart 會清空 Map；installer handoff 後應改由 persisted health／rollback status 接手，不要假設 operation memory 跨 process 存在。

## 8. 修正項目 E：Apply 立即鎖定，且只有一組 polling

### 現況與風險

位置：`src/web/ui.js` 的 Apply click handler。

目前 click 後只設定 `activeUpdateOperation='pending'`，但按鈕要等 `/api/update/apply` 回應後才隱藏。Manifest request 最長可等待 15 秒，期間可重複點擊。Server single-flight 能避免第二次 installer，但每個 response 都可能建立一組 `pollUpdate` interval。

### 要做的事

1. Handler 開頭加入 guard：已有 `activeUpdateOperation` 時直接 return。
2. 使用者確認後立即：
   - 設定 pending state；
   - disable 或隱藏 Apply、Defer、Resume；
   - disable Check Update，避免 operation 期間額外 manifest request。
3. Apply request 成功後只啟動一組 polling。
4. Apply request 失敗時清除 pending state，依最新 `updateState` 恢復正確按鈕，不要一律顯示 Apply。
5. 建議把 async `setInterval` 改成完成一次 request 後才安排下一次的 recursive `setTimeout`，避免單次 local response 超過 400 ms 時產生重疊 polling。
6. `pollUpdate` 應具備 idempotent guard：相同 operation ID 已在 polling 時，不再建立第二組 timer。
7. Terminal phase 或 error 時必須清理 timer/reference，再恢復 UI 或轉由 health status 接手。

### 必加測試

- 快速連點 Apply 兩次：client 只送出一次 POST。
- Apply request 延遲時，所有 update action 都不可再次操作。
- 相同 operation ID 呼叫 `pollUpdate` 兩次：只有一個 timer。
- Apply API 失敗後，按鈕依 defer 狀態正確恢復。
- Poll request 慢於 400 ms 時沒有 overlapping requests。
- Reload 找回 operation 後不需要再次顯示 confirmation dialog。

### 常見雷點

- `hidden` 與 `disabled` 的用途不同：hidden 控制顯示，disabled 防止事件；等待 response 時至少要確保事件無法再次觸發。
- 不要只依按鈕狀態做安全控制；server single-flight 必須保留。
- Catch 後不要忘記把 `activeUpdateOperation`、poll timer、progress bar 和 action controls 一起恢復。
- Installer 啟動後 service 可能很快停止，poll fetch failure 不一定代表 install failure；要讓新版 service 的 post-health marker 成為最終判定來源。

## 9. 建議測試配置

### Targeted automated tests

優先補在：

- `test/update-consent.test.js`：status 清除時機、scheduler remaining delay、clock／retry。
- `test/web.test.js`：manual failure preservation、active operation status、single-flight response、安全欄位。
- 若 UI handler 不易測試，先把 operation state transition 抽成無 DOM 的小函式並以 `node:test` 驗證；browser click／reload 再放 Windows E2E。

測試時使用 deferred Promise 控制 download：

```js
let releaseDownload;
const pendingDownload = new Promise((resolve) => { releaseDownload = resolve; });
```

先呼叫 apply、保持 download pending，再查 status 或模擬第二次載入；斷言完成後務必 resolve/reject，避免 test runner 留下未完成 handle。

### 完整驗證指令

```powershell
npm.cmd test
npm.cmd run config:check
git diff --check
```

PowerShell launcher parser：

```powershell
$parseErrors=$null
$tokens=$null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'release/windows/launcher.ps1'),
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null
$parseErrors
```

若有修改 Windows installer／launcher／rollback runner，再執行：

```powershell
npm.cmd run test:release:windows
```

此項可能需要 Inno Setup、可用的 system Chrome 或隔離 Windows 環境；缺少外部條件時要明確記為 release gate，不可用 unit test 通過取代。

## 10. Ambient proxy 注意事項

- 完整測試必須從 `npm test` 執行，讓 `scripts/run-tests.js` 只為 loopback 合併 `NO_PROXY=127.0.0.1,localhost,::1`。
- 不要全域清除 `HTTP_PROXY`／`HTTPS_PROXY`，也不要輸出 proxy credential。
- 直接執行 `node --test test/web.test.js` 可能再次被 ambient proxy 攔截；這不等同 application regression。
- External manifest／installer fetch 仍應遵守正式 proxy 與 network switch；只有 Local Web integration bypass loopback proxy。

## 11. Definition of Done

- [ ] A：失敗的新 preparation 不會清除舊 `BT-UPD-007`；成功 preparation 才 supersede。
- [ ] B：manual check failure 保留 verified state 與 `lastCheckedAt`。
- [ ] C：near-due scheduler 使用 remaining delay；failure 5 分鐘 retry；pause 不發網路請求。
- [ ] D：status endpoint 提供 allowlisted active operation；reload 可恢復 progress。
- [ ] E：Apply pending 立即鎖定；無重複 POST、無重複 polling。
- [ ] 新增 failure-path regression tests，不只做 source-code regex assertion。
- [ ] `npm test` 全數通過且沒有 open handle／flaky timer。
- [ ] `npm run config:check`、PowerShell parser、`git diff --check` 通過。
- [ ] API response 若有新增 `operation` 欄位，已同步 `docs/API_SPEC.md`。
- [ ] Scheduler／rollback 操作方式若改變，已同步 `docs/TECH_SPEC.md`、`docs/RUNBOOK.md`、`docs/TICKETS.md` 與 `docs/CHANGELOG.md`。
- [ ] 沒有新增 secret、完整 URL/path、signature、backup location 或 stack 到 log／API／文件。
- [ ] BT-UPD-001 維持 `In Review`，直到正式 HTTPS release channel 與 clean Windows VM upgrade／rollback 驗收完成。
