# 更新流程驗收 — 逐步步驟

> 這是**整個專案唯一還沒驗過的核心功能**。前置條件已就緒：1.0.1 已發佈到 GitHub Releases，
> manifest 帶 Ed25519 簽章，兩個網址都確認可匿名下載。

## 這一輪要證明什麼

| # | 要證明的事 |
| --- | --- |
| 1 | 1.0.0 的安裝能發現 1.0.1 |
| 2 | **每一頁都看得到更新提示**（不是只有設定頁） |
| 3 | 使用者確認後才下載安裝 |
| 4 | 更新後版本變成 1.0.1 且**資料還在** |
| 5 | rollback 可用 |

---

## 前置：先讀這一段

**公鑰必須設定，否則一定失敗。** 程式的簽章公鑰來自 `UPDATE_PUBLIC_KEY` 環境變數，
預設是空的；沒有公鑰時 `validateUpdateManifest` 會直接丟 `BT-UPD-003`（更新無法驗證）。

> ⚠ 這本身是一個**產品問題**，不是測試步驟的麻煩：公鑰是公開資訊，本來就該內建在產品裡。
> 現在的設計等於一般使用者永遠無法驗證更新。已記入待辦，發佈前要處理。
> 本次測試先用環境變數繞過。

其餘與前幾輪相同：`Z:` 是網路磁碟機，`.ps1` 一律用
`powershell -NoProfile -ExecutionPolicy Bypass -File Z:\<script>.ps1`；
本機帳號登入要打 `.\AcceptanceUser`。

---

## 步驟 1：還原 S1，回到 1.0.0 狀態

VirtualBox → 快照 → 選 **`S1-with-chrome`** → 還原。

登入 `.\AcceptanceUser`，確認目前是 1.0.0：

```powershell
Get-Content "$env:LOCALAPPDATA\Programs\Beyblade Tracker\current.json"
```

應顯示 `{"version":"1.0.0"}`。**如果顯示 1.0.1，代表還原到錯誤的快照。**

---

## 步驟 2：設定兩個環境變數

`setx` 對多行的 PEM 會出問題，所以公鑰用 PowerShell 設定：

```powershell
[Environment]::SetEnvironmentVariable('UPDATE_MANIFEST_URL', 'https://github.com/yedongsian/beyblade-tracker/releases/download/v1.0.1/release-manifest.json', 'User')
```

```powershell
[Environment]::SetEnvironmentVariable('UPDATE_PUBLIC_KEY', (Get-Content 'Z:\manifest-public-key.pem' -Raw), 'User')
```

確認寫進去了：

```powershell
[Environment]::GetEnvironmentVariable('UPDATE_MANIFEST_URL','User')
([Environment]::GetEnvironmentVariable('UPDATE_PUBLIC_KEY','User') -split "`n").Count
```

第二行應為 **3 以上**（BEGIN／內容／END）。若為 1，表示換行遺失，請重設。

---

## 步驟 3：重啟服務讓它讀到新設定

環境變數只對**新啟動的行程**生效，所以服務一定要重開：

1. 開始功能表 →「**停止背景追蹤**」
2. 開始功能表 →「**Beyblade Tracker**」（會重新啟動服務並開管理頁）

等服務就緒（VM 上約 30～60 秒）。

---

## 步驟 4 ⭐ 檢查更新提示出現在每一頁

管理頁開啟後，**先不要去設定頁**。

排程檢查在啟動後會執行。若橫幅沒立刻出現，到設定頁按一次「檢查更新」，
然後**回到總覽頁**再看。

| 位置 | 應該看到 |
| --- | --- |
| 總覽、商品、來源管理…**任何一頁** | 「**有新版本 1.0.1 可用。**」＋「前往設定查看」連結 |

**這是本次新增的功能。** 先前只有設定頁看得到，使用者不主動去點就永遠不知道有更新。

也順便切一次英文，橫幅應變成 `Version 1.0.1 is available.` ＋ `Open Settings`。

---

## 步驟 5：確認「使用者確認後才安裝」

到設定頁，版本更新區塊應顯示：

- 可更新至 **1.0.1**
- 發行者、檔案大小、發佈時間、發佈說明
- 按鈕：**安裝更新**、**稍後更新**

**先按「稍後更新」**，確認：

- 按鈕變成「改為現在更新」
- 回到任一頁，橫幅改為「**版本 1.0.1 已延後安裝，可隨時改為現在更新。**」
  （較安靜的措辭，但入口還在）

> 這一步證明「檢查不會自動下載，只有使用者確認後才安裝」。

---

## 步驟 6 ⭐ 執行更新

**先記下目前的資料筆數**，等一下要比對：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health | Select-Object -ExpandProperty counts
```

把 `products` / `offers` / `events` / `sources` 抄下來。

然後回設定頁按「**改為現在更新**」→「**安裝更新**」，確認提示後觀察：

| 階段 | 畫面應顯示 |
| --- | --- |
| 檢查 | 正在確認更新資訊與已簽署 manifest… |
| 下載 | 正在下載與驗證：N% |
| 安裝 | 正在安裝更新… |
| 完成 | 更新已完成，正在重新啟動服務並執行健康檢查。 |

服務會自行重啟。

---

## 步驟 7：確認更新結果

等服務重新就緒後：

```powershell
Get-Content "$env:LOCALAPPDATA\Programs\Beyblade Tracker\current.json"
Invoke-RestMethod http://127.0.0.1:8787/health | Select-Object -ExpandProperty counts
```

| 檢查 | 預期 |
| --- | --- |
| `current.json` | `{"version":"1.0.1"}` |
| `/health` 的 `release.version` | `1.0.1` |
| **資料筆數** | **與步驟 6 記下的相同**（更新不得動到使用者資料） |
| 更新橫幅 | **消失**（已經是最新） |
| 設定頁 | 顯示「目前已是最新版本。」 |

順便確認 1.0.1 的改動確實生效：來源卡片切英文排版正常、錯誤訊息三語等。

---

## 步驟 8：測 rollback

設定頁如有「**回滾更新**」按鈕就按它；沒有的話用命令列：

```powershell
& "$env:LOCALAPPDATA\Programs\Beyblade Tracker\versions\1.0.1\runtime\node.exe" "$env:LOCALAPPDATA\Programs\Beyblade Tracker\versions\1.0.1\bin\rollback.js"
```

| 檢查 | 預期 |
| --- | --- |
| `current.json` | 回到 `{"version":"1.0.0"}` |
| 服務 | 能正常啟動 |
| **資料** | **仍然完整** |

> rollback 會用更新前自動建立的備份還原資料庫，所以筆數應與更新前一致。

---

## 步驟 9：回報

請告訴我：

| # | 回報 |
| --- | --- |
| 1 | 步驟 4 的橫幅**有沒有在非設定頁出現**、看到的實際文字 |
| 2 | 步驟 5 延後後橫幅是否改變措辭 |
| 3 | 步驟 6 各階段的畫面文字，特別是**有沒有出現任何 `BT-UPD-*` 代碼** |
| 4 | 步驟 7 的版本與**資料筆數前後對照** |
| 5 | 步驟 8 rollback 是否成功、資料是否完整 |
| 6 | 任何非預期的視窗或錯誤 |

---

## 如果失敗了

| 症狀 | 可能原因 |
| --- | --- |
| `BT-UPD-003` 更新無法驗證 | **公鑰沒設定或換行遺失** —— 回步驟 2 檢查行數 |
| `BT-UPD-002` 無法取得更新資訊 | VM 沒有網路，或 manifest 網址打錯 |
| `BT-UPD-004` 更新檔案不符 | SHA-256 對不上；把畫面截圖給我，這代表產物或 manifest 有問題 |
| 設定頁顯示「正式更新來源尚未設定」 | `UPDATE_MANIFEST_URL` 沒生效 —— 服務沒重啟，或變數設在錯的範圍 |

有任何代碼或看起來不對的地方就截圖，不要硬推下去。

---

## 全部完成之後

更新鏈驗完，就可以刪掉整個 VM 回收約 82 GB，以及兩個共用資料夾、`Test_Darren` 帳號、
`C:\Users\yedon\BeybladeTracker-backup-20260802`。驗收腳本已納入版控，刪掉不會遺失東西。
