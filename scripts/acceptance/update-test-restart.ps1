# BT-REL-001：分辨「重啟機制壞掉」還是「安裝器沒觸發重啟」。
#   選單 [7]
#
# 診斷已證實：更新後沒有任何重啟發生（log 裡 apply 成功之後沒有 shutting down，
# 也沒有新的 web app 啟動，8787 仍由 17:03 啟動的 1.0.0 行程持有）。
# 這支腳本手動執行「安裝器本來該執行的那一行」，兩種結果各自指向不同的修法。

$out = (Join-Path $PSScriptRoot 'update-test-restart.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$vbs    = Join-Path $appDir 'launcher.vbs'

function Report([string]$label) {
  $cur = $(try { (Get-Content -LiteralPath (Join-Path $appDir 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '讀不到' })
  $srv = $(try { (Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 10 -ErrorAction Stop).release.version } catch { '無回應' })
  Log ("[$label] current.json=$cur   /health=$srv")
  $c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue
    $ver = if ($p -and $p.CommandLine -match 'versions\([^\]+)\') { $Matches[1] } else { '?' }
    Log ("[$label] 8787 由 PID " + $c.OwningProcess + "（版本目錄 $ver，啟動於 " + $p.CreationDate + "）持有")
  } else { Log "[$label] 沒有行程監聽 8787" }
}

Log ("=== BT-REL-001 手動重啟測試  " + (Get-Date).ToString('o') + " ===")
Log ''
Report '重啟前'

if (-not (Test-Path -LiteralPath $vbs)) { Log ">>> 找不到 $vbs，停止。"; exit 1 }

Log ''
Log '--- 執行安裝器本來該執行的那一行 ---'
Log ('  wscript.exe "' + $vbs + '" restart noninteractive')
Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" -ArgumentList @("`"$vbs`"", 'restart', 'noninteractive') -WindowStyle Hidden
Log '已送出。等待最多 150 秒讓服務換版…'

$deadline = (Get-Date).AddSeconds(150)
$switched = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $srv = $(try { (Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 5 -ErrorAction Stop).release.version } catch { $null })
  if ($srv -eq '1.0.1') { $switched = $true; break }
}

Log ''
Report '重啟後'

Log ''
if ($switched) {
  Log '=== 結論：重啟機制本身是好的 ==='
  Log '   手動執行同一行就換版成功 —> 問題在「安裝器的 [Run] 沒有真的觸發重啟」。'
  Log '   修法方向：更新流程不該把重啟外包給安裝器的 [Run] + nowait。'
} else {
  Log '=== 結論：重啟這條路徑本身就壞了 ==='
  Log '   手動執行也換不了版 —> 問題在 launcher restart／service-control，與安裝器無關。'
}
Log ''
Log '不論哪一種，共通的缺陷都是：apply 只憑「安裝器離開代碼 0」就回報成功，'
Log '從來沒有確認新版本真的在服務。'
Log ''
Log ("完成，結果已寫入 " + $out)
Log '請把這個檔案整份給我。'
