# 在「測試帳號」的各個檢查點執行，把當下狀態附加到共用報告檔。
# 不需系統管理員權限。切回工作帳號後把報告交給 Claude 判讀。
#
# 用法（在測試帳號的 PowerShell 視窗）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\collect-evidence.ps1 -Label 安裝後
#
# 建議的 Label：安裝後 / 登入後 / 匯出後 / 解除安裝-保留 / 解除安裝-刪除 / 匯入後


# 版本不寫死：先讀已安裝的 current.json，讀不到就取 versions 下的第一個目錄。
# 2026-08-29 升 1.0.1 前，這些腳本共有 17 處寫死的 1.0.0，升版會全部失效。
$btInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$installedVersion = $(try { (Get-Content -LiteralPath (Join-Path $btInstallRoot 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $installedVersion) { $installedVersion = (Get-ChildItem -LiteralPath (Join-Path $btInstallRoot 'versions') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name }

param([Parameter(Mandatory=$true)][string]$Label)

$report = (Join-Path $PSScriptRoot 'evidence-report.txt')
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$out = [System.Collections.Generic.List[string]]::new()

function Add($text) { $out.Add($text) }

Add ''
Add ('=' * 70)
Add ("CHECKPOINT : $Label")
Add ("USER       : $env:USERNAME")
Add ("TIME       : " + (Get-Date).ToString('o'))
Add ('=' * 70)

Add ''
Add '--- 1. 安裝目錄 ---'
Add ("app dir exists : " + (Test-Path -LiteralPath $appDir))
if (Test-Path -LiteralPath $appDir) {
  Add ("path           : $appDir")
  $cj = Join-Path $appDir 'current.json'
  Add ("current.json   : " + $(if (Test-Path -LiteralPath $cj) { (Get-Content -LiteralPath $cj -Raw).Trim() } else { 'MISSING' }))
  $v = Join-Path $appDir 'versions'
  if (Test-Path -LiteralPath $v) { foreach ($d in Get-ChildItem -LiteralPath $v -Directory) { Add ("version dir    : " + $d.Name) } }
  $n = Join-Path $appDir "versions\$installedVersion\runtime\node.exe"
  Add ("bundled node   : " + (Test-Path -LiteralPath $n))
}

Add ''
Add '--- 2. 服務程序（驗證用的是內建 Node，不是系統 Node）---'
try {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match 'Beyblade' -or $_.CommandLine -match 'tracker') }
  if ($procs) {
    foreach ($p in $procs) {
      Add ("PID $($p.ProcessId) : $($p.CommandLine)")
      if ($p.CommandLine -match [regex]::Escape('Program Files\nodejs')) { Add '  >>> 警告：使用系統 Node，不是內建 runtime' }
      elseif ($p.CommandLine -match [regex]::Escape("versions\$installedVersion\runtime\node.exe")) { Add '  >>> OK：使用安裝包內建 runtime' }
    }
  } else { Add 'no tracker node process' }
} catch { Add ("query failed: " + $_.Exception.Message) }

Add ''
Add '--- 3. Port 8787 ---'
try {
  $c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
  if ($c) { foreach ($x in $c) { Add ("listening, owning PID " + $x.OwningProcess) } } else { Add 'no listener' }
} catch { Add 'query failed' }

Add ''
Add '--- 4. /health ---'
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Add ("status         : " + $h.status)
  Add ("version        : " + $h.release.version)
  if ($h.browser) { Add ("browser        : available=$($h.browser.available) name=$($h.browser.name)") }
} catch { Add ("unreachable: " + $_.Exception.Message) }

Add ''
Add '--- 5. 自動啟動 Run 機碼 ---'
$r = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).BeybladeTracker
Add $(if ($r) { "SET -> $r" } else { 'not set' })
if ($r -and $r -notmatch 'noninteractive') { Add '  >>> 警告：缺少 noninteractive，登入時可能跳視窗' }

Add ''
Add '--- 6. 開始功能表捷徑 ---'
$sm = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Beyblade Tracker'
if (Test-Path -LiteralPath $sm) {
  foreach ($f in Get-ChildItem -LiteralPath $sm) { Add ("  " + $f.Name) }
} else { Add 'no shortcut folder' }

Add ''
Add '--- 7. 使用者資料 ---'
if (Test-Path -LiteralPath $userDir) {
  $files = Get-ChildItem -LiteralPath $userDir -Recurse -File -ErrorAction SilentlyContinue
  Add ("file count     : " + $files.Count)
  foreach ($f in $files) { Add ("  {0,-52} {1,10}" -f $f.FullName.Replace($userDir, '...'), $f.Length) }
  $db = Join-Path $userDir 'data\tracker.db'
  if (Test-Path -LiteralPath $db) { Add ("tracker.db sha256 : " + (Get-FileHash -LiteralPath $db -Algorithm SHA256).Hash.ToLower()) }
} else { Add 'user data directory ABSENT' }

Add ''
$out | Add-Content -LiteralPath $report -Encoding utf8
$out | ForEach-Object { Write-Host $_ }
Write-Host ''
Write-Host "已附加到 $report" -ForegroundColor Green
