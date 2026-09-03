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
| `RUN-UPDATE-TEST.cmd` | **更新驗收的入口：雙擊即可**。純 ASCII 轉呼叫殼，不含任何文字 |
| `update-test-menu.ps1` | 選單本體與分派；所有在地化文字都在這裡 |
| `update-test-round.json` | **本輪的 `from` / `target` 版本**。所有更新驗收腳本都從這裡讀，不得寫死 |
| `update-test-setup.ps1` | 更新驗收前置：檢查版本與公鑰、寫入兩個環境變數並**讀回驗證** |
| `update-test-check.ps1` | 更新前／後的版本與資料筆數快照（`-Label`），附加到 `update-test-counts.txt` |
| `update-test-rollback.ps1` | 更新回滾（設定頁的回滾按鈕只在更新後健康檢查失敗時出現） |
| `update-test-diagnose.ps1` | `BT-REL-001`：指認 8787 由哪個版本目錄的行程持有，附 `tracker.log` |
| `update-test-restart.ps1` | `BT-REL-001`：手動重啟，分辨「重啟壞掉」與「安裝器沒觸發」 |
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

**不要叫操作者輸入指令。** `UPDATE-TEST.md` 原本要人從 Markdown 貼上一段多行的 PEM
公鑰 —— **主控台不接受多行輸入**，所以第一步就跑不起來。第一次修正只是改成一行
`powershell -File`，仍然要打字；真正的修法是 `RUN-UPDATE-TEST.cmd`：雙擊、按一個數字。

`phase7.test.js` 有兩項守住這件事：文件裡不得再出現 `powershell -NoProfile` 或
`SetEnvironmentVariable`，且選單提到的每一支 `.ps1` 都必須存在。

**中文不可以放進 `.cmd`，`chcp 65001` 救不了。** 第一版選單就是這樣寫的，實測結果是
`[3]`、`[4]`、`[7]` 三項整個從畫面上消失，殘片被當成指令執行
（`'步驟' is not recognized as an internal or external command`）。
原因是 cmd.exe 以**位元組位移**在批次檔中定位，多位元組 UTF-8 會讓它對錯位置。

現在 `RUN-UPDATE-TEST.cmd` 是**純 ASCII** 的一行轉呼叫，所有文字都在
`update-test-menu.ps1` 裡由 PowerShell 輸出。`.cmd` 一樣**不能有 BOM**
（cmd.exe 會把它當成 `@echo off` 前的雜訊輸出）。三件事都有測試，
其中「純 ASCII」那一項取代了原本斷言「必須有 `chcp 65001`」的測試 ——
那個斷言把錯誤的信念寫死了，反而讓問題更難被發現。

## 與自動化測試的關係

這些腳本**不在** `npm test` 內，也不該進去 —— 它們需要互動桌面、真實安裝與人工判斷。

可自動化的部分已經移出去了：`scripts/phase7-launcher-errors.ps1`
（`npm run test:release:launcher-errors`）涵蓋 launcher 的六個錯誤路徑，包含互動對話框
可見性；`scripts/phase7-e2e.ps1` 涵蓋封裝安裝／解除安裝的三條路徑。
