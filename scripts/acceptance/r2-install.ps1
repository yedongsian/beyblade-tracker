# 第二輪 步驟 1：移除舊版、安裝修正後的新版，並驗證 D-3 與 D-6 的修正。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\r2-install.ps1


# 版本不寫死：先讀已安裝的 current.json，讀不到就取 versions 下的第一個目錄。
# 2026-08-29 升 1.0.1 前，這些腳本共有 17 處寫死的 1.0.0，升版會全部失效。
$btInstallRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$installedVersion = $(try { (Get-Content -LiteralPath (Join-Path $btInstallRoot 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $installedVersion) { $installedVersion = (Get-ChildItem -LiteralPath (Join-Path $btInstallRoot 'versions') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).Name }

$out  = (Join-Path $PSScriptRoot 'r2-install-result.txt')
$dest = $PSScriptRoot
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir  = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$pending = Join-Path $userDir 'runtime\pending-import.beyblade-transfer'

Log ("=== 第二輪 安裝  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 安裝前狀態 ---'
Log ("舊版仍安裝     : " + (Test-Path -LiteralPath $appDir))
Log ("使用者資料存在 : " + (Test-Path -LiteralPath $userDir))
Log ("pending 匯入檔 : " + (Test-Path -LiteralPath $pending))
if (Test-Path -LiteralPath $pending) {
  Log '  註：新版已修正 D-6。若此檔仍在，新版啟動時應能正常套用它，'
  Log '      或在失敗時將它改名為 .failed-* 而不再讓服務無法啟動。'
}

Log ''
Log '======================================================================'
if (Test-Path -LiteralPath $appDir) {
  Log ' 已偵測到安裝目錄，直接進行安裝後檢查。'
  Log '======================================================================'
} else {
  Log ' 步驟 1：執行雜湊驗證，MATCH 後再安裝：'
  Log ("   powershell -NoProfile -ExecutionPolicy Bypass -File $dest\verify-installer.ps1")
  Log ''
  Log ' 步驟 2：帶 log 執行安裝器，全程使用預設值。失敗時才有依據可查：'
  Log ("   powershell -NoProfile -ExecutionPolicy Bypass -File $dest\install-with-log.ps1")
  Log '======================================================================'
  Read-Host '完成安裝後按 Enter'

  # 提早按 Enter 會讓下面所有檢查在安裝發生之前就量測，輸出與「安裝失敗」完全無法區分
  # （2026-08-11 就這樣誤判過一次）。所以這裡等安裝目錄真的出現，而不是相信那個 Enter。
  if (-not (Test-Path -LiteralPath $appDir)) {
    Write-Host '尚未偵測到安裝目錄。若安裝精靈還開著請完成它；若還沒執行安裝器，請現在執行。' -ForegroundColor Yellow
    Write-Host '最多等待 5 分鐘…' -ForegroundColor Yellow
    for ($w = 0; $w -lt 60 -and -not (Test-Path -LiteralPath $appDir); $w++) { Start-Sleep -Seconds 5 }
  }
  if (-not (Test-Path -LiteralPath $appDir)) {
    Log ''
    Log '>>> 等待逾時：安裝目錄始終未出現。'
    Log '>>> 這代表安裝未執行或未完成，而不是「安裝後檢查失敗」。下方各項檢查因此不具參考價值。'
    Log ("    請改用帶 log 的安裝：$dest\install-with-log.ps1，它會回報安裝器的離開代碼。")
  }
}

Start-Sleep -Seconds 5
Log ''
Log '--- 安裝結果 ---'
Log ("安裝目錄     : " + (Test-Path -LiteralPath $appDir))
$cj = Join-Path $appDir 'current.json'
if (Test-Path -LiteralPath $cj) { Log ("current.json : " + (Get-Content -LiteralPath $cj -Raw).Trim()) }

Log ''
Log '--- D-3 驗證：payload 不應含建置者的個人來源設定 ---'
$cfg = Join-Path $appDir "versions\$installedVersion\config"
if (Test-Path -LiteralPath $cfg) {
  Get-ChildItem -LiteralPath $cfg | ForEach-Object { Log ("    " + $_.Name + "  " + $_.Length + " bytes") }
  Log ("個人 sources.json 已排除 : " + (-not (Test-Path -LiteralPath (Join-Path $cfg 'sources.json'))) + "   （預期 True）")
  Log ("sources.example.json     : " + (Test-Path -LiteralPath (Join-Path $cfg 'sources.example.json')) + "   （預期 True）")
}
$fx = Join-Path $appDir "versions\$installedVersion\fixtures\beyblade-x.json"
Log ("fixtures 已打包           : " + (Test-Path -LiteralPath $fx) + "   （預期 True）")

Log ''
Log '--- 服務健康 ---'
$ok = $false
for ($i = 1; $i -le 90; $i++) {
  Start-Sleep -Seconds 1
  try {
    $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
    Log ("第 ${i} 秒 /health : " + $h.status + "  version=" + $h.release.version)
    $ok = $true
    ($h.sources | ForEach-Object { Log ("    來源 " + $_.key + "  enabled=" + $_.enabled + "  healthy=" + $_.healthy) })
    break
  } catch { }
}
if (-not $ok) { Log '>>> 90 秒內服務未就緒' }

Log ''
Log '--- D-6 驗證：pending 匯入檔的處置 ---'
Log ("pending 檔是否仍在 : " + (Test-Path -LiteralPath $pending))
$failed = @(Get-ChildItem -LiteralPath (Join-Path $userDir 'runtime') -Filter '*.failed-*' -ErrorAction SilentlyContinue)
if ($failed) { Log '已移置一旁的失敗匯入檔：'; foreach ($f in $failed) { Log ("    " + $f.Name) } }
Log '判定：pending 檔應已被消耗（套用成功）或被改名為 .failed-*（失敗但不阻擋啟動）。'
Log '      兩者皆可接受；唯獨「pending 仍在且服務起不來」代表 D-6 未修好。'

Log ''
Log '--- 目前資料庫筆數 ---'
$node = Join-Path $appDir "versions\$installedVersion\runtime\node.exe"
$db = Join-Path $userDir 'data\tracker.db'
if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $db)) {
  $prev = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { & $node (Join-Path $dest 'db-counts.mjs') $db | ForEach-Object { Log ("    " + $_) } }
  finally { [Console]::OutputEncoding = $prev }
}

Log ''
Log ("完成，結果已寫入 " + $out)
