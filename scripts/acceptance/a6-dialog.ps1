# A-6 互動錯誤對話框驗收（人工目視 + 剪貼簿安全性檢查）。
# 自動化 harness 已驗過非互動路徑的錯誤代碼；本腳本補的是唯一無法自動化的部分：
# 對話框是否真的彈得出來、能不能操作、以及「複製錯誤資訊」的內容是否安全。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File <驗收資料夾>\a6-dialog.ps1
#
# 本腳本只「讀取」真實安裝的兩支 launcher 檔，絕不修改或刪除真實安裝。

$out = (Join-Path $PSScriptRoot 'a6-dialog-result.txt')
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
function Log($t) { Write-Host $t; Add-Content -LiteralPath $out -Value $t -Encoding utf8 }

Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
'@

$realInstall = Join-Path $env:LOCALAPPDATA 'Programs\Beyblade Tracker'
$runId       = [Guid]::NewGuid().ToString('N')
$tempRoot    = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$installRoot = Join-Path $tempRoot "BeybladeTracker-DLG-$runId"

function Assert-DlgPath([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if ([System.IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or
      -not [System.IO.Path]::GetFileName($resolved).StartsWith("BeybladeTracker-DLG-$runId")) {
    throw "拒絕操作非本次驗收的路徑：$resolved"
  }
}
Assert-DlgPath $installRoot

Log ("=== A-6 互動錯誤對話框驗收  " + $env:USERNAME + "  " + (Get-Date).ToString('o') + " ===")
Log ''

$primaryError = $null
try {
  if (-not (Test-Path -LiteralPath $realInstall)) { throw "找不到已安裝的 Beyblade Tracker：$realInstall" }
  foreach ($f in 'launcher.ps1', 'launcher.vbs') {
    if (-not (Test-Path -LiteralPath (Join-Path $realInstall $f))) { throw "真實安裝內缺少 $f" }
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $realInstall 'launcher.ps1') -Destination $installRoot -Force
  Copy-Item -LiteralPath (Join-Path $realInstall 'launcher.vbs') -Destination $installRoot -Force
  # 刻意不建立 current.json —— 這就是注入的故障，會觸發 BT-LCH-001。
  Log "隔離測試目錄：$installRoot"
  Log '注入故障：缺少 current.json（預期 BT-LCH-001）'
  Log ''

  # 先清空剪貼簿，才能判斷「複製錯誤資訊」是否真的寫入了東西。
  Set-Clipboard -Value ("A6-SENTINEL-" + $runId)
  Log '已在剪貼簿放入哨兵值，用以判斷複製按鈕是否生效。'
  Log ''

  Log '======================================================================'
  Log ' 即將以「真實使用路徑」啟動：wscript.exe launcher.vbs（隱藏視窗、互動模式）'
  Log ' 這正是開始功能表捷徑的執行方式。'
  Log '======================================================================'
  Read-Host '按 Enter 啟動'

  Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" `
    -ArgumentList ('"' + (Join-Path $installRoot 'launcher.vbs') + '" start') | Out-Null

  Log ''
  Log '已啟動，等待 8 秒讓對話框出現…'
  Start-Sleep -Seconds 8

  Log ''
  Log '--- 視窗偵測 ---'
  $dlg = Get-Process -Name powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'Beyblade Tracker' }
  if ($dlg) {
    foreach ($p in $dlg) {
      Log ("    PID {0}  visible={1}  minimized={2}  標題='{3}'" -f $p.Id, [W.U]::IsWindowVisible($p.MainWindowHandle), [W.U]::IsIconic($p.MainWindowHandle), $p.MainWindowTitle)
    }
    Log '    偵測到對話框視窗。'
  } else {
    Log '    >>> 沒有偵測到標題為 Beyblade Tracker 的視窗。'
    Log '    >>> 若你畫面上也看不到對話框，代表隱藏模式下錯誤完全無聲無息 —— 這是重大發現。'
  }

  Log ''
  Log '======================================================================'
  Log ' 請看畫面上的對話框，並回答以下問題。'
  Log '======================================================================'
  $q1 = Read-Host "`n[1] 對話框有出現嗎？(Y/N)"
  $q2 = Read-Host '[2] 顯示的錯誤代碼是什麼？(預期 BT-LCH-001)'
  $q3 = Read-Host '[3] 繁體中文說明與復原指引是否正常、無亂碼？(Y/N，可補述)'
  $q4 = Read-Host '[4] 四個按鈕（複製錯誤資訊／問題回報／服務狀態／關閉）是否都看得到且可點？(Y/N)'
  Log ''
  Log ("[1] 對話框出現      : " + $q1)
  Log ("[2] 錯誤代碼        : " + $q2)
  Log ("[3] 繁中無亂碼      : " + $q3)
  Log ("[4] 按鈕可用        : " + $q4)

  Log ''
  Log '======================================================================'
  Log ' 現在請點對話框上的「複製錯誤資訊」按鈕（先不要關閉對話框）。'
  Log '======================================================================'
  Read-Host '點完後按 Enter，本腳本會讀取剪貼簿並檢查內容安全性'

  $clip = Get-Clipboard -Raw
  Log ''
  Log '--- 剪貼簿內容 ---'
  if ($null -eq $clip -or $clip -like "A6-SENTINEL-*") {
    Log '>>> 剪貼簿仍是哨兵值 —— 複製按鈕沒有生效，或你尚未點擊。'
  } else {
    $clip -split "`r?`n" | ForEach-Object { Log ("    " + $_) }

    Log ''
    Log '--- 安全性檢查（RUNBOOK 第 13 節要求）---'
    $problems = @()
    foreach ($needle in @($installRoot, $realInstall, $env:USERNAME, '.ps1', '.vbs', 'at line', 'CategoryInfo', 'Exception', 'StackTrace', 'http://', 'https://', 'token', 'webhook')) {
      if ($needle -and $clip.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $problems += $needle
      }
    }
    foreach ($needed in @('BT-LCH-', 'App version', 'UTC', 'Support reference')) {
      if ($clip.IndexOf($needed, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $problems += "缺少必要欄位：$needed"
      }
    }
    if ($problems.Count) {
      Log '>>> FAIL：'
      foreach ($p in $problems) { Log ("      - " + $p) }
    } else {
      Log 'PASS：只含錯誤代碼、App version、UTC 與 support reference，未洩漏路徑、stack、URL 或憑證字樣。'
    }
  }

  Log ''
  Log '======================================================================'
  Log ' 最後請按對話框的「關閉」按鈕。'
  Log '======================================================================'
  Read-Host '關閉後按 Enter'

  Start-Sleep -Seconds 2
  $still = Get-Process -Name powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'Beyblade Tracker' }
  if ($still) { Log '>>> 對話框關閉後行程仍存在，可能未正常結束。' } else { Log '對話框已關閉，行程已結束。' }
} catch {
  $primaryError = $_
} finally {
  # 清掉本次殘留的 launcher 行程與暫存目錄。
  $leftovers = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($runId) -and $_.ProcessId -ne $PID }
  foreach ($p in $leftovers) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }
  Assert-DlgPath $installRoot
  if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue }
  Log ''
  Log ("暫存目錄已清除 : " + (-not (Test-Path -LiteralPath $installRoot)))
  try { Set-Clipboard -Value '' } catch { }
}

Log ''
if ($primaryError) { Log ("執行中斷：" + $primaryError.Exception.Message) }
Log ("完成，結果已寫入 " + $out)
