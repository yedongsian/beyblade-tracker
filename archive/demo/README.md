# 歷史 Demo 資料歸檔

`manual-demo.db` 是第一版開發期間的離線 Fixture／通知流程展示資料，不是正式追蹤資料。
Phase 0 於 2026-07-16 將它從 `data/` 移至此處，避免備份、移機或正式服務誤認為使用者資料。

歸檔前檢查結果：SQLite 完整性 `ok`；2 個商品、3 個 Offer、9 筆觀測、6 個事件。
正式服務只使用 `data/tracker.db`，不會自動開啟這個歸檔。

`tracker-before-demo-cleanup-*.db` 是從正式 DB 清除 `demo-fixture` 與 `example-jsonld` 前的
完整一致性快照。正式 DB 中被移除的 Demo 專屬資料為 2 個商品、3 個 Offer、24 筆觀測、
2 個事件、6 筆通知及 8 次 crawl run；三個真實商店的 UX-20 資料均保留。
