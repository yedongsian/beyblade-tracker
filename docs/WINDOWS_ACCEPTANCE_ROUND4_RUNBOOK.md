# 實機驗收 — 操作步驟

> **第四輪已執行完畢（2026-08-11，Test_Darren）**，A 段 10 PASS / 0 FAIL / 1 未測。
> 結果與過程紀錄見 [WINDOWS_ACCEPTANCE_CHECKLIST.md](WINDOWS_ACCEPTANCE_CHECKLIST.md) 第 2.2 節。
>
> **下一輪（第五版產物，乾淨 VM）要做三件事**，見文末「下一輪的三個增補項」：
> A-4b（無 Chrome 分支）、A-6b 的問題回報按鈕、A-9 的失敗來源錯誤呈現。
> 步驟 3～9 照抄即可，另加文末三項。

## 產物

| | |
| --- | --- |
| 檔案 | `BeybladeTracker-1.0.0-Setup.exe` |
| SHA-256 | `a5b67183ba1d981e697ed0ea4876787e7d597a693c50df43df7ac68a9da18f3c` |
| 大小 | 27,505,644 bytes（2026-08-11 第五次建置） |
| 來源 | `main` @ `1395f0c`，含 D-3～D-7 修正、`BT-UX-002` 回報預填修正、`BT-UX-003` 錯誤訊息三語化 |
| 驗證 | 單元測試 239/239；release E2E 四項全綠（normal／stopfail／missing-launcher／launcher-errors 6-6） |

驗收腳本已納入版控（`scripts/acceptance/`），共用資料夾裡的是同一份副本。
全程在測試帳號執行，第四輪實際耗時約 60 分鐘（含兩次重做）。

---

## ⚠ 執行過程踩到的陷阱（後續輪次務必先讀）

**「按 Enter 表示完成」不是可靠的信號。** `r2-install.ps1`、`a10-uninstall-keep.ps1`、
`a11-uninstall-delete.ps1` 原本都用 `Read-Host '完成後按 Enter'` 當作動作已發生的依據，
之後立刻量測。若在動作真正完成前按下 Enter，輸出會與「安裝失敗」「解除安裝失敗」
**完全一樣**，本輪因此誤判兩次、各重做一輪。

三支腳本已改為**等待實際狀態改變**（安裝目錄出現／消失，最多 5 分鐘），逾時會明確
標示「動作未執行或未完成，下方檢查不具參考價值」。即便如此，仍請務必等動作真正結束再按。

**不要在腳本等待提示時關掉視窗。** 第一次的 A-11 在 `Read-Host` 處被關閉，結果檔就停在
提示那一行、完全沒有「刪除後」段落 —— 解除安裝實際上成功了，但該項等於沒有證據。

---

## 開始前必讀

**步驟 2 會永久刪除 Test_Darren 的追蹤資料，包含 Telegram 憑證。**

這是必要的 —— A-9 要驗的是「全新安裝的預設行為」，只要
`%LOCALAPPDATA%\BeybladeTracker\config\sources.json` 還在，設定解析就會命中它，
永遠測不到 `sources.example.json` 這條路徑。

| 項目 | 刪除前確認 |
| --- | --- |
| A-8（Telegram／DPAPI） | 已 PASS，不需重做，憑證可以放心刪 |
| 商品／事件／觀測資料 | 共用資料夾有 `beyblade-transfer-20260805-104427.beyblade-transfer`（含 `tracker.db` 與 `sources.json`，不含憑證） |
| A-7 匯入側 | 已 PASS，不需重做 |

---

## 步驟 0：工作帳號先讓路

在 **yedon** 帳號確認沒有服務占用 8787：

```bash
Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue
```

須無輸出。快速使用者切換**不會**結束原帳號的程序；若有輸出，先在 yedon 點「停止背景追蹤」。

然後登入 Test_Darren。以下全部在 Test_Darren 執行。

---

## 步驟 1：驗證安裝器雜湊

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\verify-installer.ps1
```

**必須看到 `MATCH`。** MISMATCH 就停下來，不要安裝。

---

## 步驟 2：移除舊版，連同資料一起刪

由「設定 → 應用程式 → 已安裝的應用程式 → Beyblade Tracker → 解除安裝」，
**資料保留提示選「否」（刪除資料）**。完成後確認：

```bash
Test-Path "$env:LOCALAPPDATA\Programs\Beyblade Tracker"; Test-Path "$env:LOCALAPPDATA\BeybladeTracker"
```

兩個都要是 `False`。

> 這一步只是清場，**不列入 A-11** —— A-11 要在受驗產物上做，排在步驟 9。

---

## 步驟 3：安裝（A-1 ＋ D-3 ＋ 首次啟動耗時）

分兩段：先安裝，再檢查。

### 3a 帶 log 安裝

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\install-with-log.ps1
```

這支用 `/LOG` 啟動安裝器、**等它真的結束**、把離開代碼翻成中文（0=成功、2=使用者取消、
4=安裝過程嚴重錯誤…），完整 log 寫進 `install-testdarren.log`。**務必用這支**，不要手動
雙擊安裝器 —— 手動安裝失敗時沒有任何可判讀的依據。

安裝精靈出現後**全程使用預設值**，保留「登入 Windows 後自動啟動」（步驟 8 要用）。
若跳出「Windows 已保護您的電腦」，點「更多資訊 → 仍要執行」（安裝器未簽章，B 段已知阻塞項）。

**離開代碼必須是 0。**

### 3b 安裝後檢查

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\r2-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\r2-startup-timing.ps1
```

| 檢查 | 預期 |
| --- | --- |
| `current.json` | `{"version":"1.0.0"}` |
| 個人 sources.json 已排除 | **True** |
| `sources.example.json` | **True** |
| fixtures 已打包 | **True** |
| `/health` | `ok` 或 `degraded`，version `1.0.0` |
| 來源清單 | 只有 `demo-fixture`（enabled）與 `example-jsonld`（disabled） |

`r2-startup-timing.ps1` 會從 `tracker.log` 算出**安裝完成到服務就緒的精確耗時**。
歷史值：18／18.6／26.9／34.7／37.5／55.5 秒。

**同時注意畫面上有沒有跳出任何錯誤對話框。** 不該有。若跳出 `BT-LCH-*`，請截圖並停下來。

---

## 步驟 4：A-5 首次啟動導覽

開啟管理頁（開始功能表的「Beyblade Tracker」捷徑），應跳出強制回應的導覽對話框，
欄位依序為語言 → 通知方式 → Telegram 區塊 → 掃描頻率 → 資料保存天數。

**驗證重點是「儲存後不再出現」**：

1. 填完按儲存
2. 關掉分頁，重新開啟管理頁
3. **導覽不應再出現** ← 這才算 PASS

只確認「有跳出來」不夠 —— 那不能證明 `onboardingCompleted` 有寫進去。

---

## 步驟 5：A-9 依新標準驗收

D-3 修好後全新安裝不再內建三個真實商店，驗法因此變成三小項。

### (a) 全新安裝只有離線 demo-fixture

管理頁 → 來源。應只有 `demo-fixture`（啟用）與 `example-jsonld`（停用）。
**不應**出現 yodobashi／shimamura／hlj。

### (b) fixture 可正常運作

首次掃描會自動跑過。檢查「商品」與「事件」頁有無 fixture 產生的資料；
若沒有，用來源頁的「立即重新檢查」觸發一次。

### (c) 使用者自行新增來源後可抓取

走「貼上網址 → 安全連線 → 預覽 → 確認加入」流程加一個真實商品頁。
建議用純 JSON-LD 的 HLJ，通用流程就能解析：

```
https://www.hlj.com/product/TKT09613
```

備選 Yodobashi：`https://www.yodobashi.com/product/100000001009941569/`

**不要用 shimamura** —— 商品頁已下架（D-2），必定逾時 45 秒。

失敗時請記下來源管理頁顯示的**繁中錯誤訊息**是否可操作。這是 A-9 預期結果的一部分，
至今仍未被檢視過（歷輪不是全成功、就是失敗在別的地方）。

---

## 步驟 6：A-2 五個開始功能表捷徑

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\a2-shortcuts.ps1
```

> 這支最後會停止背景服務。步驟 7 不需要服務在跑；步驟 8 的登入會重新啟動它。
>
> 已知現象：腳本在 port 關閉後立即取樣，可能列出仍在收尾的 node 行程（WAL 併回主檔）。
> 對照 `tracker.log` 的 `service shutting down` 時間戳即可分辨是收尾還是洩漏。

---

## 步驟 7：A-6b 剪貼簿內容檢查

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\a6-dialog.ps1
```

腳本把安裝目錄的兩支 launcher 複製到暫存區、刻意不建 `current.json`，再以
`wscript.exe launcher.vbs`（真實捷徑路徑）觸發 `BT-LCH-001`。**不會動到真實安裝。**

依提示回答四題，然後**點「複製錯誤資訊」**，再按 Enter 讓腳本讀剪貼簿。

| 必須有 | 絕不能有 |
| --- | --- |
| `BT-LCH-001` | 安裝路徑、使用者目錄、使用者名稱 |
| App version | `.ps1` / `.vbs` |
| UTC 時間 | stack trace 字樣 |
| Support reference | URL、token、webhook |

> 對話框**能不能彈出來**已由 `npm run test:release:launcher-errors` 案例 F 自動涵蓋；
> 這裡只需人工做剪貼簿那一段 —— 那是 `launcher.ps1` 的 `$copyText`，另一條路徑。
>
> 已知現象：`BT-LCH-001` 情境讀不到 `current.json`，App version 顯示 `unknown`，屬設計行為。

---

## 步驟 8：A-3 登入自動啟動

1. 確認機碼：

```bash
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name BeybladeTracker
```

應為 `"...\wscript.exe" "...\launcher.vbs" start noninteractive`（**必須含 `noninteractive`**）。

2. **登出**（不是重開機、不是切換使用者），再重新登入。

3. **登入作業系統的當下**請親眼確認：沒有主控台、沒有對話框、工作列無異常、沒有 Chrome 視窗。

4. 登入後不要點任何捷徑，直接執行：

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\a3-logon.ps1
```

> `a3-result.txt` 第 4 節可能把**你自己用來跑腳本的終端機**列為「具主視窗的行程」。
> 比對它的啟動時間與登入時間即可分辨。

---

## 步驟 9：A-10 → 重裝 → A-11

### A-10 解除安裝（保留資料）

先確認服務已完成首次掃描、資料庫已建立，否則沒有基準線可比對：

```bash
Invoke-RestMethod http://127.0.0.1:8787/health | Select-Object -ExpandProperty counts
```

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\a10-uninstall-keep.ps1
```

**資料提示選「是」。** 預期：程式檔案／捷徑／`Run` 機碼／登錄項目移除，
`%LOCALAPPDATA%\BeybladeTracker` 完整保留，`integrity_check=ok` 且筆數前後相同。

### 重新安裝

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\install-with-log.ps1
```

### A-11 解除安裝（刪除資料）⚠ 破壞性

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\a11-uninstall-delete.ps1
```

**資料提示選「否」，而且跑完之前不要關視窗。**

預期：`%LOCALAPPDATA%\BeybladeTracker` **整個目錄消失**，8787 停止監聽。

---

## 步驟 10：回報

| # | 要回報的 |
| --- | --- |
| 1 | 步驟 3 的**首次啟動耗時**，以及**有沒有跳出對話框** |
| 2 | 步驟 3 的 D-3 三項檢查是否都 True |
| 3 | 步驟 4 導覽儲存後**是否不再跳出** |
| 4 | 步驟 5 的 (a)(b)(c) 結果；(c) 用了哪個網址 |
| 5 | 步驟 8 的**登入→就緒耗時**，以及登入當下有無任何視窗 |
| 6 | 各腳本的 `*-result.txt`（都在共用資料夾） |
| 7 | 過程中任何非預期的視窗、對話框或 `BT-*` 代碼 |

---

## 下一輪的三個增補項（第五版產物，乾淨 VM）

上面的步驟照跑，另外加這三項。三項都只在產物上驗得到。

### 增補 1：A-4b 無 Chrome 分支 ⭐ 必須排在最前面

**這一項只有在還沒安裝 Chrome 的狀態下測得到。** 一旦裝了 Chrome，要回到那個狀態就得還原快照。

1. 建立乾淨 Windows VM，**先不要裝 Chrome** → 拍快照 **S0**
2. 執行安裝器，在「準備安裝」頁確認**出現找不到 Chrome 的提示**
3. 選「是」→ 應開啟 `https://www.google.com/chrome/`
4. 還原 S0，重跑一次選「否」→ 應仍可完成安裝
5. 安裝後確認 **HTTP-only 來源仍可掃描**（`demo-fixture` 是離線的，一定會過；再加一個 JSON-LD 來源，例如 HLJ，確認不需要 Chrome 也能抓）
6. 還原 **S0** → 安裝 Chrome → 拍快照 **S1**，之後所有測試以 S1 為基準

### 增補 2：A-6b「問題回報」按鈕

`launcher.ps1` 的回報 URL 已修正（原本不會預填錯誤代碼與 App 版本）。修正本身已於線上表單實測，
但**按鈕點下去實際開啟的 URL 尚未在產物上驗過**。

跑 `a6-dialog.ps1` 時，除了原本四題與剪貼簿檢查，**多點一次「問題回報」按鈕**，確認：

- 瀏覽器開啟的是 `.../issues/new?template=bug_report.yml&...`（**不是** `/issues/new/choose`）
- 表單的「錯誤代碼」欄已填入 `BT-LCH-001`
- 「App 版本」欄已填入版本（此情境為 `unknown`，屬設計行為）
- **不要送出**，看完關掉即可

### 增補 3：A-9 失敗來源的錯誤呈現

A-9 的「失敗時顯示可操作的繁中錯誤」至今從未被檢視 —— 歷輪不是全成功就是失敗在別的地方。
訊息已改為三語可操作版本（`BT-UX-003`），需要一個**必定失敗**的來源來驗。

用這個已下架的商品頁（D-2 的那一個，必定 404 或逾時）：

```
https://www.shop-shimamura.com/item/0363100014177/
```

加入後等一次掃描，然後到來源管理頁確認：

- 顯示的是**可操作的繁中建議**（例如「這個商品頁已不存在，可能已下架。請確認網址，或停用此來源。」）
- **不是**英文原文（`HTTP 404`、`page.waitForSelector: Timeout ...`）
- 展開「技術細節」後**看得到**原始訊息 —— 原文保留是刻意的，回報時需要
- 把 UI 切成日文或英文，確認訊息跟著換語言

---

## 收尾清理（全部做完之後）

刪除測試帳號、共用資料夾 `C:\Users\Public\BeybladeTracker-Acceptance`、
`C:\Users\yedon\BeybladeTracker-backup-20260802`。

驗收腳本已納入版控（`scripts/acceptance/`），所以刪掉共用資料夾不會遺失任何東西。
