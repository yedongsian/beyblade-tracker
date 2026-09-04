# 更新鏈驗收原始輸出（2026-08-29 ～ 2026-09-04）

在 clean VM（`Beyblade-Acceptance`，帳號 `AcceptanceUser`）上執行的原始輸出。
VM 與共用資料夾已於驗收完成後刪除，這裡是**唯一保留的原始證據**；
結論與分析在 `docs/TICKETS.md`。

## `round-1.0.4-to-1.0.5/` — 最終、也是唯一有效的一輪

**1.0.4 → 1.0.5，全程未設任何環境變數。**

| 量測點 | `current.json` | `/health` | 更新來源 |
| --- | --- | --- | --- |
| 更新前 | 1.0.4 | 1.0.4 | 產物內建 `/releases/latest/download/` |
| 更新後 | 1.0.5 | 1.0.5 | 產物內建 `/releases/latest/download/` |

資料筆數 13 項完全相同。

先前每一輪都靠手動設 `UPDATE_MANIFEST_URL` 與 `UPDATE_PUBLIC_KEY` 才通過，
那些結論對真實使用者從不成立（`BT-UPD-002`）。只有這一輪是產品自身的行為。

## `earlier-rounds/` — 前幾輪，包含失敗的那些

保留失敗的輸出是刻意的，它們記錄了三個只有在真機上才會現形的缺陷：

- `update-test-diagnose.txt` / `update-test-restart.txt` / `update-test-launcher.txt`
  —— `BT-REL-001`：更新後服務從未重啟。診斷顯示 8787 仍由更新前啟動的舊版行程持有，
  而 log 中沒有任何停止或啟動紀錄。這三份是根因定位的完整過程。
- `update-test-counts-1.0.4.txt` —— `current.json` 與 `/health` 版本不一致的原始紀錄。
- `update-test-shipped-config-round1.txt` —— `BT-UPD-002` 第一次驗證的**誤判**：
  畫面一切正常，但 `/health` 的更新來源仍是上一輪環境變數的殘值。

其中兩份輸出本身帶有已知瑕疵：早期的 `update-test-diagnose.txt` 因為一個未收尾的
正規表示式而靜默漏掉了兩項欄位（版本目錄欄為空）。結論仍成立，因為完整命令列就印在旁邊。
