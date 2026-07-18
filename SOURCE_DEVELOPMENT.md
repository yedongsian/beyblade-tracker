# 來源開發指南

新增來源優先從 UI 貼入公開網址並預覽。只有需要固定解析規則時才建立 Connector Recipe；不要為單一商品建立新的 Connector 類別。

每個來源必須：

- 使用 `fixture`、`jsonld` 或 `browser` 契約，提供 `connectorVersion` 與 `recipeVersion`。
- 限制同一 registrable domain，逐次驗證 redirect，封鎖本機與內網位址。
- 設定頁數、深度、時間、下載量、並行及請求間隔；遵守 robots。
- 保存固定 HTML／JSON fixture 與契約測試，不在測試中依賴實站。
- 解析失敗時保存受控 debug 證據，但不得保存登入內容、Token 或不必要個資。
- 不加入 CAPTCHA、Cloudflare、Queue-it、登入或反偵測繞過。

商品頁先產生標準 listing，再由 pipeline 完成狀態判定、Product／Offer 身分、事件及 Watchlist。未知詞彙與低信心候選必須進人工審核，不得直接推送現貨通知。
