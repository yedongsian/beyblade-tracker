# Windows 安裝與移機

## 一般安裝

0. 到 **[最新版下載頁](https://github.com/yedongsian/beyblade-tracker/releases/latest)** 下載
   `BeybladeTracker-<版本>-Setup.exe`。
1. 執行下載的安裝檔。**會出現「Windows 已保護您的電腦」** —— 安裝檔尚未購買程式碼簽章憑證，
   請點「更多資訊」→「仍要執行」。要自行核對的話，發布頁的 `release-manifest.json` 內含 SHA-256。
2. 安裝器會安裝內含的 Node.js 執行環境，不需要另外安裝 Node.js 或開發工具。
3. 建議保留「登入 Windows 後自動啟動」。安裝完成後可從開始功能表開啟管理頁。
4. 需要瀏覽器的來源使用系統已安裝的 Google Chrome。找不到 Chrome 時安裝器會提示官方下載頁；一般 HTTP 來源仍可使用。

程式版本安裝在 `%LOCALAPPDATA%\Programs\Beyblade Tracker\versions`；使用者資料放在 `%LOCALAPPDATA%\BeybladeTracker`。更新不會覆寫使用者資料。

## 移機

在舊電腦的「設定與移機」按「匯出移機檔」。新電腦安裝後按「匯入移機檔」選取檔案，Tracker 驗證 SHA-256 與 SQLite 完整性後重新啟動。移機檔不含 Token、Webhook、PID、日誌或 debug HTML，通知憑證需重新設定。

## 解除安裝

由 Windows「已安裝的應用程式」解除安裝。解除安裝器會詢問是否保留商品、歷史、設定與備份；預設建議保留。選擇刪除資料不可復原，請先匯出移機檔。
