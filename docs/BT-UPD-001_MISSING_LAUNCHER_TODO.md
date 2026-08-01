# BT-UPD-001：Missing Launcher Uninstall P1 待辦

> 狀態：已修正（2026-07-30；BT-UPD-001 仍為 In Review，等待外部 release gates）
> 建立日期：2026-07-30
> 適用分支：`codex/bt-upd-001`
> 範圍：修正 `launcher.ps1` 遺失時，Windows uninstaller 錯誤地略過 service stop 的 fail-open 行為。

## 1. 問題摘要

目前 `release/windows/installer.iss` 的 `StopTrackerService()` 包含：

```pascal
LauncherPath := ExpandConstant('{app}\launcher.ps1');
if not FileExists(LauncherPath) then begin
  Result := True;
  exit;
end;
```

`Result := True` 等同告訴 uninstaller「service stop 已完成，可以繼續移除」。但 launcher 遺失只能證明無法執行 stop helper，不能證明 service 已停止。

可能發生的情況：

- 防毒軟體只隔離 `launcher.ps1`。
- 安裝目錄部分損壞或被誤刪。
- 更新／回滾中斷，launcher 沒有保留下來。
- 使用者手動刪除 launcher，但 packaged `node.exe bin/service.js` 仍在背景執行。

若此時繼續 uninstall，可能造成：

- 背景 service 繼續執行已被移除或部分移除的版本。
- Windows 對執行中的檔案採 locked／pending-delete 行為。
- startup registry 已刪除，但既有程序仍活著。
- 使用者以為解除安裝成功，實際上 8787 仍被占用。
- 後續重新安裝遇到舊 PID/status、port 或檔案狀態衝突。

## 2. 任務總表

| 完成 | 優先序 | 任務 | 主要檔案 | 驗收重點 |
|---|---|---|---|---|
| [x] | P1 | Launcher 缺失時改為 fail closed | `release/windows/installer.iss` | 無法執行 stop 時不得繼續移除 |
| [x] | P1 | 新增 `MissingLauncherMode` negative E2E | `scripts/phase7-e2e.ps1`、`package.json` | bounded 非零退出、無 GUI、保留 service 與安裝 |
| [x] | P1 | 加入 installer contract regression tests | `test/phase7.test.js` | 禁止重新出現 missing launcher → success |
| [x] | P2 | 補充損壞安裝的操作說明 | `docs/RUNBOOK.md`（未建立 `docs/TROUBLESHOOTING.md`，依 §7.1 允許寫在 RUNBOOK）、`docs/TICKETS.md` | 說明先 repair/reinstall，再 uninstall |

## 3. 安全目標

完成後必須滿足：

```text
launcher 存在 + stop 成功
→ 繼續 uninstall

launcher 存在 + stop 失敗
→ bounded 非零退出
→ 不顯示不可抑制 GUI
→ 不移除執行中的安裝

launcher 不存在
→ 視為無法證明 service 已停止
→ bounded 非零退出
→ 不移除執行中的安裝
```

核心原則：uninstaller 只能在「已成功執行安全 stop」或「以同等可靠方式確認沒有 service」時繼續。helper 遺失、資料不足或驗證失敗都不能當作成功。

---

## 4. 任務一：將 missing launcher 改為 fail closed

### 4.1 推薦的最小修正

將 `StopTrackerService()` 的 missing-file 分支改為失敗：

```pascal
if not FileExists(LauncherPath) then begin
  Result := False;
  exit;
end;
```

目前 `InitializeUninstall()` 已有：

```pascal
Result := StopTrackerService();
if not Result then begin
  SuppressibleMsgBox(...);
  exit;
end;
```

因此 minimal fix 應能沿用現有失敗流程：

- interactive uninstall：顯示可抑制的安全說明。
- silent uninstall：不顯示視窗，直接非零退出。
- program files、startup registry 與 user data 都不應被移除。

### 4.2 為什麼推薦先做最小 fail-closed

- 變更範圍最小。
- 不需要在 Inno Pascal 中重新實作 JSON parsing、PID ownership 或 service control。
- 不會繞過已完成的 `owned / other / unknown` lifecycle 安全邏輯。
- 損壞安裝可透過重新安裝相同版本修復 launcher，再執行正常 uninstall。

### 4.3 可選的 direct fallback

如果產品需求一定要在 launcher 遺失時自動 repair／stop，可以設計第二條 fallback，但只能在所有路徑都能可靠驗證時採用：

1. 讀取並驗證 `{app}\current.json`。
2. 解析目前 version，拒絕路徑穿越或非 semantic version。
3. 驗證以下檔案都位於 `{app}\versions\<version>`：
   - `runtime\node.exe`
   - `scripts\service-control.js`
4. 以 absolute path、hidden、non-interactive、bounded wait 呼叫：

```text
node.exe --no-warnings service-control.js stop
```

5. 只有 exit code 0 才允許 uninstall。
6. 任一檔案缺失、JSON 無效、timeout 或非零 exit 都必須 fail closed。

這個 fallback 複雜度較高。除非真的需要支援自動修復，建議先採 minimal fail-closed，並把「重新安裝同版本後再移除」寫進 runbook。

### 4.4 常見雷點

- 不要因 launcher 不存在就假設 service 不存在。
- 不要只查 8787 沒有 listener 就當成已停止；service 可能正在 starting、stopping，或 web server 啟動失敗但 process 仍活著。
- 不要只查 PID file 不存在就繼續；PID file 可能已損壞，但 service 還活著。
- 不要在 Inno code 裡重新做寬鬆的 `taskkill /IM node.exe`。
- 不要用普通 `MsgBox`，silent uninstall 必須保持無 UI。
- `SuppressibleMsgBox` 只是錯誤呈現方式，不是 stop 驗證。
- 不要讓 missing launcher 分支回傳 0 或成功 exit code。

### 4.5 完成條件

- [x] `FileExists(LauncherPath) = False` 時 `StopTrackerService()` 回傳 `False`。
- [x] silent uninstall 不顯示 GUI。
- [x] uninstall process bounded 非零退出。
- [x] program files 與執行中的 service 保持原狀。
- [x] user data 不受影響。

---

## 5. 任務二：新增 `MissingLauncherMode` negative E2E

### 5.1 目標

用真正重新建置的 installer 證明：launcher 缺失時，uninstaller 會安全中止，而不是只靠 regex 或單元測試推測。

### 5.2 建議參數

在 `scripts/phase7-e2e.ps1` 增加：

```powershell
[switch]$MissingLauncherMode
```

它應與現有 `StopFailureMode` 分開，避免一個測試同時改兩個條件，導致無法判斷失敗原因。

### 5.3 建議測試流程

```text
1. 建立唯一 runId、installRoot、userRoot
2. silent install
3. 等待實際 packaged service healthy
4. 記錄 service PID
5. 將本次 installRoot 的 launcher.ps1 移到 launcher.ps1.e2e-backup
6. 執行 /VERYSILENT /SUPPRESSMSGBOXES uninstall
7. 期待 bounded 非零 exit
8. 確認沒有 Beyblade Tracker launcher dialog
9. 確認 current.json 與 program files 仍存在
10. 確認原 service PID 仍存活
11. 確認 user data 仍存在
12. 恢復 launcher.ps1
13. 再跑正常 uninstall
14. 確認原 PID 停止、program files 移除、user data 保留
15. finally 精確清理本次 runId
```

### 5.4 安全修改隔離安裝副本

測試只能移動本次 E2E 的 launcher：

```powershell
$launcherPath = Join-Path $installRoot 'launcher.ps1'
$launcherBackup = "$launcherPath.e2e-backup"
```

移動前必須：

- 呼叫 `Assert-E2ePath $installRoot`。
- 確認 `$launcherPath.StartsWith($installRoot)`。
- 確認檔案確實存在。
- 不可操作 workspace 的 `release/windows/launcher.ps1`。
- 不可操作正式 `%LOCALAPPDATA%\Programs` 安裝。

`finally` 必須優先恢復 launcher，再執行 graceful cleanup。如果恢復失敗，仍要用本次 runId/installRoot verified process cleanup，並將 restore error 納入最終錯誤。

### 5.5 建議 helper

可以仿照現有 stop failure helpers：

```powershell
function Set-E2eMissingLauncher { ... }
function Restore-E2eMissingLauncher { ... }
```

不要把 `Remove-Item launcher.ps1` 當成主要做法；使用 `Move-Item` 到同一隔離目錄的 backup，讓測試可恢復並完成正常 uninstall。

### 5.6 時間限制

launcher 缺失會在 Inno `FileExists` 階段立即發現，因此 negative path 不應等待 service-control 的 35 秒 timeout。

建議：

- missing-launcher failure timeout：15 秒以內。
- 實際驗收通常應在數秒內完成。
- 若等到一般 uninstaller 90 秒 timeout，測試應失敗。

### 5.7 必須斷言

- [x] uninstaller 自行退出，不是由測試 timeout kill。
- [x] exit code 非零。
- [x] 沒有外部 GUI。
- [x] `current.json` 仍存在。
- [x] installRoot 仍存在。
- [x] 原 service PID 仍在執行。
- [x] 8787 仍由本次 service 提供 health。
- [x] user data 仍存在。
- [x] 恢復 launcher 後正常 uninstall 成功。
- [x] 最終無本次 runId 的 process／directory 殘留。

### 5.8 package script

建議新增獨立指令：

```json
"test:release:windows:missing-launcher": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/phase7-e2e.ps1 -MissingLauncherMode"
```

不要把它與正常 E2E 或 stopfail E2E 平行執行，因為三者都需要 port 8787。

### 5.9 常見雷點

- 測試 failure 是預期行為；wrapper 必須把「預期的 uninstaller 非零」轉成 negative E2E pass。
- 不要在預期 failure 後直接進入 finally；要先確認安裝與 service 確實受到保護。
- 不要忘記恢復 launcher，否則後續正常 uninstall 無法進行。
- 測試結束時不要只檢查目錄；還要檢查 PID 與 8787 listener。
- 不要讓 cleanup error 覆蓋 primary assertion error。
- `Assert-E2eNoLauncherDialog` 若採全系統視窗標題搜尋，可能被其他手動開啟的 Tracker 視窗干擾；最好限定本次 run 的 process identity。

---

## 6. 任務三：補 installer contract tests

### 6.1 靜態 regression test

在 `test/phase7.test.js` 加入精確 assertion，至少確認：

```text
if not FileExists(LauncherPath)
→ Result := False
```

並確認 missing-file block 不包含 `Result := True`。

不要只 assertion 整份 installer 內存在 `Result := False`，因為它可能出現在不相關函式，無法防止 regression。應先擷取 `StopTrackerService()` 或 missing launcher block，再驗證內容。

### 6.2 動態測試的重要性

靜態 test 只能證明 source 看起來 fail closed，不能證明：

- Inno `InitializeUninstall()` 最終 exit code 非零。
- silent mode 沒有 UI。
- program files 沒有被移除。
- service 沒有被誤停或誤殺。

因此 `MissingLauncherMode` packaged E2E 是必要驗收，不可用 regex test 取代。

### 6.3 完成條件

- [x] 靜態 contract test 能在 `Result := True` regression 時失敗。
- [x] packaged missing-launcher E2E 能驗證真實 installer 行為。
- [x] 正常與 stopfail E2E 仍通過。

---

## 7. 任務四：損壞安裝的使用者處理說明

### 7.1 建議文件內容

在 `docs/TROUBLESHOOTING.md` 或 `docs/RUNBOOK.md` 說明：

```text
若解除安裝回報無法停止背景服務或安裝檔案不完整：
1. 不要手動終止所有 node.exe。
2. 重新安裝相同或較新的正式版本，以修復 launcher 與 service-control。
3. 從開始選單執行「停止背景追蹤」。
4. 再次執行解除安裝。
5. 若仍失敗，收集安全錯誤代碼與 support reference。
```

### 7.2 不可建議的操作

- `taskkill /IM node.exe /F`
- 刪除整個 `%LOCALAPPDATA%`。
- 未確認 PID ownership 就強制終止。
- 手動刪除 data、backup 或 credentials。
- 將完整 log、路徑、Token 或 webhook 貼到公開 issue。

### 7.3 Ticket 狀態

完成後 `docs/TICKETS.md` 的 BT-UPD-001 仍應維持 `In Review`，直到 signed release channel、乾淨 Windows VM upgrade/rollback 與其他外部 release gates 完成。

---

## 8. 建議實作順序

1. 將 missing launcher 分支改為 `Result := False`。
2. 加入精確的 installer static regression test。
3. 在 phase7 E2E 新增 backup/restore launcher helpers。
4. 實作 `MissingLauncherMode`。
5. 新增 package script。
6. 更新 troubleshooting/runbook。
7. 跑 Node suite 與 PowerShell parser。
8. 重新 build installer。
9. 依序跑正常、stopfail、missing-launcher E2E。
10. 確認三次測試的 port、PID 與 temp 目錄都無殘留。

三個 packaged E2E 不可平行執行；它們共用 8787。

## 9. 驗證指令

### Node 與靜態驗證

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
  (Resolve-Path 'scripts/phase7-e2e.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
$errors
```

`$errors` 必須為空。

### 確認測試 port

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
```

若已有 listener，不要直接終止；先確認是不是使用者正在執行的 Tracker。

### 重新建置與 E2E

```powershell
npm.cmd run release:windows
npm.cmd run test:release:windows
npm.cmd run test:release:windows:stopfail
npm.cmd run test:release:windows:missing-launcher
```

必須重新 build 後再測試，不能沿用修改前的 installer。

### 測試後檢查

對每個測試記錄的 runId 分別確認：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains('<本次 runId>')
}
Get-ChildItem ([System.IO.Path]::GetTempPath()) -Force |
  Where-Object Name -Like 'BeybladeTracker-E2E-<本次 runId>-*'
```

只處理本次 runId；不可未經確認刪除其他測試或使用者資料。

## 10. 最終 Definition of Done

- [x] Missing launcher 不再回傳 stop success。
- [x] Silent uninstall 在 missing launcher 時 bounded、非零、無 GUI。
- [x] Failed uninstall 保留 program files、原 service 與 user data。
- [x] 恢復 launcher 後可以正常 uninstall。
- [x] Installer static contract test 可防止 `Result := True` regression。
- [x] `MissingLauncherMode` negative E2E 通過。
- [x] `npm.cmd test` 全數通過。
- [x] `npm.cmd run config:check` 通過。
- [x] PowerShell 5.1 parser 無錯誤。
- [x] `git diff --check` 通過。
- [x] 最新 installer build 成功。
- [x] 正常 packaged E2E 通過。
- [x] StopFailureMode negative E2E 通過。
- [x] MissingLauncherMode negative E2E 通過。
- [x] 三次 E2E 後 8787 已釋放，本次 runId 無 process／directory 殘留。
- [x] 損壞安裝的 repair/reinstall 流程已寫入 troubleshooting/runbook。

---

## 11. 實作記錄（2026-07-30）

### 11.1 變更

- `release/windows/installer.iss`：`StopTrackerService()` 的 missing-launcher 分支改為 `Result := False`，並更新失敗訊息說明「先重新安裝修復，再移除」。
- `scripts/phase7-e2e.ps1`：新增 `-MissingLauncherMode`（與 `-StopFailureMode` 互斥）、`Set-E2eMissingLauncher`／`Restore-E2eMissingLauncher`，15 秒 bounded 失敗、`current.json`／版本目錄／原 PID／8787 health／user data 斷言；`finally` 優先還原 launcher。`Assert-E2eNoLauncherDialog` 改為只檢查本次 runId + installRoot 的程序視窗，不再用全系統視窗標題。
- `package.json`：新增 `test:release:windows:missing-launcher`。
- `test/phase7.test.js`：static contract test 改為先擷取 `StopTrackerService()` 與 missing-launcher block 再驗證，並補 E2E helper／斷言的 regression 檢查。
- 文件：`docs/RUNBOOK.md`（fail-closed 契約、三個 E2E 的執行順序、損壞安裝 repair 流程與禁止操作）、`docs/TECH_SPEC.md`、`docs/ERROR_CODES.md`（補上前一輪新增的 `BT-LCH-006`）、`docs/TICKETS.md`、`docs/CHANGELOG.md`。

### 11.2 驗證結果

- 以模擬 regression（把 missing-launcher 分支改回 `Result := True`）確認 static contract test 會失敗：修正後 `true`、regression `false`。
- `npm.cmd test`：182 passed / 0 failed；`npm.cmd run config:check` 通過；`git diff --check` 通過；E2E PowerShell 5.1 parser 無錯誤。
- `npm.cmd run release:windows` 重新建置後依序執行三個 packaged E2E：
  - `:missing-launcher` → uninstaller 1 秒內非零失敗、無 UI、PID=14064 仍提供 8787 health，還原後正常 uninstall 成功。
  - 正常 → `PHASE 7 E2E OK`。
  - `:stopfail` → uninstaller 4 秒內非零失敗、無 UI、保留執行中安裝，之後正常 uninstall 成功。
- 三個 runId 的 process 與 temp 目錄皆為 0，8787 無 listener。
