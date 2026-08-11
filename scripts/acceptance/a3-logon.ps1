# A-3 登入自動啟動驗收（修正版：只看本工作階段，並排除執行本腳本的終端機）。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a3-logon.ps1

$out = (Join-Path $PSScriptRoot 'a3-result.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
'@

$userDir   = Join-Path $env:LOCALAPPDATA 'BeybladeTracker'
$sessionId = (Get-Process -Id $PID).SessionId

# 本腳本自己的祖先鏈（powershell → WindowsTerminal 等），全部排除以免誤報。
$ancestors = @()
$cur = $PID
for ($i = 0; $i -lt 6; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $cur" -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $ancestors += [int]$p.ProcessId
  $cur = [int]$p.ParentProcessId
  if ($cur -le 0) { break }
}

function Safe-StartTime($proc) { try { return $proc.StartTime } catch { return $null } }

Log ("=== A-3 登入自動啟動  " + $env:USERNAME + "  工作階段 " + $sessionId + "  " + (Get-Date).ToString('o') + " ===")
Log ''

Log '--- 1. 自動啟動機碼 ---'
$r = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).BeybladeTracker
if ($r) {
  Log ("SET -> " + $r)
  if ($r -match 'noninteractive') { Log '  OK：含 noninteractive' } else { Log '  >>> 缺少 noninteractive' }
} else { Log '>>> 機碼不存在 —— A-3 FAIL' }

Log ''
Log '--- 2. 登入時間 vs 服務就緒時間 ---'
$explorer = Get-Process explorer -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -eq $sessionId } |
  ForEach-Object { $t = Safe-StartTime $_; if ($t) { [pscustomobject]@{ P = $_; T = $t } } } |
  Sort-Object T | Select-Object -First 1
if ($explorer) { Log ("本次登入（explorer 啟動）: " + $explorer.T.ToString('HH:mm:ss')) }
else { Log '無法取得本工作階段的 explorer 啟動時間' }

$sf = Join-Path $userDir 'runtime\tracker-status.json'
if (Test-Path -LiteralPath $sf) {
  $st = Get-Content -LiteralPath $sf -Raw -Encoding UTF8 | ConvertFrom-Json
  $started = [DateTime]::Parse($st.startedAt).ToLocalTime()
  Log ("服務 startedAt          : " + $started.ToString('HH:mm:ss'))
  Log ("服務 status / PID       : " + $st.status + " / " + $st.pid)
  if ($explorer) {
    $delta = ($started - $explorer.T).TotalSeconds
    Log ("登入到服務啟動          : {0:N1} 秒" -f $delta)
    if ($delta -lt -5) { Log '  >>> 服務早於本次登入 —— 可能未真正登出' }
  }
} else { Log '>>> tracker-status.json 不存在' }

Log ''
Log '--- 3. 服務健康（完整內容，用以解釋 degraded）---'
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 10
  ($h | ConvertTo-Json -Depth 6) -split "`n" | ForEach-Object { Log ("    " + $_.TrimEnd()) }
} catch { Log ("/health : 連不上 - " + $_.Exception.Message) }

Log ''
Log '--- 4. 登入是否跳出視窗（A-3 核心；已排除本腳本的終端機）---'
$suspect = Get-Process -Name powershell, pwsh, wscript, cscript, conhost, WindowsTerminal -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -eq $sessionId -and $_.MainWindowHandle -ne 0 -and $ancestors -notcontains $_.Id }
if ($suspect) {
  Log '>>> 發現具主視窗的指令碼／主控台行程：'
  foreach ($p in $suspect) {
    $t = Safe-StartTime $p
    Log ("    PID {0} {1}  visible={2}  標題='{3}'  啟動 {4}" -f $p.Id, $p.ProcessName, [W.U]::IsWindowVisible($p.MainWindowHandle), $p.MainWindowTitle, $(if ($t) { $t.ToString('HH:mm:ss') } else { '不明' }))
  }
} else {
  Log 'OK：本工作階段沒有任何非預期的指令碼／主控台視窗'
}

Log ''
Log '--- 5. launcher 行程（含啟動時間）---'
$l = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'launcher\.(ps1|vbs)' }
if ($l) {
  foreach ($p in $l) {
    $when = if ($p.CreationDate) { ([DateTime]$p.CreationDate).ToString('HH:mm:ss') } else { '不明' }
    Log ("    PID {0}  啟動 {1}" -f $p.ProcessId, $when)
    Log ("      " + $p.CommandLine)
  }
  Log '    註：launcher 完成後應自行結束；長時間殘留代表卡在某個等待。'
} else { Log '    無（正常）' }

Log ''
Log '--- 6. Beyblade node 行程 ---'
$n = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Beyblade' }
if ($n) { foreach ($p in $n) { Log ("    PID " + $p.ProcessId + " : " + ($p.CommandLine -replace '.*versions', 'versions')) } } else { Log '    無' }

Log ''
Log ("完成，結果已寫入 " + $out)
