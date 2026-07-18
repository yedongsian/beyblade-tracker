# 發佈流程

1. 停止正式服務並執行 `npm test`、`npm run config:check`、`node bin/web-smoke.js`。
2. 設定 `RELEASE_BASE_URL` 與 `RELEASE_SIGNING_KEY_FILE`。私鑰不得提交 Git；應離線保存。
3. 安裝 Inno Setup 7，或設定 `ISCC_PATH`，執行 `npm run release:windows`。
4. 檢查 `dist/windows/release-manifest.json` 的 `publishReady=true`、安裝器 SHA-256 與簽章。
5. 在全新 Windows 測試機驗證安裝、Chrome 偵測、首次設定、背景啟動、匯出／匯入、更新、回滾及解除安裝。
6. 將安裝器與 manifest 上傳至同一 HTTPS 發佈來源，再把 manifest URL 與 Ed25519 公鑰寫入正式發佈設定。

安裝採 per-user、版本目錄並存。`current.json` 決定目前版本；更新前備份與回滾紀錄放在使用者資料目錄。未簽章 manifest、非 HTTPS URL 或 SHA-256 不符都會拒絕安裝。

公開發佈前還必須以組織持有的 Authenticode 憑證簽署 `Setup.exe`，並在乾淨的 Windows 測試機驗證簽章與 SmartScreen 體驗。Ed25519 manifest 簽章只保護更新描述與下載內容完整性，不能取代 Windows 程式碼簽章。本機未提供正式私鑰、程式碼簽章憑證或 HTTPS 發佈站時，產物僅視為可安裝的 release candidate，不得宣稱已啟用公開自動更新。
