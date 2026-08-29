# 更新流程驗收：記錄版本與資料筆數，供更新前／後比對。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\update-test-check.ps1 -Label 更新前
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\update-test-check.ps1 -Label 更新後
#
# 「資料沒掉」必須是比對出來的，不是憑印象。本腳本每次附加一段，同一個檔案裡就能直接對照。

param([Parameter(Mandatory = $true)][string]$Label)

$out = (Join-Path $PSScriptRoot 'update-test-counts.txt')
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

Log ''
Log ("########## $Label   " + (Get-Date).ToString('o') + " ##########")

$currentPath = Join-Path $appDir 'current.json'
$installed = $(try { (Get-Content -LiteralPath $currentPath -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '>>> 讀不到 current.json' })
Log ("current.json 版本 : $installed")

try {
  $health = Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 10 -ErrorAction Stop
} catch {
  Log '>>> /health 無回應 —— 服務未啟動或仍在啟動中。等 30 秒後重跑本腳本。'
  Log ("完成，結果已寫入 " + $out)
  exit 1
}

Log ("/health 回報版本  : " + $health.release.version)
Log ''
Log '--- 資料筆數 ---'
$counts = $health.counts
foreach ($name in ($counts.PSObject.Properties.Name | Sort-Object)) {
  Log ("    {0,-12} {1,8}" -f $name, $counts.$name)
}

Log ''
Log '--- 發行資訊 ---'
Log ("    通道       : " + $health.release.channel)
Log ("    更新來源   : " + $(if ($health.release.updateManifestUrl) { $health.release.updateManifestUrl } else { '>>> 未設定（服務沒讀到環境變數）' }))
Log ("    整體狀態   : " + $health.status)

Log ''
Log ("完成，結果已寫入 " + $out)
Log '更新前後都跑過之後，把這個檔案的內容給我，資料筆數必須完全相同。'
