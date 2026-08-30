# 更新流程驗收：回滾到前一版。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\update-test-rollback.ps1
#
# 只在設定頁沒有「回滾更新」按鈕時才需要用這支。版本不寫死：從 current.json 讀。

$out = (Join-Path $PSScriptRoot 'update-test-rollback.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

Log ("=== 更新回滾  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

$current = $(try { (Get-Content -LiteralPath (Join-Path $appDir 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { $null })
if (-not $current) { Log '>>> 讀不到 current.json，停止。'; exit 1 }
Log ("目前版本 : $current")
if ($current -ne '1.0.2') { Log '>>> 目前不是 1.0.2，沒有東西可以回滾。請先完成步驟 6 的更新。'; exit 1 }

$appRoot = Join-Path (Join-Path $appDir 'versions') $current
$node   = Join-Path $appRoot 'runtime\node.exe'
$script = Join-Path $appRoot 'bin\rollback.js'

# 這些環境變數不可省略。launcher.ps1 會設定它們；直接呼叫 node 就得自己設 ——
# projectPaths() 在缺少 BEYBLADE_USER_ROOT 時會把 userRoot 退回 cwd，於是腳本安靜地
# 去錯的地方找 pid 檔／回滾紀錄再回報「找不到」。2026-08-29 這個錯誤讓本腳本誤報
# BT-UPD-007，也讓 update-test-launcher 的第 4 層誤報「服務沒在跑」。
$env:BEYBLADE_INSTALL_ROOT = $appDir
$env:BEYBLADE_APP_ROOT     = $appRoot
$env:BEYBLADE_USER_ROOT    = (Join-Path $env:LOCALAPPDATA 'BeybladeTracker')

foreach ($p in @($node, $script)) {
  if (-not (Test-Path -LiteralPath $p)) { Log ">>> 找不到 $p，停止。"; exit 1 }
}

Log ''
Log '--- 執行 rollback ---'
$prev = [Console]::OutputEncoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Push-Location -LiteralPath $appRoot
try { & $node $script 2>&1 | ForEach-Object { Log ("    " + $_) } }
finally { [Console]::OutputEncoding = $prev; Pop-Location }
Log ("離開代碼 : " + $LASTEXITCODE)

Start-Sleep -Seconds 3
$after = $(try { (Get-Content -LiteralPath (Join-Path $appDir 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '>>> 讀不到' })
Log ''
Log ("回滾後版本 : $after")
if ($after -eq '1.0.1') { Log '回滾成功。' } else { Log '>>> 版本沒有回到 1.0.1，請截圖回報。' }

Log ''
Log '下一步：等服務就緒後跑'
Log ("  powershell -NoProfile -ExecutionPolicy Bypass -File " + (Join-Path $PSScriptRoot 'update-test-check.ps1') + " -Label 回滾後")
Log ''
Log ("完成，結果已寫入 " + $out)
