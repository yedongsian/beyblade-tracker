# A-7 匯入診斷：分辨「暫存失敗」還是「暫存成功但服務未重啟」，並在可行時完成匯入。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a7-import-diag.ps1

$out  = (Join-Path $PSScriptRoot 'a7-import-diag.txt')
$dest = $PSScriptRoot
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$appRoot = Join-Path $appDir 'versions\1.0.0'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$db      = Join-Path $userDir 'data\tracker.db'
$pending = Join-Path $userDir 'runtime\pending-import.beyblade-transfer'
$node    = Join-Path $appRoot 'runtime\node.exe'
$counter = Join-Path $dest 'db-counts.mjs'

function Run-Node([string]$Script, [string]$Argument) {
  $prev = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { return & $node $Script $Argument } finally { [Console]::OutputEncoding = $prev }
}

Log ("=== A-7 匯入診斷  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 1. 暫存匯入檔是否存在（關鍵判別）---'
if (Test-Path -LiteralPath $pending) {
  $p = Get-Item -LiteralPath $pending
  Log ("存在 : " + $p.FullName)
  Log ("大小 : " + $p.Length.ToString('N0') + " bytes   寫入時間 : " + $p.LastWriteTime.ToString('HH:mm:ss'))
  Log '  → import.js 成功完成暫存。問題出在「服務未重新啟動」，因此 applyPendingTransfer 從未執行。'
} else {
  Log '不存在'
  Log '  → import.js 未能完成暫存（或檔案已被套用）。'
}

Log ''
Log '--- 2. 服務與行程狀態 ---'
$listen = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
Log ("8787 監聽 : " + $(if ($listen) { '是' } else { '否' }))
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Beyblade' }
if ($procs) { foreach ($x in $procs) { Log ("    node PID " + $x.ProcessId) } } else { Log '    無 Beyblade node 行程' }
$lch = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'launcher\.ps1' }
if ($lch) {
  Log '    >>> 有殘留的 launcher 行程（D-4 徵兆）：'
  foreach ($x in $lch) {
    $when = if ($x.CreationDate) { ([DateTime]$x.CreationDate).ToString('HH:mm:ss') } else { '不明' }
    Log ("        PID " + $x.ProcessId + "  啟動 " + $when)
  }
} else { Log '    無殘留 launcher 行程' }

Log ''
Log '--- 3. tracker.log 最後 20 行 ---'
$tl = Join-Path $userDir 'logs\tracker.log'
if (Test-Path -LiteralPath $tl) {
  Get-Content -LiteralPath $tl -Tail 20 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) }
} else { Log '    找不到 tracker.log' }

Log ''
Log '--- 4. 匯入前的資料庫筆數（目前狀態）---'
if (Test-Path -LiteralPath $db) { Run-Node $counter $db | ForEach-Object { Log ("    " + $_) } }

if (Test-Path -LiteralPath $pending) {
  Log ''
  Log '======================================================================'
  Log ' 暫存匯入檔存在 —— 只要服務成功啟動一次，匯入就會自動套用。'
  Log ' 本腳本將直接以內建 node 啟動服務（繞過 launcher，以便看見錯誤）。'
  Log '======================================================================'
  Read-Host '按 Enter 開始啟動服務'

  Log ''
  Log '--- 5. 直接啟動服務並擷取輸出 ---'
  $so = Join-Path $env:TEMP 'a7-start-out.txt'
  $se = Join-Path $env:TEMP 'a7-start-err.txt'
  $proc = Start-Process -FilePath $node -ArgumentList @('--no-warnings', (Join-Path $appRoot 'bin\service.js')) `
    -WorkingDirectory $appRoot -PassThru -NoNewWindow -RedirectStandardOutput $so -RedirectStandardError $se
  Log ("服務 PID : " + $proc.Id)

  $ok = $false
  for ($i = 1; $i -le 90; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { Log ("!! 服務在第 ${i} 秒結束，離開代碼 " + $proc.ExitCode); break }
    try {
      $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
      Log ("第 ${i} 秒 /health : " + $h.status)
      $ok = $true
      break
    } catch { }
  }
  if (-not $ok -and -not $proc.HasExited) { Log '90 秒內未健康。' }

  Log ''
  Log '--- STDERR ---'
  if ((Test-Path $se) -and (Get-Item $se).Length -gt 0) { Get-Content $se -Encoding UTF8 | ForEach-Object { Log ("    " + $_) } } else { Log '    (空)' }
  Log '--- STDOUT（最後 20 行）---'
  if ((Test-Path $so) -and (Get-Item $so).Length -gt 0) { Get-Content $so -Tail 20 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) } } else { Log '    (空)' }

  Log ''
  Log '--- 6. 套用後的資料庫筆數 ---'
  if (Test-Path -LiteralPath $db) { Run-Node $counter $db | ForEach-Object { Log ("    " + $_) } }
  Log ''
  Log ("暫存檔是否已被消耗 : " + (-not (Test-Path -LiteralPath $pending)) + "  （套用成功後應為 True）")
  Log ''
  Log '註：此服務由本腳本在前景啟動，關閉本視窗會一併結束它。'
  Log '    驗證完成後請改用開始功能表的「Beyblade Tracker」正常啟動。'
}

Log ''
Log ("完成，結果已寫入 " + $out)
