# A-8：Telegram 通知與 Windows DPAPI 憑證保護驗收。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a8-telegram.ps1
#
# ⚠ 你的 Bot Token 只在瀏覽器的設定頁輸入。本腳本不會要求你輸入 Token，
#   也不會把任何憑證內容寫進報告檔 —— 只檢查密文結構與是否有明文外洩。

$out = (Join-Path $PSScriptRoot 'a8-result.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$userDir    = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$secretFile = Join-Path $userDir 'config\secrets.json'
# Telegram bot token 的格式：一串數字、冒號、再一串英數
$tokenPattern = '\d{6,}:[A-Za-z0-9_-]{30,}'

Log ("=== A-8 Telegram 與 DPAPI  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 前置：服務是否運作 ---'
$healthy = $false
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Log ("/health : " + $h.status)
  $healthy = $true
} catch { Log '/health : 連不上' }
if (-not $healthy) {
  Log ''
  Log '>>> 服務未運作。請先點開始功能表的「Beyblade Tracker」啟動，再重跑本腳本。'
  exit 1
}

Log ''
Log ('設定前 secrets.json 是否存在 : ' + (Test-Path -LiteralPath $secretFile))

Log ''
Log '======================================================================'
Log ' 請在瀏覽器開啟設定頁：  http://127.0.0.1:8787/settings'
Log ''
Log ' 在「Telegram」區塊輸入你自己的 Bot Token 與 Chat ID，按「儲存並測試」。'
Log ''
Log ' ⚠ Token 只輸入在該頁面。不要貼進本視窗，也不要貼進對話。'
Log '======================================================================'
Read-Host '設定完成後按 Enter'

Log ''
Log '--- 1. secrets.json 結構與加密狀態 ---'
if (-not (Test-Path -LiteralPath $secretFile)) {
  Log '>>> FAIL：找不到 secrets.json，憑證未被儲存。'
} else {
  $rawText = Get-Content -LiteralPath $secretFile -Raw -Encoding UTF8
  $doc = $rawText | ConvertFrom-Json
  Log ('檔案大小   : ' + (Get-Item -LiteralPath $secretFile).Length + ' bytes')
  Log ('version    : ' + $doc.version)
  Log ('provider   : ' + $doc.provider)
  if ($doc.provider -eq 'windows-dpapi-current-user') { Log '  OK：provider 為 Windows DPAPI CurrentUser' }
  else { Log '  >>> FAIL：provider 不是預期的 windows-dpapi-current-user' }

  $keys = @($doc.values.PSObject.Properties.Name)
  Log ('已儲存的鍵 : ' + ($keys -join ', '))
  foreach ($k in $keys) {
    $v = [string]$doc.values.$k
    $isB64 = $v -match '^[A-Za-z0-9+/=]+$'
    Log ("  {0,-24} 長度 {1,6}  base64格式={2}" -f $k, $v.Length, $isB64)
    if (-not $isB64) { Log '    >>> 值不是 base64，可能未加密' }
  }

  Log ''
  Log '--- 2. 明文外洩檢查（整份檔案掃描 Telegram token 格式）---'
  if ($rawText -match $tokenPattern) {
    Log '>>> FAIL：secrets.json 內出現疑似明文 Bot Token。'
  } else {
    Log 'PASS：檔案中未出現任何符合 Bot Token 格式的明文。'
  }
}

Log ''
Log '--- 3. 設定頁是否回傳 Token 明文 ---'
try {
  $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/settings' -TimeoutSec 10
  $html = $page.Content
  Log ('設定頁大小 : ' + $html.Length + ' bytes')
  if ($html -match $tokenPattern) {
    Log '>>> FAIL：設定頁 HTML 中出現疑似明文 Bot Token。'
  } else {
    Log 'PASS：設定頁 HTML 未回傳任何 Bot Token 明文。'
  }
  if ($html -match 'windows-dpapi-current-user') { Log 'OK：頁面顯示 DPAPI provider 字樣' }
  if ($html -match 'type="password"') { Log 'OK：Token 欄位為 password 型別' }
} catch {
  Log ('設定頁讀取失敗：' + $_.Exception.Message)
}

Log ''
Log '--- 4. 通知送達（由你確認）---'
$got = Read-Host '你的 Telegram 是否收到「Telegram 通知設定成功。」的訊息？(Y/N)'
Log ('通知送達   : ' + $got)

Log ''
Log '--- 5. 準備跨帳號解密測試 ---'
$copy = (Join-Path $PSScriptRoot 'secrets-crossuser-test.json')
if (Test-Path -LiteralPath $secretFile) {
  Copy-Item -LiteralPath $secretFile -Destination $copy -Force
  Log ('已複製密文到 : ' + $copy)
  Log '此複本僅供驗證「另一個 Windows 帳號無法解密」，驗證後會立即刪除。'
  Log '內容為 DPAPI 密文，非明文憑證。'
} else {
  Log '無 secrets.json，跳過'
}

Log ''
Log ("完成，結果已寫入 " + $out)
Log '請切回工作帳號，由 Claude 執行跨帳號解密測試。'
