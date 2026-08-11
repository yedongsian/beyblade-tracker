# A-8 診斷：找出設定頁儲存 Telegram 憑證失敗的原因。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a8-diag.ps1

$out = (Join-Path $PSScriptRoot 'a8-diag-result.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

$userDir = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$appRoot = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker\versions\1.0.0'
$node    = Join-Path $appRoot 'runtime\node.exe'

Log ("=== A-8 診斷  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 1. tracker.log 最後 25 行（伺服器端錯誤會記在這裡）---'
$tl = Join-Path $userDir 'logs\tracker.log'
if (Test-Path -LiteralPath $tl) {
  Get-Content -LiteralPath $tl -Tail 25 -Encoding UTF8 | ForEach-Object { Log ("    " + $_) }
} else { Log '    找不到 tracker.log' }

Log ''
Log '--- 2. config 目錄狀態 ---'
$cfgDir = Join-Path $userDir 'config'
Log ("config 目錄存在 : " + (Test-Path -LiteralPath $cfgDir))
if (Test-Path -LiteralPath $cfgDir) {
  Get-ChildItem -LiteralPath $cfgDir -Force | ForEach-Object { Log ("    " + $_.Name + "  " + $_.Length + " bytes") }
}
# 寫入權限實測
try {
  if (-not (Test-Path -LiteralPath $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }
  $probe = Join-Path $cfgDir '.a8-write-probe'
  Set-Content -LiteralPath $probe -Value 'probe' -Encoding utf8
  Remove-Item -LiteralPath $probe -Force
  Log 'config 目錄可寫 : YES'
} catch { Log ("config 目錄可寫 : NO — " + $_.Exception.Message) }

Log ''
Log '--- 3. 直接以 PowerShell 測 DPAPI（與 secret-store.js 相同的指令）---'
$dpapiScript = @'
$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;
$raw=[Console]::In.ReadToEnd();$bytes=[Convert]::FromBase64String($raw);
$entropy=[Text.Encoding]::UTF8.GetBytes('BeybladeTracker/secrets/v1');
$out=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);
[Console]::Out.Write([Convert]::ToBase64String($out))
'@
try {
  $inputB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('a8-diag-probe'))
  $cipher = $inputB64 | & powershell.exe -NoProfile -NonInteractive -Command $dpapiScript
  Log ("exit code : $LASTEXITCODE")
  Log ("密文長度  : " + $(if ($cipher) { $cipher.Length } else { 0 }))
  if ($LASTEXITCODE -eq 0 -and $cipher) { Log 'DPAPI（PowerShell 直接呼叫）: OK' } else { Log '>>> DPAPI（PowerShell 直接呼叫）: FAIL' }
} catch { Log (">>> DPAPI 測試例外 : " + $_.Exception.Message) }

Log ''
Log '--- 4. 以已安裝版本的 SecretStore 實測（假值、暫存路徑）---'
if (-not (Test-Path -LiteralPath $node)) {
  Log "找不到內建 node：$node"
} else {
  $diag = (Join-Path $PSScriptRoot 'a8-diag.mjs')
  $prev = [Console]::OutputEncoding
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { $r = & $node $diag $appRoot } finally { [Console]::OutputEncoding = $prev }
  $r | ForEach-Object { Log ("    " + $_) }
  Log ("node 離開代碼 : $LASTEXITCODE")
}

Log ''
Log '--- 5. 網路開關狀態（送測試通知需要）---'
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Log ("network.enabled            : " + $h.network.enabled)
  Log ("network.environmentEnabled : " + $h.network.environmentEnabled)
  Log ("network.userEnabled        : " + $h.network.userEnabled)
  if ($h.network.reason) { Log ("network.reason : " + $h.network.reason) }
} catch { Log ("讀取 /health 失敗：" + $_.Exception.Message) }

Log ''
Log ("完成，結果已寫入 " + $out)
