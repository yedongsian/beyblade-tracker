# BT-UPD-001 Claude 修正交接計畫

> 狀態：Ready for implementation
> 審查基線：`codex/bt-upd-001`／`539ef04`
> 建立日期：2026-07-30
> 目標：處理最新審查確認的 2 個 P1、3 個 P2，不改變「必須由使用者明確同意才能下載／安裝」的核心政策。

## 1. 執行摘要

目前 unit／integration suite 為 153/153 通過，但仍不可合併，原因如下：

| 優先級 | 問題 | 已確認證據 |
|---|---|---|
| P1 | Concurrent Apply 可突破 server single-flight | 兩個同步 request 產生 2 個 manifest request、2 個 installer download、2 個 operation ID |
| P1 | Silent uninstall 卡在一般 `MsgBox` | 實際 packaged E2E 安裝及 health 通過，uninstaller 卡在「解除安裝 Beyblade Tracker」並於 90 秒 timeout |
| P2 | Packaged E2E 沒有驗證 installer 啟動的真實 service | 目前只執行另開 8788 port 的 `bin/health-check.js` |
| P2 | E2E timeout cleanup 會留下 Inno second-phase process 與 service | 實測殘留 `_unins.tmp` 及 packaged `node.exe`；原 finally 只 warning |
| P2 | Terminal update operations 永久留在 Map | `completed`／`failed` 後沒有 TTL、數量上限或 delete |

建議修正順序：

1. 先恢復 server-side single-flight 的原子性。
2. 修正 silent uninstall 的資料保留提示。
3. 強化 E2E 的真實 service 驗證。
4. 強化 E2E timeout／cleanup。
5. 補 operation retention。
6. 重建 installer，依序跑 targeted tests、完整 suite、packaged E2E。
7. 只有 packaged E2E 真正通過後，才能保留「已通過」的 Ticket／Runbook／CHANGELOG 證據。

## 2. 範圍與不可破壞的行為

### 本輪範圍

- `POST /api/update/apply` 的並行協調。
- Update operation 的 safe summary 與 terminal retention。
- Inno Setup silent uninstall 的資料保留預設。
- Windows packaged E2E 的 service start、health、stop、uninstall、cleanup 驗證。
- 相應 tests 與文件證據。

### 不可破壞

- 未收到 `confirmed:true + targetVersion + manifestDigest` 前不得下載或啟動 installer。
- Server single-flight 必須是安全邊界；不能只依賴 browser 按鈕 disabled。
- Update status response 不得包含 manifest URL、installer path、backup path、signature、stack 或任意 exception details。
- Silent uninstall 必須預設保留使用者資料，不得在沒有互動確認時刪除資料。
- `NETWORK_ENABLED=0`／database network pause 仍必須阻止 manifest 與 installer request。
- Ambient proxy 只能對 loopback tests bypass，不得清除外部 proxy 設定或輸出 credential。
- `BT-UPD-001` 仍維持 `In Review`；本輪不等同正式 HTTPS channel、Authenticode、SmartScreen 或 clean VM upgrade／rollback 驗收。

## 3. 使用工具與套件

不建議新增 npm dependency。

| 用途 | 使用現有工具 |
|---|---|
| Server concurrency | Node.js event loop、`Map`、共用 Promise 或明確 operation reservation |
| 測試 barrier | `Promise`、deferred resolver、`node:test`、`node:assert/strict` |
| Manifest fixtures | `node:crypto` 的 `generateKeyPairSync`、`sign`、`createHash` |
| Local Web integration | `test/web.test.js` 的 `withServer`、Node `fetch` |
| Operation retention | 純 helper、timestamp、Map；測試用 injected `now` |
| Installer／uninstaller | Inno Setup 既有 `.iss` 與 `ISCC.exe` |
| Windows E2E | PowerShell 5.1、`Start-Process`、`Get-CimInstance`、`Invoke-WebRequest` |
| Service control | packaged `scripts/service-control.js`、PID/status files |
| PowerShell syntax | `System.Management.Automation.Language.Parser` |

Inno Setup 官方依據：

- [`/VERYSILENT` 與 `/SUPPRESSMSGBOXES`](https://jrsoftware.org/ishelp/topic_setupcmdline.htm)：`[Code]` 中的一般 `MsgBox` 不會被抑制。
- [`SuppressibleMsgBox`](https://jrsoftware.org/ishelp/topic_isxfunc_suppressiblemsgbox.htm)：message suppression 啟用時會回傳指定的 default button。

## 4. P1-A：修復 Concurrent Apply single-flight race

### 根因

位置：`src/web/server.js` 的 `POST /api/update/apply`。

目前流程為：

```text
check active Map
  → await checkForUpdate()
  → validate confirmation
  → create operation
  → insert Map
```

`checkForUpdate()` 是 async network boundary。兩個請求可在 Map 尚未寫入時同時通過第一個 active check，之後各自建立 operation、下載 installer、建立 backup 並嘗試啟動 installer。

### 推薦方案：先 reserve `checking` operation

在任何 network await 前，以同步程式區段完成「檢查 active → 建立 reservation → 寫入 Map」。Node event loop 在沒有 await 的區段內可保持這段 reservation 的原子性。

建議新增 phase：

```js
const ACTIVE_UPDATE_PHASES = new Set(['checking', 'downloading', 'installing']);
```

推薦流程：

```text
validate local request and parse JSON
  → reject obviously invalid confirmation shape
  → find existing active operation
      → found: return same operation ID with inProgress=true
  → synchronously create operation(phase=checking)
  → synchronously insert Map
  → await manifest check
  → validate signed manifest and bound confirmation
  → update operation target/total/phase=downloading
  → prepare, install, terminal state
```

至少先做低成本 shape validation，避免明顯無效 request 占用 reservation：

- `confirmed === true`
- `targetVersion` 是預期的 semantic version 字串格式
- `manifestDigest` 是 64 位 hex

完整 trust validation 仍必須等 signed manifest 取得後使用現有 `validateUpdateConfirmation`；不可只靠 shape validation。

### Operation 建議欄位

```js
{
  id,
  targetVersion: confirmation.targetVersion,
  phase: 'checking',
  received: 0,
  total: 0,
  errorCode: null,
  createdAt,
  completedAt: null
}
```

Safe summary 可包含 `checking`，但不可新增 URL/path/signature。

### 錯誤處理

- Manifest／confirmation 失敗：operation 進入 `failed`，保存 allowlisted `errorCode`。
- 第一個 request 可依既有 error contract 回 400；同時進來的第二個 request 若已拿到 operation ID，可從 progress 取得 terminal failure。
- 不可在 catch 中直接 delete failed operation；browser 需要短時間讀取 terminal result。
- 若採共用 Promise／mutex 替代 `checking` operation，也必須確保第二個 request 不會自行重新跑 manifest fetch。

### 必加 regression test

建立真正的 manifest barrier，不要用 `setTimeout(10)` 假設第一個 operation 已建立：

```js
let releaseManifest;
const manifestGate = new Promise((resolve) => { releaseManifest = resolve; });
let manifestRequests = 0;

fetchImpl = async (url) => {
  if (isManifest(url)) {
    manifestRequests += 1;
    await manifestGate;
    return signedManifestResponse;
  }
  // installer response
};
```

測試步驟：

1. 同時送出兩個 `POST /api/update/apply`。
2. 確認在 release barrier 前兩個 request 都已進 server。
3. 釋放 barrier。
4. 斷言：
   - manifest request count = 1；
   - installer request count = 1；
   - operation ID 相同；
   - 第二個 response `inProgress=true`；
   - backup／installer launch 各最多一次。

另外測：

- 第一個 manifest validation 失敗時 reservation 能進 terminal failure，不會永久鎖住。
- 第一個 request 結束後可再次進行合法 apply。
- `checking` summary 不含敏感欄位。

### 常見雷點

- 只在 `await checkForUpdate()` 後再檢查一次可阻止雙 installer，但仍會發出兩次 manifest request；最低安全可接受，但不是完整 single-flight。
- 不要在 reservation 前做任何 await，包括額外 DB async helper。
- 不要用 module-global lock；每個 web server instance／test 必須隔離。
- 不要讓錯誤 request 永久保留 active phase；所有 path 都要進 terminal state。
- UI guard 不是 server concurrency control 的替代品，多 tab、API client 或快速 parallel fetch 都能繞過 UI。

## 5. P1-B：修復 Silent uninstall 互動阻塞

### 根因

位置：`release/windows/installer.iss` 的 `InitializeUninstall`。

目前使用一般：

```pascal
MsgBox(..., mbConfirmation, MB_YESNO)
```

Inno Setup 的 `/SUPPRESSMSGBOXES` 不會抑制 `[Code]` 中的一般 `MsgBox`。因此 `/VERYSILENT /SUPPRESSMSGBOXES` uninstall 仍顯示 modal dialog；E2E 的 PowerShell process 看不到可操作 UI，只能等 timeout。

### 推薦修正

使用 `SuppressibleMsgBox`，並將 silent default 設為 `IDYES`，確保無人互動時保留資料：

```pascal
PreserveUserData := SuppressibleMsgBox(
  '是否保留商品、歷史、設定與備份，方便日後重新安裝？' + #13#10 + #13#10 +
  '選「是」保留資料；選「否」會永久刪除使用者資料。',
  mbConfirmation,
  MB_YESNO,
  IDYES
) = IDYES;
```

替代方案是偵測 silent uninstall 後直接 `PreserveUserData := True`，非 silent 才顯示普通 dialog；但優先使用官方 `SuppressibleMsgBox` 可讓 `/SUPPRESSMSGBOXES` contract 更明確。

### 安全要求

- Silent／very silent 預設一定是保留資料。
- 只有 interactive uninstall 且使用者明確選「否」才可刪除 `{localappdata}\BeybladeTracker`。
- 不要因 E2E 使用自訂 `BEYBLADE_USER_ROOT` 而改寫 production uninstall data path policy；測試資料 cleanup 由 E2E script 負責。
- 不要用 timeout 後自動假設 `PreserveUserData=False`。

### 必加測試

Static test：

- `.iss` 使用 `SuppressibleMsgBox`。
- default argument 是 `IDYES`。
- 不再以一般 `MsgBox` 執行 uninstall data-retention prompt。

Packaged E2E：

- 重建 installer 後，以 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` uninstall。
- uninstaller 在 bounded timeout 內 exit 0。
- program files 被移除。
- user DB 仍存在。
- 沒有 `_unins.tmp` 或 modal uninstall window 殘留。

### 常見雷點

- 只在 install wizard 使用 `not WizardSilent` 不會修復 uninstall dialog；兩者是不同 lifecycle。
- `/SUPPRESSMSGBOXES` 不是所有 message box 的萬用開關。
- 修改 `.iss` 後必須重新執行 `npm run release:windows`；舊 `dist` installer 不會自動更新。
- 不可只靠 source regex test 宣稱 packaged E2E 已通過。

## 6. P2-A：E2E 必須驗證真實 packaged service

### 根因

位置：`scripts/phase7-e2e.ps1`。

目前 installer 結束後執行：

```powershell
& $node '--no-warnings' (Join-Path $appRoot 'bin\health-check.js')
```

`bin/health-check.js` 會自行建立 app，並在設定 port + 1（目前 8788）啟動另一個暫時 web server。這只能證明 packaged runtime 可執行，不能證明 installer `[Run]` 的 `launcher.vbs restart` 已成功啟動真正背景 service。

### 要做的事

新增 `Wait-E2eServiceHealthy` helper，驗證 installer 實際啟動的 8787 service：

1. 等待 `$userRoot\runtime\tracker.pid` 出現。
2. 解析 PID，確認為正整數且 process alive。
3. 等待 `$userRoot\runtime\tracker-status.json`：
   - `status = running`
   - `pid` 等於 PID file
   - `webUrl` 指向預期 loopback endpoint
4. 以 `Invoke-WebRequest` 或 `Invoke-RestMethod` 查詢 `http://127.0.0.1:8787/health`。
5. 斷言：
   - HTTP 200；
   - health status 為 `ok` 或 `degraded`；
   - release version 等於 `current.json`；
   - response 是這個隔離 user root 所建立的空／fixture DB 狀態。

### Port 衝突處理

Launcher 的 `Wait-ForManagementPage` 目前固定檢查 8787，因此不要只在 E2E 設定另一個 `WEB_PORT`，否則 launcher 會等待錯誤 port。

本輪最小做法：

- E2E 開始前檢查 8787 未被其他 process 使用；若占用，明確 fail 並提示先停止本機 Tracker。
- 查 health 前同時核對 PID/status，避免誤連到另一個 8787 service。

若要讓 E2E 使用動態 port，必須另行修改 launcher，使其從一致設定讀取 port；這是較大的行為變更，不建議偷偷混入本輪。

### Uninstall stop 驗證

在執行 uninstaller 前保存 service PID；uninstaller 成功後確認：

- 原 PID 已停止；
- PID file 已移除或不再指向 alive process；
- 8787 不再回應該 service；
- program files 才開始判定為已移除。

### `health-check.js` 的處理

- 可移除這個 E2E 步驟，避免同時開第二個 DB connection／server。
- 若保留，應明確命名為 standalone packaged smoke，且不能用它代替 service-start acceptance。

### 必加測試／驗收

- Static test 確認 E2E 讀 PID/status 並查 8787，而不是只找 `health-check.js` 字串。
- 實際 E2E output 要分段顯示：service start、service health、uninstall stop、program removal、data preservation。
- 刻意讓 installer service 無法啟動時，E2E 必須 fail，不能因 standalone health 成功而通過。

### 常見雷點

- 只確認 PID file 存在不夠；可能是 stale PID。
- 只查 8787 HTTP 200 不夠；可能連到使用者原本的 Tracker。
- 不要用 `taskkill` 當正常 stop 驗收；正常路徑必須驗證 launcher/service-control graceful stop。
- Installer `[Run]` 使用 `nowait`，所以 installer process exit 不代表 service 已 ready；一定要 bounded polling。

## 7. P2-B：E2E timeout 必須清理完整 process tree

### 根因

目前 `Wait-E2eProcess` timeout 時只執行：

```powershell
Stop-Process -Id $Process.Id -Force
```

Inno uninstaller 會建立 second-phase `_unins.tmp`。最初 process 被停止後，second phase 仍可能存活；若 service 也未停止，finally 的 `Remove-Item` 會失敗。目前 catch 只印 warning，可能留下 hidden dialog、service 及暫存目錄。

### 要做的事

1. 所有 test-created process 必須與本次 `$runId`／`$installRoot` 建立可驗證關聯。
2. Timeout 後：
   - 先找 command line 包含本次 `$installRoot\unins000.exe`／`$runId` 的 Inno second-phase process；
   - 只停止已核對 command line 的 process；
   - 呼叫 packaged `service-control.js stop` 停止本次 user root 的 service；
   - 必要時才對已驗證 PID 使用 process-tree termination。
3. 等待 process 全部退出後再刪除 `$installRoot`／`$userRoot`。
4. Cleanup failure 必須令 E2E exit non-zero，不能只 warning。
5. 同時保留原始 test failure 與 cleanup failure；不要讓 finally 的第二個 exception 完全遮住根因。

### 建議 PowerShell 結構

```powershell
$primaryError = $null
$cleanupErrors = @()
try {
  # install / verify / uninstall
} catch {
  $primaryError = $_
} finally {
  try { Stop-E2eProcesses ... } catch { $cleanupErrors += $_ }
  try { Remove-E2ePaths ... } catch { $cleanupErrors += $_ }
}
if ($primaryError) { Write-Error $primaryError }
if ($cleanupErrors.Count) { throw "E2E cleanup failed: ..." }
```

實際 error aggregation 可調整，但 output 必須同時保留：

- 第一個 failure stage；
- process cleanup 結果；
- path cleanup 結果。

### 安全限制

- 保留並加強 `Assert-E2ePath`；任何 recursive delete 前都驗證 target 是 temp 的直接子目錄且 filename 含完整 run ID。
- 不得針對所有 `node.exe`、`powershell.exe` 或 `_unins.tmp` 批次終止。
- 不得以 `$HOME`、`$env:TEMP` 根目錄或 wildcard 當 delete target。
- Process ID 可能重用；停止前再次核對 executable path／command line。
- 不要把使用者正式 `%LOCALAPPDATA%\BeybladeTracker` 當 E2E cleanup target。

### 建議診斷

執行 installer／uninstaller時加入本次 run ID 的 Inno log：

```powershell
$installLog = Join-Path $userRoot 'installer.log'
$uninstallLog = Join-Path $userRoot 'uninstaller.log'
```

傳入 `/LOG="..."`。失敗時只輸出必要尾端摘要；完整 log 留在隔離 user root，避免把可能含路徑的內容直接貼到公開 Issue。

### 必加測試／驗收

- 模擬 child process timeout，確認 verified child 被停止。
- 模擬 cleanup path 被鎖定，E2E 必須 non-zero。
- 正常通過後不存在本次 run ID 的 process 或目錄。
- 其他不相關 Node／PowerShell process 保持存活。

### 常見雷點

- `Start-Process -PassThru` 取得的 PID 不保證涵蓋 Inno second phase。
- `WaitForExit` timeout 後立即 delete，Windows handle 可能尚未釋放；需要 bounded wait。
- Cleanup warning 不應被當成成功。
- 若用 `taskkill /T /F`，只可對已核對為本次測試的 PID，並保留 graceful stop 為正常路徑。

## 8. P2-C：Terminal operation retention 與 Map 上限

### 根因

`updateOperations` 在 service lifetime 內只 `set`，不 `delete`。每次 failed／completed update 都永久佔用 Map。Operation ID 雖不可預測，但長期服務或反覆失敗會持續增加記憶體。

### 推薦設計

新增常數：

```js
const UPDATE_OPERATION_TTL_MS = 10 * 60 * 1000;
const UPDATE_OPERATION_MAX_TERMINAL = 20;
```

Terminal transition 時寫入：

```js
operation.completedAt = Date.now();
```

新增純 helper：

```js
function pruneUpdateOperations(operations, now = Date.now()) {
  // 1. 永不刪除 checking/downloading/installing
  // 2. 刪除超過 TTL 的 terminal operation
  // 3. terminal 仍超過數量上限時，從最舊開始刪除
}
```

建議在以下時機呼叫：

- 新 Apply request 建立 reservation 前；
- `GET /api/update/status`；
- `GET /api/update/progress/:id`。

不一定要建立 background timer；request-driven pruning 可避免額外 timer/open handle。由於新增 operation 本身就需要 request，在 Apply 前 pruning 足以限制 growth。

### Retention contract

- Active operation 永不 prune。
- Terminal operation 至少保留一小段時間，讓 browser 讀取最終狀態。
- TTL 後 progress endpoint 可回 404。
- Status endpoint 只回 active operation，不必回所有歷史。
- Summary 維持 allowlist。

### 必加測試

- Active operation 即使很舊也不被 prune。
- Terminal operation 在 TTL 內仍可讀。
- 超過 TTL 後被刪除。
- 超過數量上限時只刪最舊 terminal，不刪 active。
- 多次 failed apply 後 Map size 有上限。
- 使用 injected clock，避免真實 sleep 與 flaky test。

### 常見雷點

- 不要 operation 一完成就 delete，否則 browser 下一次 400 ms poll 會得到 404 而看不到成功／失敗。
- 不要用每個 operation 一個長時間 timer，會增加 test open handles 與 shutdown 複雜度。
- `completedAt` 使用同一種型別；建議 epoch milliseconds，避免每次 parse ISO。
- 數量上限只計 terminal records；active 不可被 eviction。

## 9. 測試實作順序

### 第一階段：Targeted Node tests

修改／新增：

- `test/web.test.js`
  - 真正 concurrent Apply barrier。
  - checking operation safe summary。
  - failed reservation recovery。
  - operation TTL／max count。
- `test/phase7.test.js`
  - `SuppressibleMsgBox` + `IDYES`。
  - E2E 有 PID/status/8787 health 驗證。
  - cleanup failure 會 fail。

執行：

```powershell
npm.cmd test
npm.cmd run config:check
git diff --check
```

不要直接以 `node --test test/web.test.js` 當 ambient proxy 環境的主要證據；完整 `npm test` 會透過 `scripts/run-tests.js` 合併 loopback `NO_PROXY`。

### 第二階段：PowerShell parser

```powershell
$parseErrors=$null
$tokens=$null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'release/windows/launcher.ps1'),
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null
$parseErrors

$parseErrors=$null
$tokens=$null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'scripts/phase7-e2e.ps1'),
  [ref]$tokens,
  [ref]$parseErrors
) | Out-Null
$parseErrors
```

兩次都必須沒有 parser error。

### 第三階段：重建 Windows artifact

`.iss` 修改後必須先重建：

```powershell
npm.cmd run release:windows
```

確認新的 Setup.exe timestamp／hash 已更新。沒有 signing key／base URL 時 manifest 保持 `publishReady=false` 是正確行為，不可為了 E2E 強行標成 true。

### 第四階段：Packaged Windows E2E

```powershell
npm.cmd run test:release:windows
```

必要輸出／斷言：

1. Silent install exit 0。
2. `current.json` 與 packaged Node 存在。
3. 真實 service PID/status ready。
4. 真實 8787 `/health` 通過且屬於本次隔離 service。
5. Silent uninstall 不顯示 dialog、不 timeout。
6. 原 service PID 已停止。
7. Program files 已移除。
8. User DB 保留。
9. 本次 run ID 沒有 process／temp directory 殘留。

若失敗，先保存隔離 log 再 cleanup；不得手動點 dialog 後把結果記成 silent E2E 通過。

## 10. 文件與證據修正

目前 `docs/TICKETS.md` 記錄 packaged Windows verification 已通過，但 2026-07-30 依現有指令重跑的結果是：install 與 standalone health 通過、silent uninstall 90 秒 timeout。因此 Claude 修改時需遵守：

1. 修正完成、重建 artifact、E2E 真正通過前，把該證據改為「failed／pending rerun」，或至少不要新增更強的完成宣稱。
2. E2E 通過後，記錄新的執行日期、artifact hash 摘要、service PID/status/health、uninstall exit、data preservation 與 cleanup 結果。
3. `BT-UPD-001` 仍是 `In Review`，因正式 HTTPS channel 與 clean Windows VM upgrade／rollback 尚未完成。
4. 若 API 新增 `checking` phase 或 retention contract，同步更新：
   - `docs/API_SPEC.md`
   - `docs/TECH_SPEC.md`
   - `docs/RUNBOOK.md`
   - `docs/TICKETS.md`
   - `docs/CHANGELOG.md`

## 11. Claude 實作時的 Git／工作區注意事項

- 工作區目前另有未追蹤文件：
  - `docs/BT-UPD-001_REMAINING_FIXES.md`
  - 本交接文件 `docs/BT-UPD-001_CLAUDE_FIX_PLAN.md`
- 這些是使用者要求保留的文件，不要在 cleanup、checkout、reset 或 commit 時誤刪。
- 不要使用 `git reset --hard`、`git checkout -- .` 或廣泛 clean。
- 修改前先執行 `git status --short --branch`，只處理本計畫列出的檔案。
- 建議 commit 前再次確認沒有把 `dist/` artifact、private signing key、Inno log 或 temp E2E data 加入 Git。

預期可能修改的 tracked files：

- `src/web/server.js`
- `src/web/ui.js`（若新增 checking 顯示）
- `src/i18n.js`（若新增 checking message）
- `release/windows/installer.iss`
- `scripts/phase7-e2e.ps1`
- `test/web.test.js`
- `test/phase7.test.js`
- `docs/API_SPEC.md`
- `docs/TECH_SPEC.md`
- `docs/RUNBOOK.md`
- `docs/TICKETS.md`
- `docs/CHANGELOG.md`

## 12. Definition of Done

### P1

- [ ] 兩個真正同時進入的 Apply 共用一個 reservation／operation。
- [ ] Concurrent repro 的 manifest request、installer download、backup、launch 都最多一次。
- [ ] Confirmation policy、network lock 與 safe error contract 未被繞過。
- [ ] Silent uninstall 使用可抑制提示，silent default 為保留資料。
- [ ] Packaged silent uninstall bounded 完成且沒有互動視窗。

### P2

- [ ] E2E 驗證真實 packaged service PID、status 與 8787 health。
- [ ] E2E 驗證 uninstall 確實停止原 service PID。
- [ ] Timeout cleanup 可處理 Inno second phase，且不影響不相關程序。
- [ ] Cleanup 失敗會令測試 non-zero，並保留原始 failure stage。
- [ ] Terminal operation 有 TTL 及數量上限，active operation 永不誤刪。
- [ ] Browser 在 retention window 內仍讀得到 terminal result。

### 全體驗證

- [ ] `npm test` 全數通過，沒有 flaky timer／open handle。
- [ ] `npm run config:check` 通過。
- [ ] Launcher 與 E2E PowerShell parser 通過。
- [ ] `git diff --check` 通過。
- [ ] Windows artifact 已在 `.iss` 修改後重建。
- [ ] `npm run test:release:windows` 真正通過全部九個必要斷言。
- [ ] E2E 完成後沒有本次 run ID 的 process／temp path。
- [ ] 文件敘述與本次實際證據一致。
- [ ] 沒有提交 signing key、credential、完整外部 URL、使用者 DB、完整 log 或 temp artifact。
- [ ] `BT-UPD-001` 維持 `In Review`，等待正式 release channel 與 clean VM upgrade／rollback gate。
