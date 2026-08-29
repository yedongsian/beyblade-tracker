# 更新流程驗收：診斷「current.json 已是新版，但服務仍回報舊版」。
#   選單 [6]
#
# 2026-08-29 的實測：更新後 current.json = 1.0.1，/health 卻回報 1.0.0。
# /health 的版本讀自「執行中程式碼樹」的 package.json，所以那代表舊行程還在服務 8787。
# 這支腳本要指認出 8787 到底由哪一個版本目錄的行程持有。

$out = (Join-Path $PSScriptRoot 'update-test-diagnose.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

# 從命令列取出版本目錄名。刻意不用正規表示式：比對反斜線的樣式只要少一個跳脫，
# 字元類就沒有收尾，而且在 -match 裡是**靜默**失敗
# （2026-08-29 的第一份診斷輸出就因此少了兩項而我沒察覺）。字串搜尋沒有這個風險。
function Get-VersionFromCommandLine([string]$commandLine) {
  if ([string]::IsNullOrWhiteSpace($commandLine)) { return '?' }
  $marker = 'versions' + [char]92
  $i = $commandLine.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase)
  if ($i -lt 0) { return '?' }
  $rest = $commandLine.Substring($i + $marker.Length)
  $j = $rest.IndexOf([char]92)
  if ($j -lt 0) { return '?' }
  return $rest.Substring(0, $j)
}

$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'

Log ("=== 更新後版本落差診斷  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")

Log ''
Log '--- 1. 兩邊各自宣稱的版本 ---'
$current = $(try { (Get-Content -LiteralPath (Join-Path $appDir 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '讀不到' })
Log ("current.json        : $current")
$served = $null
try {
  $h = Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 10 -ErrorAction Stop
  $served = $h.release.version
  Log ("/health 回報        : $served")
  Log ("/health status      : " + $h.status)
} catch { Log '/health             : 無回應（服務未啟動）' }

if ($current -and $served -and $current -ne $served) {
  Log ''
  Log ">>> 落差確認：安裝的是 $current，實際在跑的是 $served。"
} elseif ($served) {
  Log ''
  Log "兩邊一致（$served），落差已自行消失 —— 表示先前只是重啟還沒完成。"
}

Log ''
Log '--- 2. 8787 由誰持有（關鍵） ---'
$conn = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if (-not $conn) { Log '沒有行程在監聽 8787。' }
foreach ($c in $conn) {
  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue
  Log ("PID       : " + $c.OwningProcess)
  if ($p) {
    Log ("啟動時間  : " + $p.CreationDate)
    Log ("命令列    : " + $p.CommandLine)
    $v = Get-VersionFromCommandLine ([string]$p.CommandLine)
    if ($v -ne '?') { Log (">>> 這個行程跑的是版本目錄 $v") }
  }
}

Log ''
Log '--- 3. 所有 Beyblade 相關的 node 行程 ---'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'Beyblade' }
if (-not $procs) { Log '無。' }
foreach ($p in $procs) {
  $ver = Get-VersionFromCommandLine ([string]$p.CommandLine)
  Log ("PID {0,-8} 版本 {1,-10} 啟動 {2}" -f $p.ProcessId, $ver, $p.CreationDate)
}
Log '（若同時看到兩個不同版本的行程，就是舊行程沒退場、佔住 8787。）'

Log ''
Log '--- 4. 已安裝的版本目錄 ---'
$vd = Join-Path $appDir 'versions'
if (Test-Path -LiteralPath $vd) {
  Get-ChildItem -LiteralPath $vd -Directory | ForEach-Object {
    $pkg = Join-Path $_.FullName 'package.json'
    $pv = $(try { (Get-Content -LiteralPath $pkg -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '讀不到 package.json' })
    Log ("    {0,-10} package.json={1}" -f $_.Name, $pv)
  }
} else { Log '    versions 目錄不存在' }

Log ''
Log '--- 5. pid 檔 ---'
$pidFile = Join-Path $userDir 'runtime\tracker.pid'
if (Test-Path -LiteralPath $pidFile) {
  $recorded = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  Log ("tracker.pid 記錄 : $recorded")
  $alive = Get-Process -Id $recorded -ErrorAction SilentlyContinue
  Log ("該 PID 是否存活  : " + [bool]$alive)
} else { Log 'tracker.pid 不存在' }

Log ''
Log '--- 6. tracker.log 最後 60 行 ---'
$log = Join-Path $userDir 'logs\tracker.log'
if (Test-Path -LiteralPath $log) {
  Get-Content -LiteralPath $log -Tail 60 -Encoding utf8 | ForEach-Object { Log ("    " + $_) }
} else { Log '    找不到 tracker.log' }

Log ''
Log ("完成，結果已寫入 " + $out)
Log '請把這個檔案整份給我。'
