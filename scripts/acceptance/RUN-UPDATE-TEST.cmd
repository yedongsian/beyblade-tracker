@echo off
rem 更新流程驗收：雙擊即可執行，不需要輸入任何指令。
rem 文件原本要求把多行的 PEM 公鑰貼進主控台，而主控台不接受多行輸入。
rem 現在全部走腳本，這個選單只要按一個數字。
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File"

:menu
cls
echo ==========================================================
echo   Beyblade Tracker  更新流程驗收
echo ==========================================================
echo.
echo   請照 UPDATE-TEST.md 的順序執行。
echo.
echo   [1] 步驟 2 - 前置設定（檢查版本與公鑰、設定環境變數）
echo   [2] 步驟 6 - 記錄「更新前」的版本與資料筆數
echo   [3] 步驟 7 - 記錄「更新後」的版本與資料筆數
echo   [4] 步驟 8 - 回滾到 1.0.0
echo   [5] 步驟 8 - 記錄「回滾後」的版本與資料筆數
echo.
echo   [6] 診斷：更新後版本對不上（current.json 與 /health 不同）
echo.
echo   [9] 開啟 UPDATE-TEST.md
echo   [0] 離開
echo.
set "choice="
set /p "choice=輸入數字後按 Enter： "

if "%choice%"=="1" ( %PS% "%HERE%update-test-setup.ps1" & goto done )
if "%choice%"=="2" ( %PS% "%HERE%update-test-check.ps1" -Label 更新前 & goto done )
if "%choice%"=="3" ( %PS% "%HERE%update-test-check.ps1" -Label 更新後 & goto done )
if "%choice%"=="4" ( %PS% "%HERE%update-test-rollback.ps1" & goto done )
if "%choice%"=="5" ( %PS% "%HERE%update-test-check.ps1" -Label 回滾後 & goto done )
if "%choice%"=="6" ( %PS% "%HERE%update-test-diagnose.ps1" & goto done )
if "%choice%"=="9" ( start "" notepad "%HERE%UPDATE-TEST.md" & goto menu )
if "%choice%"=="0" ( exit /b 0 )
echo.
echo 不是有效的選項。
timeout /t 2 >nul
goto menu

:done
echo.
echo ----------------------------------------------------------
echo 執行完畢。結果同時寫進本資料夾的 .txt 檔，可以直接給我。
echo ----------------------------------------------------------
pause
goto menu
