# Beyblade Tracker 隱私說明

Beyblade Tracker 是單機個人版。商品、來源、觀測歷史、事件、Watchlist、設定及通知佇列預設只保存在目前 Windows 使用者的 `%LOCALAPPDATA%\BeybladeTracker`。

Telegram Bot Token、Chat ID 與 Discord Webhook 不寫入 SQLite，也不顯示於一般設定 API。安裝版使用 Windows DPAPI 的 CurrentUser 範圍加密，只有相同 Windows 使用者設定檔可以解密。移機檔刻意排除所有憑證；在新電腦上必須重新設定。

程式不會自動上傳診斷資料。使用者可選擇是否允許日後主動匯出診斷資訊；即使同意，也必須由使用者自行執行匯出及傳送。解除安裝時預設詢問是否保留使用者資料。

外部連線只用於使用者啟用的公開來源、官方更新 manifest，以及使用者設定的 Telegram／Discord 通知。外部網路總開關可暫停抓取、探索和通知。
