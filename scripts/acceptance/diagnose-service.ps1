# 在「測試帳號」執行：診斷服務為何沒有監聽 8787。
# 會先看目前是否已恢復；若仍異常，停掉背景服務並在前景重跑，把被隱藏的錯誤訊息抓出來。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\diagnose-service.ps1


# 版本不寫死：先讀已安裝的 current.json，讀不到就取 versions 下的第一個目錄。
# 2026-08-29 升 1.0.1 前，這些腳本共有 17 處寫死的 1.0.0，升版會全部失效。
$btInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$installedVersion = $(try { (Get-Content -LiteralPath (Join-Path $btInstallRoot 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $installedVersion) { $installedVersion = (Get-ChildItem -LiteralPath (Join-Path $btInstallRoot 'versions') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name }

$out     = (Join-Path $PSScriptRoot 'service-diagnosis.txt')
$appDir  = Join-Path $env:LOCALAPPDATA "Programs\Beyblade Tracker\versions\$installedVersion"
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$node    = Join-Path $appDir 'runtime\node.exe'

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

Log ("=== 服務診斷  $env:USERNAME  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 目前狀態 ---'
$healthy = $false
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Log ("/health : " + $h.status + "  version=" + $h.release.version)
  $healthy = $true
} catch { Log ("/health : 連不上 - " + $_.Exception.Message) }

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Beyblade' }
if ($procs) { foreach ($p in $procs) { Log ("PID " + $p.ProcessId + " : " + $p.CommandLine) } } else { Log 'node 程序 : 無' }

if ($healthy) {
  Log ''
  Log '>>> 服務已恢復正常，先前只是啟動較慢。請改跑 collect-evidence.ps1 -Label 安裝後-恢復'
  exit 0
}

Log ''
Log '--- 現有 log 與狀態檔 ---'
foreach ($f in 'logs\tracker.log','runtime\tracker-status.json','runtime\tracker.pid') {
  $p = Join-Path $userDir $f
  if (Test-Path -LiteralPath $p) {
    $len = (Get-Item -LiteralPath $p).Length
    Log ("${f} : $len bytes")
    if ($len -gt 0) { Get-Content -LiteralPath $p -Tail 30 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) } }
  } else { Log ("${f} : 不存在") }
}

Log ''
Log '--- 使用者資料目錄結構 ---'
if (Test-Path -LiteralPath $userDir) {
  Get-ChildItem -LiteralPath $userDir -Recurse -Force -ErrorAction SilentlyContinue |
    ForEach-Object { Log ("    " + $_.FullName.Replace($userDir,'...') + $(if ($_.PSIsContainer) { '\' } else { '  ' + $_.Length })) }
} else { Log '    目錄不存在' }

Log ''
Log '--- 停止背景服務 ---'
try {
  $r = & $node '--no-warnings' (Join-Path $appDir 'scripts\service-control.js') stop 2>&1 | Out-String
  Log ("exit=$LASTEXITCODE")
  $r -split "`n" | ForEach-Object { if ($_.Trim()) { Log ("    " + $_.TrimEnd()) } }
} catch { Log ("stop 失敗: " + $_.Exception.Message) }

foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Beyblade' })) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Seconds 2

Log ''
Log '--- 前景重跑 service.js（30 秒，抓被隱藏的錯誤）---'
$stdout = Join-Path $env:TEMP 'bt-service-stdout.txt'
$stderr = Join-Path $env:TEMP 'bt-service-stderr.txt'
$proc = Start-Process -FilePath $node -ArgumentList @('--no-warnings', (Join-Path $appDir 'bin\service.js')) `
  -WorkingDirectory $appDir -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Log ("前景 PID : " + $proc.Id)

for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) { Log ("!! 程序在第 ${i} 秒結束，離開代碼 " + $proc.ExitCode); break }
  try {
    $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
    Log ("第 ${i} 秒 /health OK : " + $h.status)
    break
  } catch { }
}
if (-not $proc.HasExited) {
  Log '30 秒後仍未健康，終止前景程序。'
  try { Stop-Process -Id $proc.Id -Force } catch {}
  Start-Sleep -Seconds 1
}

Log ''
Log '--- STDOUT ---'
if ((Test-Path $stdout) -and (Get-Item $stdout).Length -gt 0) { Get-Content $stdout | ForEach-Object { Log ("    " + $_) } } else { Log '    (空)' }
Log ''
Log '--- STDERR（關鍵）---'
if ((Test-Path $stderr) -and (Get-Item $stderr).Length -gt 0) { Get-Content $stderr | ForEach-Object { Log ("    " + $_) } } else { Log '    (空)' }

Log ''
Log '--- 執行後的 tracker.log ---'
$tl = Join-Path $userDir 'logs\tracker.log'
if ((Test-Path -LiteralPath $tl) -and (Get-Item -LiteralPath $tl).Length -gt 0) {
  Get-Content -LiteralPath $tl -Tail 40 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) }
} else { Log '    (仍為空)' }

Log ''
Log ("完成，結果已寫入 " + $out)
