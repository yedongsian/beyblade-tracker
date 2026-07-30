# BT-UPD-001：新發現的 3 個 P2 修正待辦

> 狀態：待修正
> 建立日期：2026-07-30
> 適用分支：`codex/bt-upd-001`
> 範圍：前一輪 2 個 P1、3 個 P2 已修正後，全面複查所發現的 3 個新 P2。

## 0. 開始前先確認

- 本文件只處理以下三項，不要順便改 update consent、manifest 驗章、rollback 或 operation retention 行為。
- 保留目前已通過的 server single-flight、silent uninstall、8787 service E2E 與 terminal operation retention。
- 不要加入新的 npm dependency。現有 Node.js、`node:test`、PowerShell 5.1、Inno Setup 已足夠。
- `docs/BT-UPD-001_CLAUDE_FIX_PLAN.md` 與 `docs/BT-UPD-001_REMAINING_FIXES.md` 是前一輪的歷史與交接資料，不要刪除。
- 目前所有修改尚未 commit；開始前先用 `git status --short` 確認，不要覆蓋不相關的使用者修改。

## 1. 待辦總表

| 完成 | 優先序 | 任務 | 主要檔案 | 驗收重點 |
|---|---|---|---|---|
| [ ] | P2 | 正確顯示 `checking` update phase | `src/web/ui.js`、`src/i18n.js`、`test/web.test.js` | manifest 檢查期間不可顯示「更新失敗」 |
| [ ] | P2 | E2E graceful stop 失敗後仍執行精確 cleanup | `scripts/phase7-e2e.ps1`、`test/phase7.test.js` | stop 失敗也會清除本次 runId 的程序，且保留所有錯誤 |
| [ ] | P2 | 防止 stale status／PID reuse 誤殺其他程序 | `scripts/service-control.js`、`bin/service.js`、相關測試 | status file 不可作為強制終止的唯一身分證明 |

---

## 2. P2-1：`checking` 階段被 UI 顯示成「更新失敗」

### 問題位置

- `src/web/server.js` 已新增合法的 active phase：`checking`。
- `src/web/ui.js` 的 `pollUpdate()` 目前只有以下顯示分支：
  - `downloading`
  - `installing`
  - `completed`
  - 其餘全部落到 `errorCode || updateFailed`
- 因此 manifest request 超過第一次 400ms polling 時，使用者會看到假的「更新失敗」，但 operation 其實仍在正常執行。

### 要修改的檔案

1. `src/i18n.js`
2. `src/web/ui.js`
3. `test/web.test.js`
4. 若 API/UI phase 說明有更新，可同步補 `docs/API_SPEC.md` 或 `docs/RUNBOOK.md`，但不要改變 API contract。

### 建議實作步驟

#### 2.1 新增三語文案

在 `src/i18n.js` 的繁中、英文、日文區塊新增同一個 key，例如：

```js
'settings.updateChecking': '正在重新確認更新資訊…'
'settings.updateChecking': 'Checking update information…'
'settings.updateChecking': '更新情報を確認しています…'
```

文字重點：

- 不要寫成「正在下載」，因為此時 installer request 尚未開始。
- 不要宣稱已驗證完成，signature 與 confirmation binding 還沒完成。
- 三種 locale 都要補，避免 translator fallback 或顯示 key 本身。

#### 2.2 將文案放進 Settings script 的 message map

`src/web/ui.js` 內 `settingsScript()` 的 `messages`／`settingsMessages` mapping 要加入 `updateChecking`。

#### 2.3 明確處理 phase

在 `pollUpdate()` 的 phase-to-message 邏輯加入：

```text
checking    -> updateChecking
downloading -> updateDownloading(percent)
installing  -> updateInstalling
completed   -> updateRestarting
failed      -> errorCode 或 updateFailed
unknown     -> updateFailed（防禦性 fallback）
```

建議不要繼續擴充多層 ternary。可以抽成小型 phase formatter，或至少改成容易審查的 `if/else`／`switch`。

#### 2.4 處理 progress bar

`checking` 還不知道 installer 的 total bytes，不能計算真實百分比。可採以下任一方案：

- 推薦：`checking` 時移除 `<progress>` 的 `value`，呈現 indeterminate；進入 `downloading` 後再設定 `value`。
- 最小修正：保持 0%，但文字必須明確顯示正在檢查。

若使用 indeterminate，進入 `downloading` 時一定要恢復 `value`，operation 結束時仍要隱藏 progress bar。

### 建議測試

至少新增下列回歸驗證：

1. `checking` operation 的畫面文字是 `updateChecking`，不是 `updateFailed`。
2. `checking` 不會清除 `activeUpdateOperation`，也不會重新啟用 Apply／Defer／Resume。
3. 從 `checking` 轉成 `downloading` 後，仍可顯示百分比。
4. `failed` 仍顯示 safe `errorCode`，不可把 exception message 或路徑送到 UI。
5. 繁中、英文、日文的 `updateChecking` 都存在。

如果不想加入 DOM 套件，可以把 phase-to-presentation 抽成純函式後用 `node:test` 測試；不要只用過度寬鬆的 regex 確認字串存在，否則分支順序寫錯仍可能通過。

### 常見雷點

- 不要把 `checking` 加進 terminal phase；它仍是 single-flight active operation。
- 不要在 `checking` 時解除 disabled controls，否則又會製造重複 Apply。
- 不要因 `total === 0` 就視為失敗；checking 的 total 本來就是 0。
- 不要讓 unknown phase 永遠 busy。unknown phase 應安全失敗或交由明確的 fallback 處理。
- `src/web/ui.js` 的 Settings script 目前是一段很長的 template string；修改引號、反斜線與換行時要特別小心生成後的 JavaScript 語法。

### 完成條件

- [ ] manifest 被刻意暫停時，畫面顯示「正在確認」，不顯示「更新失敗」。
- [ ] 第二個 Apply 仍回到同一 operation ID。
- [ ] checking → downloading → failed/completed 的顯示切換正確。
- [ ] 三語測試與既有 Web 測試通過。

---

## 3. P2-2：graceful stop 失敗會跳過 E2E fallback cleanup

### 問題位置

`scripts/phase7-e2e.ps1` 的 `Stop-E2eProcesses` 目前流程為：

1. 嘗試執行 packaged `service-control.js stop`。
2. `$LASTEXITCODE -ne 0` 時立即 `throw`。
3. 原本應在後面執行的 `Get-CimInstance Win32_Process` candidate cleanup 因此永遠不會跑。

這會在最需要 fallback 的情況下跳過 fallback，可能留下 packaged `node.exe`、Inno Setup helper 或 `_unins.tmp`。

### 要修改的檔案

1. `scripts/phase7-e2e.ps1`
2. `test/phase7.test.js`
3. 若新增專用測試腳本，可放在 `scripts/` 或 `test/`，但不要加入 Pester dependency。

### 建議實作步驟

#### 3.1 將 cleanup 設計成「收集錯誤後繼續」

`Stop-E2eProcesses` 內建立自己的錯誤集合，例如：

```powershell
$stopErrors = @()
```

graceful stop 應使用 `try/catch`，並在 native command 結束後立刻保存 `$LASTEXITCODE`：

```powershell
try {
  & $node '--no-warnings' $controlScript stop
  $stopExitCode = $LASTEXITCODE
  if ($stopExitCode -ne 0) {
    throw "Packaged service-control stop failed with exit code $stopExitCode."
  }
} catch {
  $stopErrors += $_
}
```

捕捉錯誤後不能直接 return 或 throw，必須繼續做 candidate cleanup。

#### 3.2 只清理由本次 run 建立的程序

保留並強化以下身分限制：

- command line 必須包含本次唯一的 `$runId` 或經 `Assert-E2ePath` 驗證的 `$installRoot`。
- 排除目前 PowerShell `$PID`。
- 不可使用 `Get-Process node | Stop-Process`、`taskkill /IM node.exe` 或其他廣泛終止。
- 不可清理所有 `BeybladeTracker-E2E-*` 目錄，只能處理本次 runId。

建議採 bounded repeat：最多掃描數次 verified candidates，直到沒有符合者，避免 Inno 第一階段在第一次掃描後又產生第二階段 helper。每輪都要重新驗證 command line。

#### 3.3 對程序已自然結束採冪等處理

candidate 在列舉後可能已退出：

- `Stop-Process` 回報 process not found 時可以視為已清理。
- Access denied、身分不符或仍在執行不能忽略，必須加入 cleanup error。
- 若 PID 可能被重用，終止前應重新取得同一 PID 的 command line 並再次比對 runId/installRoot。

#### 3.4 最後才拋出彙整錯誤

建議錯誤順序：

1. 原始 install／health／uninstall failure。
2. graceful stop failure。
3. verified process cleanup failure。
4. temporary path cleanup failure。

不得用 cleanup error 覆蓋原始錯誤，也不得只 `Write-Warning` 後回傳成功。最終 exit code 必須為非零。

#### 3.5 清理路徑前確認程序已停止

只有在 verified candidate 已不再執行後，才執行 `Remove-E2ePaths`。仍須保留：

- `Assert-E2ePath`
- `-LiteralPath`
- `-ErrorAction Stop`
- 本次 `$runId` 的目錄限制

### 建議測試

除了正常 packaged E2E，至少要驗證一條失敗路徑：

1. 建立一個 command line 含測試 runId 的受控暫存程序。
2. 模擬 graceful stop 回傳非零。
3. 確認 fallback 仍會終止該受控程序。
4. 確認不符合 runId/installRoot 的 control process 保持存活。
5. 確認輸出的錯誤同時包含 primary error 與 graceful-stop error。
6. 確認 install/user temporary directories 最終不存在。

`test/phase7.test.js` 的靜態 assertion 可以保留，但不能作為唯一驗證；它只能證明文字存在，無法證明 `throw` 不會讓流程提前中止。

### 常見雷點

- PowerShell function 使用 dynamic scope；`$primaryError`、`$servicePid` 等變數初始化順序不要改到讓 function 看到意外值。
- `$LASTEXITCODE` 可能被下一個 native command 覆蓋，必須立即保存。
- `Stop-Process` 不保證終止新產生的 child helper；需要 bounded rescan 或其他仍具精確身分限制的方式。
- 不要在 PowerShell 與另一個 shell 之間傳遞待刪除路徑或 PID。
- Cleanup 成功不代表原始測試應成功；primary failure 必須保留。
- 在 Codex sandbox 內 Inno installer 可能回傳 exit code 4 或 CIM access denied。真正的 packaged E2E 應在一般 Windows terminal 或已允許的 unrestricted execution 執行。

### 完成條件

- [ ] graceful stop 非零時，verified fallback cleanup 仍會執行。
- [ ] 不會終止其他 Node、PowerShell 或既有 Tracker 程序。
- [ ] primary 與 cleanup error 都會出現在最終錯誤。
- [ ] 成功與故意失敗的 E2E 都沒有本次 runId 的程序／目錄殘留。

---

## 4. P2-3：status file 不足以證明 PID 屬於 Tracker

### 問題位置

`scripts/service-control.js` 的 `isTrackerService(pid)` 在 command-line 查詢失敗或回傳空字串時，會只依賴：

- `tracker-status.json` 的 `service`
- status 內的 `pid`
- `starting`／`running`／`stopping` 狀態

如果 Tracker 非正常終止後留下 stale PID/status，而 Windows 將相同 PID 配給其他程序，再碰上 CIM/PowerShell 查詢失敗，現行流程可能在 35 秒後對無關程序執行強制終止。

### 安全原則

將判斷拆成兩個不同等級：

1. **可以嘗試 graceful stop**：PID/status 看起來相符時，可以寫入 `stop.request` 並等待。無關程序不會處理 Tracker 的 stop file。
2. **可以 force kill**：必須有 OS 層級、目前仍有效的程序身分證據；status file 絕對不能是唯一證據。

### 要修改的檔案

1. `scripts/service-control.js`
2. `bin/service.js`（若需要補寫 process identity metadata）
3. 建議新增 `src/release/service-process.js` 或等價純 helper，方便單元測試。
4. 新增或擴充相關 `node:test`。
5. `scripts/phase7-e2e.ps1` 必須重跑，確認 silent uninstall 仍可正常停止 packaged service。

### 建議實作步驟

#### 4.1 取得完整 process identity

Windows 查詢至少應包含：

- ProcessId
- ExecutablePath
- CommandLine
- CreationDate

可透過 PowerShell `Get-CimInstance Win32_Process` 後輸出壓縮 JSON，再由 Node 解析。查詢失敗要回傳 `unknown`，不要把 unknown 當成 owned。

#### 4.2 使用精確路徑，不要只找通用片段

目前只檢查 command line 是否包含 `bin\\service.js`／`bin/service.js`，範圍過寬。至少應比對：

- 預期的 packaged/dev Node executable path。
- 目前 app root 下的完整 `SERVICE_FILE` 路徑。
- Windows 大小寫不敏感與 `/`、`\\` 正規化後的結果。

不要因其他專案也有 `bin/service.js` 就判定為 Beyblade Tracker。

#### 4.3 比對啟動時間，降低 PID reuse 風險

`bin/service.js` 已在 status 寫入 `startedAt`。把它與 OS process `CreationDate` 比較，允許少量時間誤差，但不能接受明顯不同的建立時間。

如果 Windows/CIM 日期格式轉換失敗，ownership 應為 `unknown`，不是 `owned`。

#### 4.4 拆開 graceful 與 force 判斷

建議使用三態，而不是單一 boolean：

```text
owned   = OS identity 與 app/status 都吻合
other   = OS identity 明確顯示不是 Tracker
unknown = 查詢失敗或證據不足
```

`stop()` 建議流程：

1. PID 不存在：清 stale PID file，回傳成功。
2. identity 是 `other`：拒絕 stop，不寫 force kill。
3. identity 是 `owned`，或 status 允許 graceful attempt：寫 `stop.request`。
4. 等待服務自行退出。
5. 若已退出：成功，不需要 force kill。
6. timeout 後重新查詢 identity，避免使用 35 秒前的舊結果。
7. 只有重新查詢結果仍是 `owned` 才可 force kill。
8. `unknown`／`other`：回傳非零並輸出安全、可操作的錯誤，不可強制終止。

#### 4.5 確認 uninstaller 的失敗語意

改嚴格後要確認 Inno `[UninstallRun]` 的行為：

- 正常情況應透過 `stop.request` 在 timeout 前自行結束，因此不依賴 force kill。
- 若 service 確實無法停止且 ownership 無法確認，不能為了讓 uninstall 看起來成功就廣泛 kill。
- 必須確保 E2E 能偵測「uninstaller 結束但原 PID 仍活著」；目前 `Wait-E2eServiceStopped` 應保留。
- 若需要調整 installer 的 stop failure handling，silent mode 不可彈出不可抑制的普通 `MsgBox`。

### 建議純函式測試案例

將 ownership decision 抽成不執行 OS command 的 helper，至少覆蓋：

1. 完整 executable、service path、PID、creation time 都相符 → `owned`。
2. command line 空白，只有 status PID 相符 → `unknown`，不可 force kill。
3. stale status PID 與新程序 PID 相同，但 creation time 不同 → `other`／不可 force kill。
4. 另一個 app root 也有 `bin/service.js` → 不可判定 owned。
5. executable path 不符 → `other`。
6. CIM 查詢拋錯或回傳 malformed JSON → `unknown`。
7. 第一次查詢 owned、等待期間 PID 被重用、第二次查詢不符 → 不可 force kill。
8. graceful stop 成功 → 不執行 `taskkill`。

### 常見雷點

- PID 不是永久識別碼，等待 35 秒後一定要重新驗證。
- status/PID file 位於使用者可寫目錄，只能當協調資訊，不能單獨授權 destructive action。
- Windows 路徑比較要處理大小寫、斜線與可能的引號；不要用未正規化的單純 substring。
- `ExecutablePath` 可能因權限回傳空值；空值代表 unknown，不代表相符。
- 不要把 `process.kill(pid, 0)` 當身分驗證，它只能證明某個 PID 存在。
- 不要為了讓 packaged E2E 通過而恢復廣泛的 `taskkill /IM node.exe`。
- service 正常 shutdown 會自行清 PID file；強制路徑才需要謹慎處理 stale files。

### 完成條件

- [ ] status file 不再是 force kill 的唯一證據。
- [ ] stale PID reuse 測試證明不會終止無關程序。
- [ ] graceful stop 正常路徑仍能在 silent uninstall 中完成。
- [ ] timeout 後會重新驗證 ownership。
- [ ] packaged E2E 仍通過 service PID/status/8787/uninstall 驗證。

---

## 5. 建議執行順序

1. 先修 P2-1，因為範圍最小，且不影響 Windows process handling。
2. 再重構 P2-3 的 process ownership／graceful-vs-force 判斷。
3. 接著修 P2-2，讓 E2E cleanup 能處理 P2-3 的 stop failure。
4. 執行 targeted tests。
5. 執行完整 Node suite。
6. 重新 build installer。
7. 在 port 8787 沒有既有 listener 的環境跑 packaged E2E。
8. 確認沒有本次 runId 的程序或 temp directory 殘留。

P2-3 與 P2-2 要一起做最終驗收：service-control 越嚴格，E2E cleanup 越需要正確執行精確 fallback。

## 6. 驗證指令

### Node 與設定測試

```powershell
npm.cmd test
npm.cmd run config:check
git diff --check
```

### PowerShell 5.1 語法

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'scripts/phase7-e2e.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
$errors
```

`$errors` 必須為空。

### 確認 8787 可用

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
```

若已有 listener，先確認是不是使用者正在使用的 Tracker；不要直接終止不明程序。

### 重新建置並執行 packaged E2E

```powershell
npm.cmd run release:windows
npm.cmd run test:release:windows
```

成功輸出至少要包含：

```text
E2E service healthy: PID=<pid>, port=8787
PHASE 7 E2E OK: install, packaged service health, uninstall, service stop, data preservation
```

### E2E 後檢查

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains('BeybladeTracker-E2E-')
}
Get-ChildItem ([System.IO.Path]::GetTempPath()) -Force |
  Where-Object Name -Like 'BeybladeTracker-E2E-*'
```

只檢查本次 runId；舊的、非本次建立的資料不可未經確認直接刪除。

## 7. 最終 Definition of Done

- [ ] 3 個 P2 的程式修改與針對性測試完成。
- [ ] `checking` 不再顯示失敗，三語文案完整。
- [ ] graceful stop 失敗後 verified cleanup 仍執行。
- [ ] status file 不可單獨授權 force kill，PID reuse 不會誤殺。
- [ ] `npm.cmd test` 全數通過。
- [ ] `npm.cmd run config:check` 通過。
- [ ] PowerShell 5.1 parser 無錯誤。
- [ ] `git diff --check` 通過。
- [ ] 使用最新工作區重新 build installer。
- [ ] packaged Windows E2E 全流程通過。
- [ ] E2E 後 8787 已釋放，且本次 runId 無程序／目錄殘留。
- [ ] `docs/TICKETS.md` 的 BT-UPD-001 維持 `In Review`，直到 signed release channel、乾淨 Windows VM upgrade/rollback 等外部 release gates 完成。
