# Windows 實機驗收腳本

這些是 `docs/WINDOWS_ACCEPTANCE_CHECKLIST.md` 各項目所使用的輔助腳本。它們涵蓋
**封裝 E2E 結構上測不到**的部分：互動精靈、開始功能表捷徑、登入自動啟動、
互動錯誤對話框、以及兩個解除安裝分支。

執行步驟見 [`docs/WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md`](../../docs/WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md)。

## 怎麼用

腳本全部以 `$PSScriptRoot` 定位，因此**整個資料夾可以複製到任何地方**（乾淨 VM、
本機測試帳號、跨帳號共用資料夾）。所有輸出檔也寫在同一個資料夾裡。

```powershell
# 1. 把這個資料夾複製到測試帳號讀得到的位置
Copy-Item scripts\acceptance C:\Users\Public\BeybladeTracker-Acceptance -Recurse

# 2. 把要驗收的安裝器放進同一個資料夾，並更新 verify-installer.ps1 的 $expected
Copy-Item dist\windows\installer\BeybladeTracker-1.0.0-Setup.exe C:\Users\Public\BeybladeTracker-Acceptance\

# 3. 登入測試帳號後從那個資料夾執行
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\verify-installer.ps1
```

`verify-installer.ps1` 的 `$expected` 雜湊需要在每次換產物時更新 —— 這是刻意的，
它的用途就是確認你手上的檔案與建置機產出的是同一份。

## 檔案

| 腳本 | 用途 |
| --- | --- |
| `verify-installer.ps1` | 安裝前比對 SHA-256 |
| `install-with-log.ps1` | **帶 `/LOG` 安裝並回報離開代碼**。不要手動雙擊安裝器 —— 失敗時沒有依據可查 |
| `r2-install.ps1` | 安裝後檢查：D-3 payload 內容、fixtures、`/health`、來源清單、DB 筆數 |
| `r2-startup-timing.ps1` | 從 `tracker.log` 算出首次啟動的精確耗時 |
| `collect-evidence.ps1` | 任意檢查點的狀態快照（`-Label` 指定名稱），附加到 `evidence-report.txt` |
| `a2-shortcuts.ps1` | A-2 五個開始功能表捷徑，含視窗狀態鑑識 |
| `a3-logon.ps1` | A-3 登入自動啟動：機碼、登入→就緒耗時、登入時是否跳視窗 |
| `a6-dialog.ps1` | A-6b 互動錯誤對話框 ＋ **剪貼簿內容安全性檢查** |
| `a7-export.ps1` / `a7-import.ps1` / `a7-import-diag.ps1` | A-7 匯出／匯入移機 |
| `a8-telegram.ps1` / `a8-diag.ps1` / `a8-diag.mjs` | A-8 Telegram 與 DPAPI，含跨帳號解密驗證 |
| `a10-uninstall-keep.ps1` | A-10 解除安裝並保留資料 |
| `a11-uninstall-delete.ps1` | A-11 解除安裝並刪除資料 ⚠ 破壞性 |
| `capture-timing.ps1` / `diagnose-service.ps1` | 啟動耗時與服務故障診斷 |
| `update-test-setup.ps1` | 更新驗收前置：檢查版本與公鑰、寫入兩個環境變數並**讀回驗證** |
| `update-test-check.ps1` | 更新前／後的版本與資料筆數快照（`-Label`），附加到 `update-test-counts.txt` |
| `update-test-rollback.ps1` | 更新回滾（設定頁沒有回滾按鈕時才需要） |
| `db-counts.mjs` / `bundle-counts.mjs` / `verify-transfer.js` | 以唯讀方式讀取 DB 與移機檔的筆數與完整性 |

## 設計上要知道的事

**「按 Enter 表示完成」不是可靠的信號。** `r2-install.ps1`、`a10-uninstall-keep.ps1`、
`a11-uninstall-delete.ps1` 原本用 `Read-Host` 當作動作已發生的依據，若在動作真正完成前
按下 Enter，輸出會與「安裝失敗」「解除安裝失敗」**完全一樣**。2026-08-11 因此誤判兩次。

三支腳本現在會**等待實際狀態改變**（安裝目錄出現／消失，最多 5 分鐘），逾時則明確標示
「動作未執行或未完成，下方檢查不具參考價值」，而不是留下一份看起來像失敗的報告。

**不要在腳本等待提示時關掉視窗。** `a11-uninstall-delete.ps1` 曾在 `Read-Host` 處被關閉，
結果檔停在提示那一行、完全沒有判定段落 —— 解除安裝實際上成功了，但該項等於沒有證據。

**不要把版本相關的常數或結論寫死在腳本裡。** `r2-startup-timing.ps1` 曾內嵌第二輪的
15 秒門檻與「足以解釋 `BT-LCH-003` 誤報」的判語，於是在第四版把正常的 26.9 秒啟動
也寫成誤報，污染了證據檔。腳本應該只記錄觀測值，或從產物本身讀取門檻。

**破壞性腳本會先備份。** `a11-uninstall-delete.ps1` 在刪除前把使用者資料複製到
`a11-safety-copy`。該備份僅供意外時還原，驗收判定本身不依賴它。

**不要叫人從 Markdown 複製指令貼進主控台。** `UPDATE-TEST.md` 原本要人手動貼上一段
多行的 PEM 公鑰；使用者在 VM 裡用純文字編輯器開啟，第一段就卡住。設定與量測改成
`update-test-setup.ps1` 之後，文件裡不再有任何需要複製的指令 —— 只剩下一行固定格式的
`powershell -File`。凡是「要精確輸入」的東西都應該是腳本。

## 與自動化測試的關係

這些腳本**不在** `npm test` 內，也不該進去 —— 它們需要互動桌面、真實安裝與人工判斷。

可自動化的部分已經移出去了：`scripts/phase7-launcher-errors.ps1`
（`npm run test:release:launcher-errors`）涵蓋 launcher 的六個錯誤路徑，包含互動對話框
可見性；`scripts/phase7-e2e.ps1` 涵蓋封裝安裝／解除安裝的三條路徑。
