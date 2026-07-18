# 故障排除

- 管理頁無法開啟：從開始功能表執行「服務狀態」，再查看 `%LOCALAPPDATA%\BeybladeTracker\logs\tracker.log`。
- 瀏覽器來源失敗：確認 Google Chrome 已安裝；Tracker 不使用登入狀態，也不處理 CAPTCHA。
- Telegram 測試失敗：確認已在 Bot 私人聊天按 Start、Token／Chat ID 正確，且外部網路總開關已開啟。
- 匯入失敗：確認檔案副檔名為 `.beyblade-transfer` 且未被修改；系統會驗證檔案雜湊與 SQLite 完整性。
- 更新失敗：更新必須通過 HTTPS、Ed25519 簽章及 SHA-256 驗證。更新前資料庫備份位於 `backups`。
- 需要回滾：先停止 Tracker，再從安裝目錄執行 `launcher.ps1 -Action rollback`。回滾會切回舊版程式並還原更新前 DB。
- OneDrive：不要讓兩台電腦同時執行同一份 SQLite。請使用移機匯出／匯入，不要同步正在使用的 DB。
