# BT-UPD-001：Uninstall 與 Process Ownership Follow-up 待辦

> 狀態：已修正（2026-07-30；BT-UPD-001 仍為 In Review，等待外部 release gates）
> 建立日期：2026-07-30
> 適用分支：`codex/bt-upd-001`
> 範圍：前一輪三個 P2 修正後，正常 packaged E2E 通過，但受控降級測試新發現 1 個 P1、2 個 P2。

## 0. 背景與已確認事實

目前正常路徑已通過：

- `checking` update phase 顯示正確。
- server update single-flight 與 terminal operation retention 正常。
- silent uninstall 在 service-control 正常時可完成。
- packaged E2E 會驗證實際 PID/status、8787 `/health`、service stop、uninstall 與資料保留。
- service ownership 已開始使用 PID、executable path、完整 service path 與 creation time。

但受控測試將子程序的 `PATH` 隔離，使 `service-control.js` 無法啟動 `powershell.exe`／CIM helper 後，實際重現：

```text
service-control ownership = unknown
→ stop() 在寫入 stop.request 前拒絕
→ launcher.ps1 捕捉錯誤並開啟 WinForms ShowDialog
→ Inno /SUPPRESSMSGBOXES 無法抑制外部 GUI
→ uninstaller 90 秒 timeout
```

該測試最後由 E2E 的精確 cleanup 清除了本次 UUID 的程序與目錄，沒有殘留；但正式 uninstaller 沒有 E2E wrapper，因此此流程仍是 release blocker。

## 1. 待辦總表

| 完成 | 優先序 | 任務 | 主要檔案 | 核心驗收 |
|---|---|---|---|---|
| [x] | P1 | 建立真正 non-interactive、bounded 的 uninstall stop 流程 | `release/windows/launcher.ps1`、`release/windows/installer.iss`、`scripts/phase7-e2e.ps1` | silent uninstall 的成功與失敗路徑都不可出現 GUI 或無限等待 |
| [x] | P2 | `unknown` ownership 仍可安全嘗試 graceful stop | `scripts/service-control.js`、`src/release/service-process.js`、相關測試 | status 合理時先寫 stop request；只有 owned 才能 force kill |
| [x] | P2 | start 路徑也要處理 stale／reused PID | `scripts/service-control.js`、相關測試 | 不可把任何存活 PID 都當成已啟動的 Tracker |

## 2. 安全邊界

以下原則不可因修正而退步：

- `/VERYSILENT /SUPPRESSMSGBOXES` 下不得顯示 WinForms、普通 Inno `MsgBox` 或其他需要人工點擊的 UI。
- `tracker.pid`、`tracker-status.json` 位於使用者可寫目錄，只能作為協調資訊，不可單獨授權 force kill。
- `process.kill(pid, 0)` 只能證明 PID 存在，不能證明它是 Tracker。
- `taskkill` 前必須重新取得當下的 OS process identity，不能沿用 35 秒前的判斷。
- 不可使用 `taskkill /IM node.exe`、`Get-Process node | Stop-Process` 或任何廣泛終止。
- E2E cleanup 只能處理本次唯一 runId/installRoot，不能清理其他測試、既有 Tracker 或使用者資料。
- silent uninstall 仍要預設保留 user data。
- 不要新增 npm dependency；Node.js、`node:test`、PowerShell 5.1、Inno Setup 已足夠。

---

## 3. P1：Silent uninstall 的錯誤路徑仍會開啟外部 GUI

### 3.1 目標

建立明確區分的兩種 launcher 模式：

1. **Interactive mode**：使用者手動啟動、restart、status 時，可以顯示目前的安全錯誤視窗。
2. **Non-interactive mode**：installer、uninstaller、startup automation 或測試呼叫時，絕對不可顯示 GUI；只能輸出安全錯誤代碼並以非零 exit code 結束。

### 3.2 現行問題

`release/windows/launcher.ps1` 最外層 catch 目前無條件執行：

```powershell
Show-LauncherError $code
```

`Show-LauncherError` 使用 WinForms `ShowDialog()`。Inno 的 `/SUPPRESSMSGBOXES` 只會控制 Inno 自己可抑制的訊息，不會關閉另一個 PowerShell process 建立的視窗。

此外，使用者關閉錯誤視窗後，launcher catch 沒有明確 `exit 1`，可能讓呼叫端誤以為 stop 成功。

### 3.3 要修改的檔案

1. `release/windows/launcher.ps1`
2. `release/windows/installer.iss`
3. `scripts/phase7-e2e.ps1`
4. `test/phase7.test.js`
5. 若需要同步 contract：`docs/RUNBOOK.md`、`docs/TECH_SPEC.md`、`docs/TICKETS.md`

### 3.4 建議實作

#### A. Launcher 新增 non-interactive 參數

例如：

```powershell
param(
  [ValidateSet('open','start','restart','stop','status','export','import','update','rollback')]
  [string]$Action = 'open',
  [switch]$NonInteractive
)
```

catch 應區分：

```powershell
catch {
  # 維持 safe code allowlist，不輸出 stack、路徑或敏感資訊。
  if ($NonInteractive) {
    [Console]::Error.WriteLine($code)
    exit 1
  }
  Show-LauncherError $code
  exit 1
}
```

注意：

- 不要只隱藏視窗卻仍回傳 0。
- non-interactive stderr 只應包含 safe error code／簡短訊息。
- 不要輸出 userRoot、installRoot、完整 command line、stack trace、Token 或 URL。
- 正常成功路徑要明確回傳 0。

#### B. Uninstaller 必須明確使用 non-interactive mode

`release/windows/installer.iss` 的 uninstall stop command 必須加入 non-interactive 參數。不要依賴 `/SUPPRESSMSGBOXES` 間接控制 launcher。

推薦把「停止 service」變成 uninstaller 的明確前置條件：

1. 以 hidden、non-interactive 模式執行 stop。
2. 使用 bounded wait。
3. 檢查 process exit code。
4. stop 失敗時，不得繼續假裝 uninstall 成功。
5. 不得刪除仍在執行的 service files。

可以用 Inno `[Code]` 的 uninstall 初始化／step event 執行 `Exec` 並檢查 result code，或使用等價、可由目前 Inno Setup 版本驗證的方式。不要只假設 `[UninstallRun]` 會因 child exit code 非零而中止整個 uninstall；必須用實際 E2E 證明 failure semantics。

互動 uninstall 若要提示使用者，使用 Inno `SuppressibleMsgBox`；silent mode 必須採安全預設並立即以非零結果退出，不能等待 UI。

#### C. 設定時間上限

建議的時間關係：

- service graceful stop：沿用或調整目前 35 秒，但必須明確有限。
- launcher non-interactive：應在 graceful timeout 加少量 overhead 後退出。
- uninstaller E2E timeout：應大於 launcher timeout，但不能成為正常控制流程。

如果 launcher 已在 35–40 秒內失敗，E2E 不應再等到 90 秒才知道。

### 3.5 建議測試

#### 正常路徑

- silent install 後 service healthy。
- silent uninstall 不顯示 UI。
- 原 PID 停止。
- program files 移除。
- user data 保留。

#### 故意失敗路徑

在隔離安裝目錄中讓 installed `service-control.js stop` 明確回傳 1，或以依賴注入方式模擬 stop failure：

- launcher 必須在 bounded time 內退出。
- 不得出現 WinForms 視窗。
- exit code 必須非零。
- uninstaller 不得回報成功後留下 service。
- E2E cleanup 必須清除本次 runId 的程序與目錄。
- primary error、stop error 與 cleanup error 不可互相覆蓋。

不要只在 `test/phase7.test.js` 用 regex 確認 `$NonInteractive` 字串存在；至少要有一個實際執行 launcher failure path 的測試。

### 3.6 常見雷點

- `-WindowStyle Hidden` 只隱藏 PowerShell console，不會阻止 WinForms `ShowDialog()`。
- `/SUPPRESSMSGBOXES` 無法抑制外部 process 的 GUI。
- catch 未 `exit 1` 時，呼叫端可能收到成功結果。
- stop 失敗後直接繼續 uninstall，可能留下執行中的舊 service。
- 不要為了避免 hang 而把 wait 改成 `nowait`；這會造成 uninstaller 與 service/file deletion race。
- 互動模式仍可顯示錯誤視窗，但 startup automation 是否需要 GUI 必須另外明確決定，不能共用模糊預設。

### 3.7 完成條件

- [x] silent uninstall 成功與失敗路徑都不顯示任何 GUI。
- [x] launcher non-interactive failure 明確回傳非零。
- [x] service 未停止時，uninstaller 不會回報成功並刪除執行中版本。
- [x] 故意 stop failure 不再造成 90 秒 timeout。
- [x] 正常 packaged E2E 仍完整通過。

---

## 4. P2：`unknown` ownership 應允許安全 graceful stop

### 4.1 目標

保留嚴格的 force-kill 安全邊界，但不要讓 CIM、PowerShell、ExecutablePath 或 CreationDate 暫時不可用時，連 non-destructive 的 stop request 都無法送出。

### 4.2 現行問題

`scripts/service-control.js` 目前以：

```js
if (!isTrackerService(pid)) return false;
```

同時阻擋 `other` 與 `unknown`，而這段判斷位於 `writeFileSync(STOP_FILE, ...)` 之前。

結果是實際 Tracker 明明會輪詢自己的 stop file，卻因 OS identity helper 暫時失敗而完全收不到 graceful stop request。

### 4.3 使用方法與工具

- `src/release/service-process.js`：維持 ownership 純函式。
- `node:test` + `node:assert/strict`：測試 state decision，不要實際 kill 系統程序。
- `Get-CimInstance Win32_Process`：取得 OS identity。
- Node `execFileSync`：使用 argument array，避免 shell 字串注入。
- `process.env.SystemRoot` + `System32\WindowsPowerShell\v1.0\powershell.exe`：可考慮使用明確 system PowerShell path，降低 PATH 缺失造成的 unknown；但即使 helper 失敗，仍要安全降級。

### 4.4 建議拆分的判斷

不要再用單一 `isTrackerService()` boolean 包辦所有行為。建議拆成：

```text
classifyServiceProcess(...) -> owned | other | unknown
canAttemptGracefulStop(status, pid) -> true | false
canForceTerminate(identity) -> ownership === owned
```

`canAttemptGracefulStop` 最少應確認：

- status 存在且能解析。
- `status.service === 'beyblade-tracker'`。
- `status.pid === pid`。
- status phase 是 `starting`、`running` 或 `stopping`。

這仍不能授權 force kill，但足以安全寫入只會被 Tracker 讀取的 stop file。

### 4.5 建議 stop state machine

```text
read PID
→ PID 不存在／程序已死：清 stale PID，成功
→ 查 ownership
  → other：拒絕，不寫 stop request，不 force kill
  → owned：允許 graceful stop
  → unknown + status 合理：允許 graceful stop
  → unknown + status 不合理：拒絕
→ 寫入 stop.request
→ bounded wait
  → PID 已退出：成功
  → timeout：重新查 ownership
      → owned：才可 force kill
      → other/unknown：回傳非零，絕不 force kill
```

timeout 後的 ownership 查詢必須是新的結果，不能重用第一次查詢。

### 4.6 建議重構方式

為了讓 state machine 可測試，可把以下依賴注入到 helper：

- `readPid`
- `readStatus`
- `inspectProcess`
- `isAlive`
- `writeStopRequest`
- `sleep`
- `forceTerminate`
- `now`

生產入口仍使用真實實作，測試使用 fake dependency。如此可以測 timeout、PID reuse、unknown → graceful success，而不建立或終止真實程序。

### 4.7 必測案例

1. `owned` → graceful stop 成功，不呼叫 force kill。
2. `unknown` + 合理 status → 寫 stop request，程序自行退出，成功。
3. `unknown` + status 缺失／PID 不符 → 拒絕。
4. `other` → 拒絕，不寫 stop request。
5. 第一次 owned、等待後 PID 被重用為 other → 不 force kill。
6. timeout 後仍 owned → 只對該 PID 執行精確 force kill。
7. CIM malformed JSON、Access denied、PowerShell 不存在 → ownership unknown，不拋出未處理 exception。
8. force command 失敗 → 非零 exit，保留可操作但不敏感的 safe error。

### 4.8 常見雷點

- status file 相符不代表 owned；只能允許 graceful attempt。
- stop file 若殘留，`start()` 仍須在啟動新 service 前清除，目前行為不可破壞。
- 等待期間 PID 可能被重用，因此 force 前必須重查。
- 使用絕對 PowerShell path 能降低 PATH 問題，但不能解決 CIM access denied，仍需要 unknown fallback。
- 不要把完整 `execFileSync` error 或 PowerShell stderr顯示給使用者。
- 不要讓 unknown 自動變成 owned。

### 4.9 完成條件

- [x] unknown + 合理 status 可完成 graceful stop。
- [x] unknown 永遠不能直接 force kill。
- [x] timeout 後會重新驗證 ownership。
- [x] PID reuse 測試證明不會誤殺。
- [x] non-interactive uninstall 在 identity helper 不可用時仍能讓真實 service 自行停止。

---

## 5. P2：start 路徑必須辨識 stale／reused PID

### 5.1 目標

避免 `tracker.pid` 指向其他存活程序時，`start()` 錯誤回報「Tracker 已在執行」並跳過真正的 service startup。

### 5.2 現行問題

`scripts/service-control.js` 目前只判斷：

```js
if (existing && isAlive(existing)) {
  // 回報已在執行並 return true
}
```

它沒有使用新的 `classifyServiceProcess()`。

### 5.3 建議 start decision

```text
沒有 PID
→ 正常啟動

PID 不存活
→ 刪除 stale PID file
→ 正常啟動

PID 存活 + ownership owned
→ 回報 Tracker 已啟動
→ return true

PID 存活 + ownership other
→ 這是明確 stale/reused PID
→ 只清 Tracker 自己的 stale PID/必要 metadata
→ 不終止該程序
→ 啟動 Tracker

PID 存活 + ownership unknown
→ 不可宣稱已啟動
→ 也不要冒險再啟動第二個 service
→ 回傳非零與安全、可操作的錯誤
```

對 `other` 清理時只能刪除 Tracker 自己的 PID/stop metadata；不得終止或修改該 PID 對應的其他程序。

### 5.4 可選的輔助訊號

可以用 status 與本機 health 作為診斷資訊，但不要把單一 `http://127.0.0.1:8787/health` 成功當成 process ownership 證明，因為該 port 可能由其他程序占用。

若 ownership unknown，最安全的預設是明確失敗並請使用者檢查，而不是回傳成功或啟動第二份 service。

### 5.5 必測案例

1. 沒有 PID → spawn 一次。
2. dead PID → 清 PID file並 spawn 一次。
3. owned live PID → 不 spawn，回傳成功。
4. other live PID → 不 kill other process，清 stale Tracker PID，spawn 一次。
5. unknown live PID → 不 spawn、不 kill、回傳失敗。
6. status PID 與 pid file 不一致 → 不宣稱已啟動。
7. stale stop file 在真正 spawn 前被清除。

### 5.6 常見雷點

- 不要對 `other` 執行 force kill；它正是要保護的程序。
- unknown 不能直接當 stale 清除後啟動，否則可能產生兩個 Tracker service。
- owned 判斷必須使用目前 app root 的完整 service path，不可只找 `bin/service.js` 通用片段。
- 啟動失敗不能留下新的錯誤 PID file 或把舊 status 偽裝成 running。
- 測試 spawn 次數，避免 retry 或 fall-through 產生兩個 child processes。

### 5.7 完成條件

- [x] stale/reused PID 不再被回報為 Tracker 已啟動。
- [x] other process 不會被終止。
- [x] unknown 不會造成 duplicate service。
- [x] start、restart、startup task 的正常行為不退步。

---

## 6. 建議實作順序

1. 先將 service stop decision 抽成可測試 state machine。
2. 完成 `unknown` → graceful stop，但保留 owned-only force kill。
3. 將同一 ownership classifier 套用到 start path。
4. 為 launcher 增加 non-interactive mode與正確 exit code。
5. 讓 Inno uninstall 明確呼叫 non-interactive stop，並驗證 stop failure semantics。
6. 補 unit/integration tests。
7. 跑正常 packaged E2E。
8. 跑故意 stop failure 的 negative E2E。
9. 檢查兩種 E2E 都沒有本次 runId 殘留。

先修 stop state machine，再修 uninstaller，可以避免只把 GUI 隱藏後，service 仍無法停止、uninstaller 卻繼續刪檔。

## 7. 驗證指令

### Node suite

```powershell
npm.cmd test
npm.cmd run config:check
git diff --check
```

### PowerShell 5.1 parser

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'release/windows/launcher.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
$errors

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'scripts/phase7-e2e.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
$errors
```

兩次 `$errors` 都必須為空。

### 重新建置 installer

```powershell
npm.cmd run release:windows
```

一定要在 source 修改完成後重建，不能用舊的 `dist/windows/installer` 判斷結果。

### 正常 packaged E2E

執行前確認 8787 未被使用：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
npm.cmd run test:release:windows
```

預期包含：

```text
E2E service healthy: PID=<pid>, port=8787
PHASE 7 E2E OK: install, packaged service health, uninstall, service stop, data preservation
```

### Negative E2E

建立一個明確、可重複的 stop failure 測試模式，不要靠人工點擊視窗。預期：

- non-interactive launcher 在設定的 timeout 內非零退出。
- 沒有 WinForms 視窗。
- uninstaller 不會假裝成功。
- E2E 最終回報預期 failure。
- cleanup 清除本次 runId。

若使用臨時修改 installed test copy 的方式模擬 failure，只能修改本次隔離的 `%TEMP%\BeybladeTracker-E2E-<runId>-install`，不可修改工作區 source 或正式安裝目錄。

### 測試後檢查

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains('BeybladeTracker-E2E-<本次 runId>')
}
Get-ChildItem ([System.IO.Path]::GetTempPath()) -Force |
  Where-Object Name -Like 'BeybladeTracker-E2E-<本次 runId>-*'
```

不要未經確認清除其他 runId 或使用者原有資料。

## 8. 最終 Definition of Done

- [x] P1：silent uninstall 任何路徑都不會顯示外部 GUI。
- [x] P1：stop failure 會 bounded、非零退出，不再等到 90 秒 timeout。
- [x] P1：service 未停止時不會假裝 uninstall 成功。
- [x] P2：unknown + 合理 status 可安全嘗試 graceful stop。
- [x] P2：只有重新確認 owned 才能 force kill。
- [x] P2：start 能區分 owned、other、unknown。
- [x] P2：stale/reused PID 不會阻止 Tracker 正常啟動或誤殺其他程序。
- [x] 所有 ownership/state-machine 測試通過。
- [x] `npm.cmd test` 全數通過。
- [x] `npm.cmd run config:check` 通過。
- [x] launcher 與 E2E PowerShell 5.1 parser 通過。
- [x] `git diff --check` 通過。
- [x] 最新 installer build 成功。
- [x] 正常 packaged E2E 通過。
- [x] negative stop-failure E2E bounded 失敗且無 GUI。
- [x] 兩種 E2E 後 8787 已釋放，本次 runId 無程序／目錄殘留。
- [x] `docs/TICKETS.md` 的 BT-UPD-001 維持 `In Review`，直到 signed release channel、乾淨 Windows VM upgrade/rollback 等外部 release gates 完成。

---

## 9. 實作記錄（2026-07-30）

### 9.1 變更檔案

- `src/release/service-process.js`：新增 `canAttemptGracefulStop()`、`canForceTerminate()`；creation-time 檢查改為方向性。
- `src/release/service-lifecycle.js`（新增）：可注入依賴的 `runStopSequence()`／`runStartSequence()` state machine。
- `scripts/service-control.js`：改用 state machine，並以絕對 system PowerShell path 取得 OS identity。
- `release/windows/launcher.ps1`：新增 `-NonInteractive`、bounded `Run-Control`、`BT-LCH-006`、明確 exit code。
- `release/windows/launcher.vbs`：可傳遞 `noninteractive` 模式。
- `release/windows/installer.iss`：uninstall 以 `StopTrackerService()` 為前置條件；startup 與 silent 安裝後啟動改用 non-interactive。
- `scripts/phase7-e2e.ps1`：新增 `-StopFailureMode` negative E2E、無 GUI 斷言與「exit code 必須可讀」保證。
- `test/service-process.test.js`、`test/service-lifecycle.test.js`（新增）、`test/launcher-noninteractive.test.js`（新增）、`test/phase7.test.js`。

### 9.2 過程中發現並修正的兩個實際缺陷

1. `Start-Process -PassThru` 對隱藏 child 可能回傳 null `ExitCode`，使成功的 stop 被判為 `BT-LCH-003`；改為自建 `System.Diagnostics.Process` 並持有 handle 讀取 exit code。E2E 也加入「exit code 不可讀 = 驗證失敗」的檢查。
2. Packaged cold start 從 process 建立到寫入 `startedAt` 實測超過 6 秒，原本 ±10 秒對稱視窗會把真正的 service 判成 `other`；改為方向性檢查（process 不得晚於紀錄的 `startedAt`，PID reuse 容忍 2 秒 clock skew，startup 視窗 120 秒）。

### 9.3 驗證結果

- `npm.cmd test`：182 passed / 0 failed。
- `npm.cmd run config:check`：通過。
- PowerShell 5.1 parser（launcher、E2E）：無錯誤；launcher BOM 仍為 `EF BB BF`。
- `npm.cmd run release:windows`：installer 重新建置成功。
- `npm.cmd run test:release:windows`：`PHASE 7 E2E OK`。
- `npm.cmd run test:release:windows:stopfail`：uninstaller 3 秒內非零失敗、無 UI、保留執行中安裝；還原後正常 uninstall 成功。
- 兩次 E2E 後 8787 無 listener，本次 runId 無殘留程序或目錄（`%TEMP%` 中僅有其他既有 runId 的舊目錄，未動）。
