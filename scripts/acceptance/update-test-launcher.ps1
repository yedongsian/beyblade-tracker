# BT-REL-001：找出 launcher restart 到底卡在哪一層。
#   選單 [8]
#
# 已知：手動執行 `launcher.vbs restart noninteractive` 完全沒動到服務（PID 與啟動時間都沒變）。
# launcher.vbs 用 `shell.Run command, 0, False` 隱藏執行 PowerShell，stdout/stderr 與離開代碼
# 全部被丟棄，所以不論 launcher.ps1 丟出哪一個 BT-LCH-* 都沒有人看得到。
#
# 這支腳本由外而內逐層執行同一件事，每一層都留下離開代碼與完整輸出。

$out = (Join-Path $PSScriptRoot 'update-test-launcher.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'

function ServedVersion {
  try { return (Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 5 -ErrorAction Stop).release.version }
  catch { return '無回應' }
}

Log ("=== BT-REL-001 launcher 分層診斷  " + (Get-Date).ToString('o') + " ===")

# --- 0. 起點 ---
$current = $(try { (Get-Content -LiteralPath (Join-Path $appDir 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '讀不到' })
Log ''
Log '--- 0. 起點 ---'
Log ("current.json : $current")
Log ("/health      : " + (ServedVersion))

$appRoot  = Join-Path (Join-Path $appDir 'versions') $current
$node     = Join-Path $appRoot 'runtime\node.exe'
$control  = Join-Path $appRoot 'scripts\service-control.js'
$launcher = Join-Path $appDir 'launcher.ps1'

# --- 1. launcher.ps1 會用到的東西是否都在 ---
Log ''
Log '--- 1. 前置條件（缺任何一項 launcher 就會丟 BT-LCH-001／002）---'
foreach ($pair in @(@('launcher.ps1', $launcher), @('node.exe', $node), @('service-control.js', $control))) {
  Log ("{0,-20} {1,-6} {2}" -f $pair[0], (Test-Path -LiteralPath $pair[1]), $pair[1])
}

# --- 2. 回滾鎖：restart 會先過 Assert-RollbackStartAllowed，失敗就丟 BT-LCH-003 ---
Log ''
Log '--- 2. 回滾鎖（會擋掉 start／restart）---'
$lock = Join-Path $userDir 'runtime\rollback.lock'
if (Test-Path -LiteralPath $lock) {
  Log ">>> 存在：$lock"
  $ownerPath = Join-Path $lock 'owner.json'
  if (Test-Path -LiteralPath $ownerPath) {
    Get-Content -LiteralPath $ownerPath -Raw | ForEach-Object { Log ("    " + $_) }
  } else { Log '    owner.json 不存在（取得中或殘留）' }
  Log '    >>> 這會讓 restart 直接丟 BT-LCH-003。'
} else { Log '不存在（不是這個原因）' }

# --- 3. 直接跑 launcher.ps1，把被丟掉的輸出接回來 ---
Log ''
Log '--- 3. 執行 launcher.ps1 -Action restart -NonInteractive（可見）---'
if (Test-Path -LiteralPath $launcher) {
  $stdout = Join-Path $env:TEMP 'bt-launcher-out.txt'
  $stderr = Join-Path $env:TEMP 'bt-launcher-err.txt'
  $p = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', "`"$launcher`"", '-Action', 'restart', '-NonInteractive') `
    -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Log ("離開代碼 : " + $p.ExitCode)
  foreach ($pair in @(@('stdout', $stdout), @('stderr', $stderr))) {
    $text = $(try { Get-Content -LiteralPath $pair[1] -Raw -ErrorAction Stop } catch { '' })
    if ([string]::IsNullOrWhiteSpace($text)) { Log ($pair[0] + ' : （空）') }
    else { Log ($pair[0] + ' :'); $text -split "`r?`n" | ForEach-Object { if ($_) { Log ("    " + $_) } } }
  }
  Log ("執行後 /health : " + (ServedVersion))
} else { Log '>>> launcher.ps1 不存在，略過。' }

# --- 4. 繞過 launcher，直接跑 service-control ---
Log ''
Log '--- 4. 直接執行 service-control.js restart（繞過 launcher）---'
if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $control)) {
  # launcher 會設的環境變數必須自己補上，否則 projectPaths() 把 userRoot 退回 cwd，
  # 讀到不存在的 pid 檔後誤報「服務沒在跑」（2026-08-29 因此誤導了一輪診斷）。
  $env:BEYBLADE_INSTALL_ROOT = $appDir
  $env:BEYBLADE_APP_ROOT     = $appRoot
  $env:BEYBLADE_USER_ROOT    = $userDir
  Push-Location -LiteralPath $appRoot
  $prev = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { & $node '--no-warnings' $control 'restart' 2>&1 | ForEach-Object { Log ("    " + $_) } }
  finally { [Console]::OutputEncoding = $prev; Pop-Location }
  Log ("離開代碼 : " + $LASTEXITCODE)
  Start-Sleep -Seconds 10
  Log ("執行後 /health : " + (ServedVersion))
} else { Log '>>> node 或 service-control.js 不存在，略過。' }

# --- 5. 收尾 ---
Log ''
Log '--- 5. 結果 ---'
$served = ServedVersion
Log ("current.json : $current")
Log ("/health      : $served")
$c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) {
  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue
  Log ("8787 : PID " + $c.OwningProcess + "，啟動於 " + $proc.CreationDate)
}
Log ''
if ($served -eq $current) { Log '=== 換版成功：上面某一層是有效的，看哪一層之後 /health 變了 ===' }
else { Log '=== 仍未換版：兩層都失敗，輸出裡的離開代碼與訊息就是根因 ===' }

Log ''
Log ("完成，結果已寫入 " + $out)
Log '請把這個檔案整份給我。'
