# Error Code Catalog

> 狀態：Active／next-release contract
> 重要：代碼、繁中訊息與 recovery 由中央 registry 管理；發布前仍需完成 Windows 實機驗收。
> 最後更新：2026-07-29

## 1. 格式

使用者錯誤代碼格式為 `BT-<AREA>-<NNN>`：

| Area | 類別 |
|---|---|
| `INS` | 安裝與解除安裝 |
| `LCH` | Launcher、服務啟動與本機管理頁 |
| `UPD` | 更新、簽章與 rollback |
| `DAT` | Database、backup、restore、transfer |
| `NET` | Network control 與連線 |
| `BRS` | Chrome／Browser Connector |
| `SRC` | 商店來源與 parser |
| `NTF` | Telegram／Discord notification |

代碼一旦進入公開版本不得改變原意；需要新原因時新增代碼，不重複使用舊代碼。

## 2. 使用者應看到的資訊

每個錯誤對話框至少顯示：

- 固定錯誤代碼。
- 一句繁中說明。
- 一至三個安全的處理步驟。
- 「複製錯誤資訊」與「問題回報」。
- App version、UTC timestamp 及不含敏感資料的 support reference。

UI 不顯示 stack trace、Token、完整 URL、DB row、private path 或 signing key。

## 2.1 實作與測試範圍

- `src/errors/registry.js` 是 Local Web 的中央 registry；每個本目錄代碼都有 deterministic registry trigger 與 automated test。
- Hidden Windows Launcher 對目前版本遺失、runtime 遺失、service failure、health timeout 與開啟本機頁失敗分別顯示 `BT-LCH-001` 至 `BT-LCH-005` 的 native dialog。
- Launcher 的 `-NonInteractive` 模式（installer、uninstaller、登入自動啟動、測試）不顯示任何 dialog，只把上述 safe code 或 `BT-LCH-006` 寫到 stderr 並以非零 exit code 結束。
- Local Web API 使用安全 error envelope；未知 exception 一律映射為 `BT-LCH-999`，不把 exception message 當公開契約。
- 「複製錯誤資訊」與 Issue Form 預填只包含 code、App version、UTC timestamp 與 safe support reference；使用者可在送出前編輯或取消。

## 3. 安裝與啟動

| Code | 意義 | 使用者處理 |
|---|---|---|
| `BT-INS-001` | 安裝器無法寫入使用者安裝目錄。 | 關閉舊安裝器，確認磁碟空間與防毒攔截，再重試；不要以系統管理員強行覆蓋未知目錄。 |
| `BT-INS-002` | 安裝後的版本指標或 payload 不完整。 | 重新下載正式安裝器並重新安裝；資料預設保留。 |
| `BT-INS-003` | Installer signature 無法驗證。 | 不要繼續安裝；確認檔案來自正式 GitHub Release，並回報 Developer。 |
| `BT-LCH-001` | 找不到 `current.json` 或目前版本。 | 重新安裝相同或更新版本；不要手動建立版本檔。 |
| `BT-LCH-002` | 找不到 bundled Node runtime。 | 重新安裝；檢查防毒軟體是否隔離檔案。 |
| `BT-LCH-003` | 背景服務啟動失敗。 | 選「查看服務狀態」，記錄 support reference；若重試仍失敗再回報。 |
| `BT-LCH-004` | 等待服務健康狀態逾時。 | 等候一分鐘後重試；確認 8787 port 未被其他程式占用。 |
| `BT-LCH-005` | 服務已啟動，但無法開啟本機管理頁。 | 手動開啟 `http://127.0.0.1:8787`；若仍失敗，匯出診斷並回報。 |
| `BT-LCH-006` | 該操作需要視窗介面，但 launcher 以 non-interactive 模式執行（安裝、移除、登入自動啟動或測試）。 | 從開始選單手動執行該功能；此代碼只會出現在自動化 log／stderr，不會顯示視窗。 |
| `BT-LCH-999` | 未知 internal error。 | 不顯示 exception message；稍後再試，複製低敏感度錯誤資訊後回報。 |

## 4. 更新與 rollback

`BT-UPD-001` 至 `BT-UPD-007` 已由 BT-UPD-001 的 update flow 映射。顯示內容只包含代碼與安全 recovery；不包含 manifest URL、檔案 path、stack、憑證或備份位置。Windows clean VM 安裝／rollback 仍是 release gate 驗收。

| Code | 意義 | 使用者處理 |
|---|---|---|
| `BT-UPD-001` | 正式更新來源尚未設定。 | 目前無法線上更新；到正式 GitHub Releases 手動下載，或等待 Developer 完成 release channel。 |
| `BT-UPD-002` | 無法取得 update manifest。 | 確認網路與 network switch，稍後再試；不要從不明網站下載。 |
| `BT-UPD-003` | Manifest 或 publisher signature 無效。 | 停止更新，不要忽略警告；保留目前版本並回報 Developer。 |
| `BT-UPD-004` | Installer SHA-256 不符。 | 刪除本次下載並停止更新；回報 Developer。 |
| `BT-UPD-005` | 已驗證 installer 無法啟動或安裝失敗。 | 保留錯誤代碼，重新啟動 Windows 後再試一次；仍失敗則回報。 |
| `BT-UPD-006` | 更新後 health check 失敗，系統建議 rollback。 | 選擇 rollback；不要刪除更新前 backup。 |
| `BT-UPD-007` | Rollback 失敗。 | 停止 Tracker，不要修改資料庫；立即回報並附 diagnostics。 |

## 5. 資料與移機

| Code | 意義 | 使用者處理 |
|---|---|---|
| `BT-DAT-001` | SQLite integrity check 失敗。 | 停止服務，不要繼續寫入；保留 DB 與 backups，聯絡 Developer。 |
| `BT-DAT-002` | Database schema 比目前程式新。 | 安裝相同或更高版本；不要手動降級 DB。 |
| `BT-DAT-003` | Backup／restore 驗證失敗。 | 不要覆蓋現有 DB；改用另一份已驗證 backup。 |
| `BT-DAT-004` | Transfer bundle hash 或內容驗證失敗。 | 重新匯出移機檔；不要修改或解壓後重包。 |
| `BT-DAT-005` | Restore／import 時服務仍在執行。 | 先由開始功能表停止背景追蹤，再重試。 |

## 6. 網路、來源與通知

| Code | 意義 | 使用者處理 |
|---|---|---|
| `BT-NET-001` | 外部網路已由 UI 暫停。 | 確認原因後才在來源管理恢復。 |
| `BT-NET-002` | `NETWORK_ENABLED=0` hard lock。 | 只有維護者應修改 `.env`；一般使用者請聯絡 Developer。 |
| `BT-BRS-001` | 找不到支援的 Google Chrome。 | 安裝官方 Chrome；HTTP 型來源仍可使用。 |
| `BT-BRS-002` | Browser page 被 CAPTCHA、Queue-it 或登入限制。 | 停止重試並等待，不要繞過限制。 |
| `BT-SRC-001` | 單一來源連續失敗。 | 到來源管理執行一次測試；其他來源仍會繼續。 |
| `BT-SRC-002` | 來源頁可讀，但 parser 無法辨識商品。 | 停用來源並回報頁面類型；不要自行提高掃描頻率。 |
| `BT-SRC-003` | 這個來源剛剛才手動檢查過，仍在冷卻視窗內。 | 稍候片刻再試；排程仍會依原本週期自動檢查。這是預期行為，不是故障。 |
| `BT-NTF-001` | Telegram 設定或測試失敗。 | 確認已對 Bot 按 Start、Token／Chat ID 與 network switch。 |
| `BT-NTF-002` | Discord Webhook 被拒絕或已失效。 | 重新建立 Webhook；不要把完整 URL 貼到公開 Issue。 |

## 7. 已修正的歷史問題

`BT-P1-003` 是工程 Ticket，不是使用者錯誤代碼。它修正 Windows PowerShell 5.1 將無 BOM UTF-8 Launcher 當成 ANSI 解碼而造成繁中亂碼的問題。修正後 `launcher.ps1` 必須保持 UTF-8 with BOM，並有 byte-level regression test。

## 8. 問題回報內容

回報 Issue 時提供：錯誤代碼、App version、Windows version、發生時間、操作步驟、是否可重現、預期／實際結果。可以附由程式產生的低敏感度 diagnostics；不要附 `.env`、Token、Webhook、DB、transfer bundle、完整 log 或 private source URL。

問題仍未解決時，使用 [GitHub Issues 繁中表單](https://github.com/yedongsian/beyblade-tracker/issues/new/choose) 回報。
