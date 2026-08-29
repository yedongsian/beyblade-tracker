# 在「測試帳號」執行：抓首次啟動的實際耗時證據。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\capture-timing.ps1


# 版本不寫死：先讀已安裝的 current.json，讀不到就取 versions 下的第一個目錄。
# 2026-08-29 升 1.0.1 前，這些腳本共有 17 處寫死的 1.0.0，升版會全部失效。
$btInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$installedVersion = $(try { (Get-Content -LiteralPath (Join-Path $btInstallRoot 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $installedVersion) { $installedVersion = (Get-ChildItem -LiteralPath (Join-Path $btInstallRoot 'versions') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name }

$out     = (Join-Path $PSScriptRoot 'startup-timing.txt')
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

Log ("=== 首次啟動耗時證據  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 關鍵時間戳 ---'
$appVer = Join-Path $appDir "versions\$installedVersion"
if (Test-Path -LiteralPath $appVer) {
  Log ("安裝目錄建立   : " + (Get-Item -LiteralPath $appVer).CreationTime.ToString('o'))
}
$cj = Join-Path $appDir 'current.json'
if (Test-Path -LiteralPath $cj) { Log ("current.json   : " + (Get-Item -LiteralPath $cj).LastWriteTime.ToString('o')) }
foreach ($f in 'logs\tracker.log','data\tracker.db','runtime\tracker.pid','runtime\tracker-status.json') {
  $p = Join-Path $userDir $f
  if (Test-Path -LiteralPath $p) {
    $i = Get-Item -LiteralPath $p
    Log ("{0,-24} 建立 {1}  最後寫入 {2}  {3} bytes" -f $f, $i.CreationTime.ToString('HH:mm:ss'), $i.LastWriteTime.ToString('HH:mm:ss'), $i.Length)
  } else { Log ("{0,-24} 不存在" -f $f) }
}

Log ''
Log '--- tracker-status.json ---'
$sf = Join-Path $userDir 'runtime\tracker-status.json'
if (Test-Path -LiteralPath $sf) { Get-Content -LiteralPath $sf -Raw | ForEach-Object { Log $_ } } else { Log '不存在' }

Log ''
Log '--- tracker.log 前 40 行（含時間戳，可看出各階段耗時）---'
$tl = Join-Path $userDir 'logs\tracker.log'
if ((Test-Path -LiteralPath $tl) -and (Get-Item -LiteralPath $tl).Length -gt 0) {
  Get-Content -LiteralPath $tl -TotalCount 40 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) }
} else { Log '    (空)' }

Log ''
Log '--- 現在的 /health ---'
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Log ("status  : " + $h.status)
  Log ("version : " + $h.release.version)
  if ($h.browser) { Log ("browser : available=" + $h.browser.available + " name=" + $h.browser.name) }
} catch { Log ("連不上: " + $_.Exception.Message) }

Log ''
Log '=== 重啟計時測試：停止後重新啟動，實測要多久才健康 ==='
$appScripts = Join-Path $appVer 'scripts\service-control.js'
$node = Join-Path $appVer 'runtime\node.exe'
if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $appScripts)) {
  & $node '--no-warnings' $appScripts stop 2>&1 | Out-Null
  Start-Sleep -Seconds 3
  Log ("停止後 8787 監聽 : " + [bool](Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue))

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Start-Process -FilePath $node -ArgumentList @('--no-warnings', $appScripts, 'start') -WindowStyle Hidden | Out-Null
  $ok = $false
  while ($sw.Elapsed.TotalSeconds -lt 120) {
    Start-Sleep -Milliseconds 500
    try {
      $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
      if ($h.status) { $ok = $true; break }
    } catch { }
  }
  $sw.Stop()
  if ($ok) {
    Log ("第二次啟動耗時 : {0:N1} 秒" -f $sw.Elapsed.TotalSeconds)
    if ($sw.Elapsed.TotalSeconds -gt 45) { Log '  >>> 超過 E2E 允許的 45 秒門檻' }
  } else {
    Log '第二次啟動 : 120 秒內未健康'
  }
} else { Log '找不到 node 或 service-control.js，跳過重啟測試' }

Log ''
Log ("完成，結果已寫入 " + $out)
