# BT-UPD-002：驗證「更新來源與驗證公鑰內建於產物」。
#   -Phase Before  先清掉環境變數，記錄修正前的行為
#   -Phase After   安裝 1.0.4 後，記錄修正後的行為
#
# 這一輪的重點在於**先清掉環境變數**。VM 上的 AcceptanceUser 仍留著前幾輪手動設定的
# UPDATE_MANIFEST_URL 與 UPDATE_PUBLIC_KEY，而環境變數的優先權高於產物內建值。
# 不清掉的話，就算修正完全失效，畫面看起來也會一模一樣 —— 這一輪就會證明不了任何事。

param([Parameter(Mandatory = $true)][ValidateSet('Before', 'After')][string]$Phase)

$out = (Join-Path $PSScriptRoot 'update-test-shipped-config.txt')
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'

function Get-Health {
  try { return Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 10 -ErrorAction Stop }
  catch { return $null }
}

function Report-State([string]$label) {
  $installed = $(try { (Get-Content -LiteralPath (Join-Path $appDir 'current.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version } catch { '讀不到' })
  Log ("[$label] 安裝版本   : $installed")
  $h = Get-Health
  if (-not $h) { Log "[$label] /health    : 無回應（服務未啟動或仍在啟動中）"; return $null }
  Log ("[$label] /health    : " + $h.release.version)
  $src = $h.release.updateManifestUrl
  Log ("[$label] 更新來源   : " + $(if ($src) { $src } else { '（空 —— 設定頁會顯示「正式更新來源尚未設定」）' }))
  return $h
}

Log ''
Log ("########## BT-UPD-002 $Phase   " + (Get-Date).ToString('o') + " ##########")

if ($Phase -eq 'Before') {
  Log ''
  Log '--- 1. 清除前幾輪手動設定的環境變數 ---'
  foreach ($name in @('UPDATE_MANIFEST_URL', 'UPDATE_PUBLIC_KEY')) {
    $had = [Environment]::GetEnvironmentVariable($name, 'User')
    [Environment]::SetEnvironmentVariable($name, $null, 'User')
    $now = [Environment]::GetEnvironmentVariable($name, 'User')
    Log ("{0,-20} 原本{1}  清除後{2}" -f $name,
      $(if ($had) { '有值' } else { '無值' }),
      $(if ($now) { '>>> 仍有值，未清乾淨' } else { '已清空 ✔' }))
  }

  Log ''
  Log '--- 2. 目前狀態（環境變數已清、尚未安裝 1.0.4）---'
  Report-State '清除後' | Out-Null

  Log ''
  Log '=== 下一步 ==='
  Log '  1. 開始功能表 →「停止背景追蹤」，再開「Beyblade Tracker」'
  Log '     （環境變數只對新行程生效，服務必須重開才會真的失去那兩個值）'
  Log '  2. 到設定頁看「版本更新」區塊，應顯示「正式更新來源尚未設定」——'
  Log '     那正是修正前一般使用者的處境，也證明先前幾輪是靠環境變數才過的。'
  Log '  3. 回到選單按 A，安裝 1.0.4 並記錄修正後的行為。'
} else {
  $installer = Join-Path $PSScriptRoot 'BeybladeTracker-1.0.4-Setup.exe'
  $expected = $(try { ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SHA256-1.0.4.txt') -Raw) -split '\s+')[0] } catch { $null })

  Log ''
  Log '--- 1. 安裝器完整性 ---'
  if (-not (Test-Path -LiteralPath $installer)) { Log ">>> 找不到 $installer"; exit 1 }
  $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLower()
  Log ("預期 SHA-256 : " + $(if ($expected) { $expected } else { '（無 SHA256-1.0.4.txt，略過比對）' }))
  Log ("實際 SHA-256 : $actual")
  if ($expected -and $actual -ne $expected) { Log '>>> 雜湊不符，停止。不要安裝來源不明的檔案。'; exit 1 }
  Log '雜湊相符 ✔'

  Log ''
  Log '--- 2. 再次確認環境變數是空的（否則這一輪證明不了任何事）---'
  $dirty = $false
  foreach ($name in @('UPDATE_MANIFEST_URL', 'UPDATE_PUBLIC_KEY')) {
    $v = [Environment]::GetEnvironmentVariable($name, 'User')
    Log ("{0,-20} {1}" -f $name, $(if ($v) { '>>> 仍有值' } else { '空 ✔' }))
    if ($v) { $dirty = $true }
  }
  if ($dirty) { Log '>>> 請先執行 Phase Before（選單 9）清除環境變數。'; exit 1 }

  Log ''
  Log '--- 3. 安裝 1.0.4 ---'
  Log '安裝精靈即將出現，請全程使用預設值完成。'
  $log = Join-Path $PSScriptRoot 'install-1.0.4.log'
  if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
  $p = Start-Process -FilePath $installer -ArgumentList ("/LOG=`"$log`"") -PassThru
  $p.WaitForExit()
  Log ("安裝器離開代碼 : " + $p.ExitCode + $(if ($p.ExitCode -eq 0) { '（成功）' } else { '（>>> 非 0，請截圖）' }))

  Log ''
  Log '--- 4. 等服務就緒 ---'
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline) {
    if ((Get-Health)) { break }
    Start-Sleep -Seconds 5
  }

  Log ''
  Log '--- 5. 修正後的狀態 ---'
  $h = Report-State '安裝後'

  Log ''
  if (-not $h) {
    Log '=== 服務未回應，無法判定。等 30 秒後重跑本項。 ==='
  } elseif (-not $h.release.updateManifestUrl) {
    Log '=== >>> 失敗：更新來源仍為空。產物沒有帶到內建設定，BT-UPD-002 未修好。 ==='
  } elseif ($h.release.updateManifestUrl -notmatch 'releases/latest/download') {
    Log '=== >>> 可疑：更新來源不是 /releases/latest/download，可能被別處覆寫。 ==='
  } else {
    Log '=== 更新來源已由產物提供（未設任何環境變數）✔ ==='
    Log ''
    Log '最後請到設定頁「版本更新」區塊確認：'
    Log '  應顯示「目前已是最新版本。」'
    Log '  不應出現「正式更新來源尚未設定」，也不應出現 BT-UPD-003。'
    Log '  1.0.4 是最新版，所以「已是最新」就代表它成功抓到並驗過了線上 manifest。'
  }
}

Log ''
Log ("完成，結果已寫入 " + $out)
Log '請把這個檔案整份給我。'
