# Beyblade Tracker 使用教學

> 對象：不具開發經驗的一般 Windows 使用者
> 適用基線：1.0.7
> 最後更新：2026-09-04
>
> **下載**：[最新版下載頁](https://github.com/yedongsian/beyblade-tracker/releases/latest)。
> 安裝時會出現「Windows 已保護您的電腦」（尚未購買簽章憑證），點「更多資訊」→「仍要執行」。

## 1. 這個程式可以做什麼

Beyblade Tracker 會定期檢查你核准的公開商店頁面，整理同一 Beyblade 商品在不同商店的價格與庫存狀態，並在新品、預購、現貨、補貨、缺貨或價格明顯變動時通知你。

主要特點：

- 將不同商店的相同商品合併顯示。
- 保存價格與庫存時間線，區分最新、過期與封存資料。
- 支援繁體中文、日本語與 English。
- 可建立 Watchlist，追蹤商品號、型號、條碼、關鍵字或零件。
- 官方公告、商店庫存及社群線索分開顯示，避免把傳聞當成現貨。
- 可使用 Console、Telegram 或 Discord 通知。
- 可備份、還原及匯出移機檔；通知密碼不會放入移機檔。
- 可暫停所有外部網路活動，但保留既有資料。

本程式不會自動購買、不會登入商店，也不會繞過 CAPTCHA、Queue-it、付費牆或網站限制。

## 2. 安裝

正式公開版本的預期操作：

1. 從專案的 [GitHub Releases](https://github.com/yedongsian/beyblade-tracker/releases) 頁面下載 `BeybladeTracker-<版本>-Setup.exe`。
2. 對安裝檔點兩下。
3. 依安裝畫面選擇安裝位置及是否在登入 Windows 後自動啟動。
4. 安裝完成後勾選「啟動 Beyblade Tracker」。
5. 程式會開啟本機管理頁，不需要輸入 PowerShell 指令，也不需要另外安裝 Node.js。

需要瀏覽器的來源會使用電腦上已安裝的 Google Chrome；找不到 Chrome 時，HTTP 型來源仍可使用。

> 目前 repository 已有可雙擊的 installer candidate，但公開下載、Authenticode 簽章與 SmartScreen 驗收尚未完成。請勿把未經正式發布的測試安裝器轉傳給一般使用者。

## 3. 第一次啟動

第一次開啟時，依畫面完成：

1. 選擇語言。
2. 選擇通知方式；沒有 Telegram／Discord 也能正常使用。
3. 選擇掃描頻率及資料保存偏好。
4. 閱讀並接受 Privacy 與 Source Policy。
5. 前往「來源管理」確認要追蹤的商店。

管理頁預設是 <http://127.0.0.1:8787>，只供這台電腦使用。

## 4. 主要頁面

| 頁面 | 功能 |
|---|---|
| 總覽 | 查看來源、商品、刊登、可購買數量與健康狀態。 |
| 商品 | 查看合併後的商品、商店 Offer、價格與庫存時間線。 |
| 商店刊登 | 依最新、過期或封存狀態查看各來源刊登。 |
| 事件 | 查看新品、預購、現貨、補貨、缺貨及價格變動。 |
| Catalog | 查看商品號、多語別名、零件及來源證據。 |
| Watchlist | 建立想追蹤的商品、零件或關鍵字規則。 |
| 社群情報 | 查看未驗證線索；這些內容不代表確定有庫存。 |
| 候選審核 | 核准、延後或排除探索到的新商品。 |
| 排除紀錄 | 查看二手、拆售或非目標商品為何被排除。 |
| 來源管理 | 新增、測試、停用來源，或暫停全部外部網路。 |
| 設定 | 語言、通知、移機、診斷及版本更新。 |

## 5. 新增商店來源

1. 到「來源管理」貼入公開商品頁或分類頁網址。
2. 先閱讀預覽結果、網域、候選商品及掃描預算。
3. 確認後才加入；同一商店不會重複建立。
4. 若是分類頁，候選會先進入「候選審核」，不會直接變成庫存通知。
5. 遇到登入、CAPTCHA 或 Queue-it 時停止並等待，不要嘗試繞過。

停用來源只會停止後續掃描，不會刪除既有商品與歷史。

## 6. Watchlist 與通知

Watchlist 可使用商品、零件、商品號、型號、條碼、關鍵字、排除詞或進階 Regex。一般使用者建議優先使用商品或商品號精確匹配。

可選通知類型包含新品公告、預購、發售、現貨／補貨及價格異常。Telegram 設定後請先按「測試通知」；Token／Chat ID 不會寫入資料庫或診斷檔。

## 7. 版本更新

下一版規劃採用「使用者確認後更新」：

1. 程式啟動後及每 24 小時最多檢查一次 stable channel。
2. 有新版時顯示目前版本、新版本、更新說明與檔案大小。
3. 使用者可選「稍後提醒」或「下載並安裝」。
4. 只有按下「下載並安裝」後才會下載及執行安裝器；不做無提示強制更新。
5. 更新前自動建立資料庫備份，並驗證 HTTPS、SHA-256、Ed25519 manifest signature 與 Windows publisher signature。
6. 更新失敗時顯示錯誤代碼並提供 rollback 指引。

現有 1.0.0 已有更新驗證及 rollback 基礎，但正式 release channel 與上述完整 UX 尚未通過公開發布驗收。

## 8. 遇到錯誤時

程式會以對話框顯示固定錯誤代碼、簡短說明及建議動作。請先：

1. 記下或複製錯誤代碼，例如 `BT-LCH-003`。
2. 記下程式版本與 Windows 版本。
3. 依 [錯誤代碼目錄](ERROR_CODES.md) 執行安全的自助處理。
4. 問題仍存在時，由「設定 → 匯出診斷」產生低敏感度診斷檔。
5. 到公開 GitHub repository 的「Issues → 問題回報」填寫表單。

不要公開上傳 `.env`、Token、Webhook、signing key、完整資料庫、移機檔或原始 `tracker.log`。

固定錯誤代碼已實作（`BT-UX-002`）：中央錯誤代碼 registry、管理頁的安全錯誤對話框，以及背景啟動器的 Windows 原生錯誤對話框（`BT-LCH-001`～`BT-LCH-006`）。未知的內部錯誤一律使用保留代碼 `BT-LCH-999`，不會顯示原始例外訊息、路徑或密鑰。

此功能尚未隨公開 release 發布：已下載的 1.0.0 安裝檔仍可能出現沒有代碼的純文字錯誤，此時請先參閱根目錄 `TROUBLESHOOTING.md`。發布狀態以 [Tickets](TICKETS.md) 的 `BT-UX-002` 為準。

## 9. 備份與移機

- 程式預設每 24 小時建立一致性備份，保留 30 天且最多 30 份。
- 換電腦時使用「設定 → 匯出移機檔」，在新電腦安裝後再匯入。
- 移機檔會驗證 hash 與 SQLite 完整性，但不包含通知憑證；新電腦需重新設定 Telegram／Discord。
- 不要用 OneDrive 讓兩台電腦同時開啟同一份 SQLite。

## 10. 聯絡與問題回報

正式問題回報入口為 [GitHub Issues 繁中表單](https://github.com/yedongsian/beyblade-tracker/issues/new/choose)：

1. 使用者登入免費 GitHub 帳號。
2. 開啟 [Beyblade Tracker Issues](https://github.com/yedongsian/beyblade-tracker/issues)。
3. 選擇繁中「問題回報」。
4. 填入錯誤代碼、版本、Windows、操作步驟、預期與實際結果。
5. Developer 會在同一 Issue 回覆；使用者可在 GitHub 或 Email 收到後續通知。

詳細維護者設定與回覆規則請參閱 [Support Spec](SUPPORT.md)。
