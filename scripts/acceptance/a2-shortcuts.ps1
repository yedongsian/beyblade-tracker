# A-2 開始功能表捷徑驗收輔助（含 D-1 視窗狀態鑑識）。
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a2-shortcuts.ps1

$out = (Join-Path $PSScriptRoot 'a2-result.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
'@

function Report-Browsers([string]$phase) {
  Log ("--- 瀏覽器視窗狀態（$phase）---")
  $b = Get-Process -Name chrome, msedge, firefox -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 }
  if (-not $b) { Log '    沒有任何具主視窗的瀏覽器行程'; return }
  foreach ($p in $b) {
    $vis = [W.U]::IsWindowVisible($p.MainWindowHandle)
    $min = [W.U]::IsIconic($p.MainWindowHandle)
    Log ("    PID {0} {1}  visible={2} minimized={3}  標題='{4}'" -f $p.Id, $p.ProcessName, $vis, $min, $p.MainWindowTitle)
    if (-not $vis) { Log '      >>> 視窗存在但不可見 —— 支持「繼承隱藏視窗狀態」假說' }
  }
}

Log ("=== A-2 捷徑驗收  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''
Log '--- 目前 launcher 相關行程 ---'
$all = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'launcher\.(ps1|vbs)' }
if ($all) { foreach ($p in $all) { Log ("    PID " + $p.ProcessId + " : " + $p.CommandLine) } } else { Log '    無' }
Log ''
Report-Browsers '測試前'
Log ''
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  Log ("/health : " + $h.status + "  version=" + $h.release.version)
} catch { Log ("/health : 連不上 - " + $_.Exception.Message) }

Log ''
Log '======================================================================'
Log ' 請依提示逐一操作，每做完一項回到本視窗按 Enter。'
Log ' 順序固定：停止背景追蹤務必最後。'
Log '======================================================================'

Read-Host "`n[1/5] 點『服務狀態』捷徑。應顯示服務資訊、繁中無亂碼、結尾提示按 Enter 關閉。完成後按 Enter"
$r1 = Read-Host '  結果如何？(PASS / FAIL，可補述)'
Log ''
Log ("[1] 服務狀態 : " + $r1)

Read-Host "`n[2/5] 點『Beyblade Tracker』捷徑 —— 這是 D-1 的關鍵。不要手動去點工作列，直接回來按 Enter"
Start-Sleep -Seconds 3
Log ''
Report-Browsers '點擊 Beyblade Tracker 捷徑之後'
$r2 = Read-Host '  管理頁有正常顯示嗎？(PASS / FAIL，若只在工作列請寫 FAIL-隱藏)'
Log ("[2] Beyblade Tracker : " + $r2)

Read-Host "`n[3/5] 點『匯出／移機』捷徑，應出現另存新檔對話框（.beyblade-transfer）。按取消後回來按 Enter"
$r3 = Read-Host '  結果如何？(PASS / FAIL)'
Log ("[3] 匯出／移機 : " + $r3)

Read-Host "`n[4/5] 點『匯入／移機』捷徑，應出現開啟檔案對話框。按取消後回來按 Enter"
$r4 = Read-Host '  結果如何？(PASS / FAIL)'
Log ("[4] 匯入／移機 : " + $r4)

Log ''
Log '--- [5] 停止背景追蹤：計時 ---'
Read-Host "`n[5/5] 現在去點『停止背景追蹤』捷徑，然後立刻回來按 Enter 開始計時"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$stopped = $false
while ($sw.Elapsed.TotalSeconds -lt 120) {
  Start-Sleep -Milliseconds 500
  if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { $stopped = $true; break }
}
$sw.Stop()
if ($stopped) {
  Log ("8787 停止監聽耗時 : {0:N1} 秒（自按下 Enter 起算）" -f $sw.Elapsed.TotalSeconds)
  if ($sw.Elapsed.TotalSeconds -gt 35) { Log '  >>> 超過 service-control 的 35 秒停止上限，值得注意' }
} else { Log '120 秒內 8787 仍在監聽 —— 停止失敗或遠超預期' }

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Beyblade' }
if ($procs) { Log '停止後仍存在的 node 行程：'; foreach ($p in $procs) { Log ("    PID " + $p.ProcessId) } } else { Log '停止後已無 Beyblade node 行程' }

Log ''
Log ("完成，結果已寫入 " + $out)
Log '提醒：服務目前是停止的。後續項目請用「Beyblade Tracker」捷徑重新啟動。'
