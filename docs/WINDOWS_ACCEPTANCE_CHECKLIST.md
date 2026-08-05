# Windows 實機驗收清單（RC 1.0.0）

對象產物：`BeybladeTracker-1.0.0-Setup.exe`
SHA-256：`7794f66f018bbb285fa4a537e74e1237c3028d0665360c5ce513231c7c74eca1`
來源 commit：`2eca4c9`
建立日期：2026-08-02

驗收前請先讀 [RELEASE_CANDIDATE_1.0.0.md](RELEASE_CANDIDATE_1.0.0.md)（重建與簽章現況）與 [RUNBOOK.md](RUNBOOK.md) 第 13 節（release gate）。

---

## 0. 這份清單為什麼不是「再跑一次 E2E」

已完成的三項封裝 E2E 是用下列參數執行的：

```
/VERYSILENT /SUPPRESSMSGBOXES /NOICONS /TASKS= /DIR=<temp>
＋ BEYBLADE_INSTALL_ROOT / BEYBLADE_USER_ROOT 環境變數覆寫
```

也就是說，E2E **刻意繞過**了互動精靈、開始功能表捷徑、登入自動啟動、預設安裝路徑與所有對話框。
本清單只涵蓋 E2E 結構上測不到的部分，不重複 E2E 已證明的事。

---

## 1. 前置條件

| 條件 | 要求 |
| --- | --- |
| 測試機 | **乾淨 Windows VM**（RUNBOOK 第 13 節要求）。不可用日常工作機。 |
| 快照 | 開始前拍快照。項目 A-11 具破壞性，測完必須還原。 |
| 既有安裝 | 必須無任何 Beyblade Tracker 安裝、無 `%LOCALAPPDATA%\BeybladeTracker`、`HKCU\...\Run\BeybladeTracker` 未設定。 |
| 帳號 | 一般使用者權限即可（安裝器 `PrivilegesRequired=lowest`）。 |
| 網路 | 項目 A-9 需要對外網路。 |

### 開發機 `C--Dev-Beyblade-dev`（yedon）狀態

2026-08-02 首次檢查時，此機器有一個裝在非預設路徑 `C:\Dev\Beyblade Tracker` 的 1.0.0 舊安裝（2026-07-28），且 `HKCU\...\Uninstall` 無對應條目、`Run\BeybladeTracker` 指向它並使用舊格式 `start`（缺 `noninteractive`）。

**已於 2026-08-02 以該安裝自身的 `unins000.exe` 移除完成**：安裝目錄、`Run` 機碼、開始功能表捷徑皆已清除（`Removed all? Yes`），使用者資料依「保留」分支完整保存並經雜湊比對與 `PRAGMA integrity_check = ok` 驗證。移除前的完整備份存於 `C:\Users\yedon\BeybladeTracker-backup-20260802\`。

即便如此，此機器**仍不建議**用於本清單：`%LOCALAPPDATA%\BeybladeTracker` 保有實際使用者資料，項目 A-11 會將其永久刪除。請使用乾淨 VM。

#### 附帶發現：舊版不理會 `/SUPPRESSMSGBOXES`

移除舊安裝時，`/SUPPRESSMSGBOXES` **未能**抑制資料保留提示，解除安裝程序停在互動對話框等待人為點選。比對兩份 log：

| 版本 | log 內容 |
| --- | --- |
| 舊安裝（2026-07-28 build） | `Message box (Yes/No):` — 實際彈窗並阻塞 |
| 現行 RC（2026-08-02 build） | `Defaulting to Yes for suppressed message box (Yes/No):` — 正確採用預設值 |

舊版使用普通 `MsgBox`，現行 `installer.iss` 已改用 `SuppressibleMsgBox`。**此缺陷在現行 RC 已修正**，這也是今天三項 E2E 能全自動完成而不阻塞的原因。

---

## 2. A 段：現在可執行

判定欄填 `PASS` / `FAIL` / `未測`。FAIL 時在證據欄記錄實際觀察與（若有）`BT-*` 代碼。

### A-1 互動安裝，使用預設路徑

**操作**：雙擊 `BeybladeTracker-1.0.0-Setup.exe`，全程使用預設值完成精靈。

**預期結果**：
- 程式安裝於 `%LOCALAPPDATA%\Programs\Beyblade Tracker`
- 存在 `versions\1.0.0\`，其中含 `runtime\node.exe`
- `current.json` 內容為 `{"version":"1.0.0"}`
- 全程不需系統管理員權限、不需 PowerShell 或開發工具
- 安裝結束後背景服務自動啟動，`http://127.0.0.1:8787/health` 回應 `ok` 或 `degraded`，且 `release.version` = `1.0.0`

| 判定 | 證據／備註 |
| --- | --- |
| **PASS** | 2026-08-02 Test_Darren 帳號。安裝於 `%LOCALAPPDATA%\Programs\Beyblade Tracker`；`current.json` = `{"version":"1.0.0"}`；`versions\1.0.0\runtime\node.exe` 存在；installer log 為 `Installation process succeeded.`、`User privileges: None`、`Install mode root key: HKEY_CURRENT_USER`。服務於 **18 秒**內就緒（18:27:07 啟動 → 18:27:25.128 `web app on http://127.0.0.1:8787`），`/health` = `ok`、version `1.0.0`。另見缺陷 **D-1**。 |

### A-2 開始功能表捷徑（5 個）

**操作**：逐一點開下列捷徑。

**預期結果**：五個捷徑皆存在於「Beyblade Tracker」群組且可正常運作。

| 捷徑名稱 | 預期行為 | 判定 | 證據 |
| --- | --- | --- | --- |
| Beyblade Tracker | 以預設瀏覽器開啟管理頁 | **PASS** | 開啟 msedge PID 7468，`IsWindowVisible=True`、`IsIconic=False`，標題「總覽｜Beyblade Tracker」 |
| 匯出／移機 | 出現匯出對話框 | **PASS** | 另存新檔對話框正常出現 |
| 匯入／移機 | 出現選檔對話框 | **PASS** | 開啟檔案對話框正常出現 |
| 停止背景追蹤 | 服務停止，`/health` 不再回應 | **PASS** | 8787 於 **2.0 秒**內停止監聽，無殘留 Beyblade node 行程 |
| 服務狀態 | 顯示狀態視窗，文字為繁中且無亂碼 | **PASS** | 繁中正常，無亂碼 |

**A-2 整體：PASS**（2026-08-02，Test_Darren）。停止耗時 2.0 秒，遠低於 `service-control` 的 35 秒與 `launcher.ps1` 的 45 秒上限。

### A-3 登入後自動啟動

**操作**：安裝時保留「登入 Windows 後自動啟動背景追蹤」→ **登出後重新登入**。

**預期結果**：
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\BeybladeTracker` = `"...\wscript.exe" "...\launcher.vbs" start noninteractive`
- 登入後服務自動啟動，`/health` 正常
- **登入過程不出現任何視窗、主控台或對話框**（`noninteractive` 的重點）

| 判定 | 證據／備註 |
| --- | --- |
| **PASS** | 2026-08-05 乾淨重測（工作階段 4）。機碼格式正確（含 `noninteractive`）。登入 07:59:44 → 服務 `startedAt` 08:00:22，**37.5 秒**，全程未點擊任何捷徑，故必為機碼觸發。驗收者親眼確認登入過程**無主控台、無對話框、工作列無異常、無 Chrome**；第 5 節亦顯示無任何殘留 launcher 行程，佐證 `-NonInteractive` 路徑正常收尾。<br><br>首次量測（07:36:56 登入）因中途有手動 `-Action open` 介入而作廢，不採計。 |

#### A-3 附帶觀察：自動啟動耗時逼近逾時上限

37.5 秒這個數字值得留意。`launcher.ps1` 中：

```powershell
$controlTimeoutSeconds = @{ 'start' = 40; 'restart' = 80; 'stop' = 45; 'status' = 20 }
```

登入自動啟動走 `start`，上限 **40 秒**，本次實測 37.5 秒 —— **僅剩約 2.5 秒餘裕**。在較慢的機器、或開機啟動項較多的環境，這極可能超時。

且該註解寫著「stays above the service-control timeout it drives (**start 15s**)」，但實測服務要 37.5 秒才寫出狀態檔，遠超 service-control 自身的 15 秒視窗。這代表可能已發生「service-control 回報啟動失敗（`BT-LCH-003`）、但服務其實稍後成功啟動」的情況。

**此問題不易察覺**：機碼透過 `wscript` 隱藏視窗執行，`-NonInteractive` 模式只把錯誤碼寫到 stderr，而該 stderr 無人接收，因此即使 launcher 判定失敗也不會有任何跡象。

本次結果正確，故不列為缺陷，但列為**待調查的健壯性風險**；建議在修 D-4 時一併檢視這組逾時值是否貼近真實首次啟動耗時。

### A-4 Chrome 偵測兩個分支

**操作**：分兩次測試。

**預期結果**：

| 情境 | 預期 | 判定 | 證據 |
| --- | --- | --- | --- |
| 已安裝 Chrome | 精靈不顯示提示；`/health` 顯示 browser available、name = `Google Chrome` | **PASS** | 2026-08-02：`/health` 回報 `browser : available=True name=Google Chrome`；精靈未顯示缺少 Chrome 的提示 |
| 移除 Chrome 後安裝<br>（**僅路線 2 可測**） | 精靈在「準備安裝」頁顯示找不到 Chrome 的提示；選「是」開啟 `https://www.google.com/chrome/`；選「否」仍可完成安裝，HTTP-only 來源可正常掃描 |  |  |

> 偵測路徑依序為 `CHROME_PATH`、`%PROGRAMFILES%`、`%PROGRAMFILES(X86)%`、`%LOCALAPPDATA%` 下的 `Google\Chrome\Application\chrome.exe`。

### A-5 首次啟動導覽

**操作**：首次開啟管理頁，完成導覽。

**預期結果**：可設定語言、通知、掃描頻率與資料保存；設定儲存後重開仍保留。

導覽為 `!settings.onboardingCompleted` 時顯示的強制回應對話框（`src/web/ui.js` 的 `onboardingDialog`），欄位依序為：語言 → 通知方式 → **Telegram 區塊（BotFather 連結、操作說明、Bot Token／Chat ID 輸入欄）** → 掃描頻率 → 資料保存天數。

| 判定 | 證據／備註 |
| --- | --- |
| **部分** | 2026-08-02：驗收者確認安裝後管理頁確有出現此導覽（描述為「輸入連結跟說明」，即 Telegram 區塊）。**尚待確認是否按下儲存完成** —— 未完成則 `onboardingCompleted` 不會寫入，下次開啟仍會再次跳出，此為本項的驗證重點。 |

### A-6 繁中文案與錯誤代碼

**操作**：在 Windows PowerShell 5.1 環境操作 Launcher；並依 RUNBOOK 第 13 節「Launcher error verification」製造 `current.json` 缺失、runtime 缺失、service failure、health timeout。

**預期結果**：
- Launcher 狀態提示、匯入／匯出對話框文字為繁中且無亂碼
- 每個失敗路徑顯示 native dialog，含固定 `BT-LCH-*` 代碼、繁中復原指引、「複製錯誤資訊」與「問題回報」
- 複製內容**只含**代碼、App version、UTC 與 safe support reference；**不得**含完整路徑、stack、Token、Webhook 或 URL

#### A-6a 非互動路徑（已自動化）

新增 `scripts/phase7-launcher-errors.ps1`（`npm run test:release:launcher-errors`）。它在隔離安裝目錄逐一注入故障，以 `-NonInteractive` 呼叫 launcher，斷言 exit code 為 1、stderr **恰好等於**預期代碼、stdout 無輸出，且 stderr 不含安裝路徑、使用者目錄、`.ps1`／`.js`、stack 字樣或 URL。

| 案例 | 注入 | 預期 | 判定 |
| --- | --- | --- | --- |
| A | 刪除 `current.json` | `BT-LCH-001` | **PASS** |
| B | 刪除 `runtime\node.exe` | `BT-LCH-002` | **PASS** |
| C | `service-control.js` stub 回傳 1 | `BT-LCH-003` | **PASS** |
| D | stub 回傳 0 但不啟動服務（health timeout） | `BT-LCH-004` | **PASS** |
| E | `-NonInteractive` + `export` | `BT-LCH-006` | **PASS** |

2026-08-05 實測：**5 PASS / 0 FAIL / 0 SKIPPED**，35.9 秒，無殘留目錄或行程。

案例 D 需要 port 8787 淨空（`Wait-ForManagementPage` 硬編碼該位址，無法改 port）；腳本會偵測監聽者並標記 `SKIPPED` 而非誤判為通過。首次執行即因 Test_Darren 的服務占用而正確跳過，停止該服務後重跑始得 PASS。

#### A-6b 互動對話框路徑（人工目視，尚未執行）

自動化只涵蓋 `-NonInteractive`（僅寫 stderr、不開對話框）。RUNBOOK 要求的 native dialog、繁中復原指引、「複製錯誤資訊」與「問題回報」按鈕，須以 `C:\Users\Public\BeybladeTracker-Acceptance\a6-dialog.ps1` 人工驗證。該腳本刻意以 `wscript.exe launcher.vbs`（隱藏視窗、互動模式）啟動，即開始功能表捷徑的真實路徑，用以確認從隱藏行程彈出的對話框確實可見且可操作。

| 判定 | 證據／備註 |
| --- | --- |
| **A-6a：PASS**<br>**A-6b：FAIL** | A-6a 見上表。<br><br>**A-6b 於 2026-08-05 執行並失敗**：以 `wscript.exe launcher.vbs start`（真實捷徑路徑）觸發 `BT-LCH-001`，**畫面上完全沒有出現任何對話框**，驗收者三題皆答 N，剪貼簿維持哨兵值未被寫入。RUNBOOK 第 13 節「每個 hidden Launcher 路徑都必須顯示 native dialog」**未達成**。根因見缺陷 **D-4**。 |

> 已知預期現象：`BT-LCH-001` 情境下 `current.json` 無法讀取，故 launcher 的 `$appVersion` 為 `unknown`，複製內容中的 App version 會顯示 `unknown`。屬設計行為，但支援端因此拿不到版本號，值得後續評估。

> 建置端已確認 `release/windows/launcher.ps1` 開頭為 `EF BB BF`（UTF-8 with BOM），亂碼風險已預先排除。

### A-7 匯出／匯入移機

**操作**：由捷徑匯出 `.beyblade-transfer`，在另一台（或還原快照後的）測試機匯入。

**預期結果**：
- 匯入時驗證 SHA-256 與 SQLite 完整性後重新啟動
- 商品、事件、觀測筆數不遺失
- 移機檔**不含** Token、Webhook、PID、日誌或 debug HTML；通知憑證需重新設定

| 判定 | 證據／備註 |
| --- | --- |
| **匯出側：PASS**<br>**匯入側：待執行** | 2026-08-05 由「匯出／移機」捷徑匯出 `beyblade-transfer-20260805-104427.beyblade-transfer`（壓縮 123,745 bytes／解壓 1,171,557 bytes）。<br><br>`format=beyblade-transfer-v1`、`appVersion=1.0.0`、`schemaVersion=13`、`exclusions=["secrets","runtime","logs","debug-html"]`。內含檔案**恰好兩個**：`tracker.db`（876,544 bytes）與 `sources.json`（1,833 bytes），兩者 SHA-256 重算皆符；DB 檔頭為 `SQLite format 3`；`sources.json` 含 3 個來源。<br><br>安全性掃描七項（Telegram token 格式、`secrets.json`、webhook 字樣、Discord webhook URL、`tracker.pid`、`tracker.log`、debug HTML）**全部未命中**。<br><br>匯出前後 `tracker.db` 的 SHA-256 相同（`53405a0f…`），確認匯出為唯讀操作。<br><br>匯入側依路線 1 執行順序，留待 A-11 清空資料後進行，以驗證跨乾淨環境還原。 |

> **Token 排除為結構性保證**：secrets 儲存於獨立的 `config\secrets.json`（`src/paths.js` 的 `secretFile`），而 `createTransferBundle` 只打包 `tracker.db` 與 `sources.json`，故憑證不可能進入移機檔。此結論不依賴 A-8 是否已設定 Telegram。
>
> 字串掃描對 `tracker.db` 的涵蓋有限（二進位且經 base64 編碼），故以上述結構性保證為主要依據。

### A-8 Telegram 通知與 DPAPI

**操作**：於設定頁完成 BotFather 引導、儲存 Token／Chat ID、發送測試通知。

**預期結果**：
- Token／Chat ID 以 Windows DPAPI CurrentUser 保護
- 設定頁**永不**回傳 Token 明文
- 測試通知可送達

> ⚠️ Token 屬個人憑證，請自行輸入，不要交給任何助理或貼進工單。

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

### A-9 實際網路抓取

**操作**：啟用既有商店來源，執行一次掃描。

**預期結果**：三個實際來源皆能擷取並解析；失敗時於來源管理頁顯示可操作的繁中錯誤。

| 判定 | 證據／備註 |
| --- | --- |
| **部分** | 2026-08-02 首次啟動自動執行掃描：`sources 3, ok 2, failed 1, itemsSeen 2, eventsCreated 1`，通知 1 送出。`yodobashi-ux20`（895 ms）與 `hlj-ux20`（2026 ms）成功；**`shimamura-ux20` 失敗**：`page.waitForSelector: Timeout 45000ms exceeded`，等待 `.catalogue__infoTitle`，耗時 48379 ms。見缺陷 **D-2**。UI 端的繁中錯誤呈現尚未檢視。 |

### A-10 解除安裝 — 選「保留資料」

**操作**：由 Windows「已安裝的應用程式」解除安裝，資料提示選「**是**」。

**預期結果**：
- 解除安裝前背景服務已停止
- 程式檔案（`versions\`、`current.json`）移除，開始功能表捷徑移除，`Run` 機碼移除
- `%LOCALAPPDATA%\BeybladeTracker` 的商品、歷史、設定與備份**完整保留**

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

### A-11 解除安裝 — 選「刪除資料」⚠️ 破壞性

**操作**：重新安裝後再次解除安裝，資料提示選「**否**」。

**預期結果**：`%LOCALAPPDATA%\BeybladeTracker` 整個目錄被移除（`DelTree`），程式檔案亦移除。

> **這是唯一從未被執行過的路徑。** E2E 使用 `/SUPPRESSMSGBOXES`，一律取得預設值 `IDYES`（保留），因此 `PreserveUserData = False` 的分支從未執行。此操作會永久刪除使用者資料，**必須**在快照後執行，測完立即還原快照。

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

---

## 2.1 路線 1：本機測試帳號（先行，覆蓋 11 項中的 10 項）

本安裝器完全是 per-user 的（`PrivilegesRequired=lowest`、`DefaultDirName={localappdata}`、`Run` 機碼在 HKCU、開始功能表為 `{group}`、使用者資料在 `%LOCALAPPDATA%\BeybladeTracker`），因此**一個全新的本機帳號對本 App 而言即為乾淨環境**，可在不建 VM 的情況下先跑一輪。

### 適用範圍

| 可測 | A-1、A-2、A-3、A-4（有 Chrome 分支）、A-5、A-6、A-7、A-8、A-9、A-10、A-11 |
| --- | --- |
| **不可測** | **A-4 的「無 Chrome」分支** — Chrome 安裝於 `C:\Program Files`，全機器共用，換帳號仍可見。此項需路線 2。 |

此路線**不等於** RUNBOOK 要求的 clean VM：本機另有全機器安裝的 Chrome 與 `C:\Program Files\nodejs`，因此「不需開發工具」一項無法用「機器上沒有 Node」證明，須改用下方的間接驗證。最終 gate 仍須以路線 2 補齊。

### 前置

1. 確認目前登入的工作帳號**沒有** Tracker 在跑（否則會搶 port 8787）：

   ```powershell
   Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue
   ```

   須無輸出。注意快速使用者切換不會結束原帳號的程序。

2. 建立本機測試帳號：設定 → 帳戶 → 其他使用者 → 新增帳戶 →
   「我沒有這位人員的登入資訊」→「新增沒有 Microsoft 帳戶的使用者」。
3. 安裝包已置於跨帳號可讀路徑 `C:\Users\Public\BeybladeTracker-Acceptance\`。
   在測試帳號安裝前先執行 `verify-installer.ps1` 確認雜湊。

### 執行順序

利用 A-11 的破壞性清空作為 A-7 匯入側的乾淨起點，可省去額外帳號：

| 步驟 | 動作 |
| --- | --- |
| 1 | 登入測試帳號，執行 `verify-installer.ps1`（須 MATCH） |
| 2 | **A-1** 安裝（預設路徑）→ **A-2** 捷徑 → **A-4（有 Chrome 分支）** → **A-5** 導覽 |
| 3 | **A-9** 實際抓取 — 先產生真實資料，後面的保留／匯出驗證才有意義 |
| 4 | **A-8** Telegram（用你自己的 Token） |
| 5 | **A-6** Launcher 錯誤代碼（需蓄意破壞安裝檔，故排在資料驗證之後） |
| 6 | **A-3** 登出再登入 — 真實 Windows 登入流程，比 VM 快照更貼近實況 |
| 7 | **A-7 匯出** → 檔案存到 `C:\Users\Public\BeybladeTracker-Acceptance\` |
| 8 | **A-10** 解除安裝（保留資料）→ 確認 `%LOCALAPPDATA%\BeybladeTracker` 完整 |
| 9 | 重新安裝 → **A-11** 解除安裝（刪除資料）→ 確認該目錄消失 |
| 10 | 重新安裝 → 匯入步驟 7 的檔案，完成 **A-7 匯入側**（此時為乾淨狀態） |
| 11 | 收尾：解除安裝（刪除資料）→ 登出 → 由工作帳號刪除測試帳號 |

> A-11 只會刪除**測試帳號**的 `%LOCALAPPDATA%\BeybladeTracker`，不影響其他帳號的資料。

### 如何證明用的是內建 Node（本機有系統 Node 時的替代驗證）

本機 `C:\Program Files\nodejs\node.exe` 存在，因此需明確證明服務跑的是安裝包內建的 runtime。服務啟動後在**測試帳號**執行：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine | Format-List
```

**預期**：命令列指向
`%LOCALAPPDATA%\Programs\Beyblade Tracker\versions\1.0.0\runtime\node.exe`，
**不得**為 `C:\Program Files\nodejs\node.exe`。

| 判定 | 證據／備註 |
| --- | --- |
| **PASS** | 2026-08-02：服務程序命令列為 `...\Programs\Beyblade Tracker\versions\1.0.0\runtime\node.exe --no-warnings ...\bin\service.js`；`tracker-status.json` 的 `executablePath` 亦指向同一內建 runtime。本機雖有 `C:\Program Files\nodejs`，但未被使用。 |

---

## 2.2 路線 2：乾淨 VM — 執行順序與快照規劃

A 段各項之間有相依性，順序錯了會需要重做。建議如下：

| 步驟 | 動作 | 說明 |
| --- | --- | --- |
| 1 | 建立乾淨 Windows VM，**先不要裝 Chrome** → 拍快照 **S0** | A-4 的「無 Chrome」分支只有在這個狀態才測得到 |
| 2 | 執行 **A-4（無 Chrome 分支）** | 確認精靈提示、下載頁連結、以及 HTTP-only 來源仍可掃描 |
| 3 | 還原 **S0** → 安裝 Chrome → 拍快照 **S1** | S1 = 乾淨且有 Chrome，之後所有測試的基準 |
| 4 | **A-1** 安裝 → **A-2** 捷徑 → **A-4（有 Chrome 分支）** → **A-5** 導覽 | 基本安裝鏈 |
| 5 | **A-9** 實際抓取 → **A-8** Telegram | 需要網路與你的 Token |
| 6 | **A-6** Launcher 錯誤代碼 | 需要蓄意破壞安裝檔，放在資料驗證之後 |
| 7 | **A-3** 登出再登入 | 驗證自動啟動與「登入不跳視窗」 |
| 8 | **A-7** 匯出移機檔 → 存到 VM 外部 | 匯入要留到步驟 10 |
| 9 | **A-10** 解除安裝（保留資料）→ 確認使用者資料完整保留 | — |
| 10 | 還原 **S1** → 安裝 → 匯入步驟 8 的檔案，完成 **A-7** 匯入側 | 跨乾淨環境才能真正驗證移機 |
| 11 | **A-11** 解除安裝（刪除資料）⚠️ → 確認目錄消失 → **立即還原 S1** | 破壞性，務必最後做 |

重點：**A-4 的無 Chrome 分支必須排在最前面**。一旦裝了 Chrome，要回到那個狀態就得還原快照。

---

## 3. B 段：目前受阻，不納入本輪

| 項目 | 阻擋原因 |
| --- | --- |
| 線上更新 | 需 HTTPS 發佈站 **並且**需要一個 1.0.1 版本 |
| Rollback | 需先有一次成功的更新才有可回滾的對象 |
| Migration 升級路徑 | 同樣需要第二個版本 |
| SmartScreen | 需 Authenticode 憑證（見 RELEASE_CANDIDATE_1.0.0.md 第 8.2 節） |

**容易誤判的點**：光有 HTTPS 發佈站仍測不了更新。`validateUpdateManifest()` 需要
`compareVersions(manifest.version, APP_VERSION) > 0` 才會回報 `updateAvailable`；
manifest 與已安裝版本同為 1.0.0 時，永遠只會顯示「已是最新」。
要驗證更新鏈，必須另外建置一個 1.0.1 作為更新目標。

---

## 3.1 已發現的缺陷（2026-08-02 第一輪）

### D-1 安裝完成後出現無法操作的 Chrome 視窗 — **已查明，非缺陷**

**結論（2026-08-02 確認）**：該視窗是**爬蟲的螢幕外 Chrome**，並非 launcher 或捷徑所開啟。

`config/sources.json` 中 `shimamura-ux20` 設定為 `"connector": "browser"`、`"channel": "chrome"`、`"headless": false`、`"offscreen": true`；而 `src/connectors/browser.js:22-24` 對此組合套用：

```js
launch.args = ['--window-position=-32000,-32000', '--window-size=900,700'];
```

因此會啟動一個**具視窗的（非 headless）Chrome**，只是被移到座標 -32000,-32000。它擁有正常的工作列按鈕，但點擊後視窗在螢幕外，使用者看不到任何東西 —— 與回報的「工具列有 Chrome 圖示，點不開，只存在下方工具列」完全吻合。

時間亦吻合：首次掃描於 18:27:25.134 啟動，`shimamura-ux20` 於 48379 ms 後逾時失敗，該 Chrome 視窗在這約 48 秒間存在。

**A-2 驗證結果排除了 launcher 涉入**：點擊「Beyblade Tracker」捷徑實際開啟的是 **msedge**（該帳號預設瀏覽器），且 `IsWindowVisible=True`、`IsIconic=False`，管理頁正常顯示。捷徑功能正常。

此為既有設計行為（TODO.md 已記載「使用螢幕外 Chrome 讀取公開頁」），**不列為缺陷**。唯一值得考慮的改善是：其暴露時間長達 48 秒是被 **D-2** 放大的；若 `shimamura-ux20` 正常運作，該視窗只會短暫存在。若仍希望使用者完全不見到它，可評估改用 `headless: true`，但需先確認該站在 headless 下是否仍可取得內容。

<details>
<summary>先前兩個已被推翻的假說（保留以免重複調查）</summary>

1. **「安裝器不等服務就緒即開啟瀏覽器」** — 錯誤。`launcher.ps1` 僅 `open` 分支會 `Start-Process`，安裝器 `[Run]` 執行的是 `restart`，不開瀏覽器。
2. **「`Wait-ForManagementPage` 15 秒逾時導致 BT-LCH-004 對話框」** — 錯誤。驗收者確認圖示為 Chrome 且畫面無任何錯誤代碼，表示 launcher 未進入錯誤分支。

</details>

### D-2 `shimamura-ux20` 商品 URL 已失效 — **根因已查明**

首次掃描中該來源失敗：`page.waitForSelector: Timeout 45000ms exceeded`，等待 `.catalogue__infoTitle`，耗時 48379 ms。另兩個來源正常。

**根因（2026-08-02 實測）**：設定中的商品頁 `https://www.shop-shimamura.com/item/0363100014177/` **已下架**。以有頭 Chrome 實際存取，頁面標題為：

> お探しの商品は現在お取り扱いがございません。 | しまむらパーク

即該站自己的「查無此商品」錯誤頁。`.catalogue__infoTitle` 本來就不存在於錯誤頁，因此必然逾時。**非程式缺陷，非等候室，非阻擋** —— 是設定中的 URL 過期。

四組對照實測：

| 測試 | 設定 | 結果 |
| --- | --- | --- |
| A | `headless:false` + offscreen（現況） | 頁面載入成功，內容為「查無此商品」錯誤頁 |
| B | `headless:true` | **Access Denied**（Akamai `errors.edgesuite.net`） |
| C | `--headless=new` | **Access Denied** |
| D | `headless:false` 打首頁（對照組） | 正常，405 KB |

**影響**：本 RC 的 payload 內含這個失效 URL，因此任何使用者安裝後，每次掃描都會在該來源上耗掉 45 秒逾時。建議在發佈前更新或停用此來源。

**副作用**：這也是 D-1 那個螢幕外 Chrome 視窗存在長達 48 秒的原因。若此來源修正或停用，該視窗即不再出現（或僅短暫出現）。

#### 附帶結論：無法改用 headless 來隱藏爬蟲視窗

測試 B 與 C 證實該站封鎖 headless Chrome（新舊模式皆然），只有有頭模式能取得內容。因此 `config/sources.json` 中的 `"headless": false` 是**必要設定**，不可為了隱藏視窗而改成 headless —— 那會讓來源直接失效。目前的 `--window-position=-32000,-32000` 已是可行範圍內最接近隱藏的做法；視窗本身不可見，僅保留工作列按鈕。

### D-3 發佈產物內含建置者的個人來源設定（**最高優先**）

`scripts/build-windows-release.js` 複製整個 `config` 目錄進 payload，因此 **`config/sources.json` 被打包進安裝器**。但該檔案受 `.gitignore` 排除，git 只追蹤 `config/sources.example.json`。

`diff` 確認：payload 內的 `config/sources.json` 與建置機上的個人設定**完全相同**，含 `yodobashi-ux20`、`shimamura-ux20`、`hlj-ux20` 三個真實日本商店。

`src/config.js:36-42` 的解析順序使問題成立：

```
1. SOURCES_FILE 環境變數
2. %LOCALAPPDATA%\BeybladeTracker\config\sources.json   ← 全新安裝不存在
3. <appRoot>\config\sources.json                        ← 命中打包進去的個人設定
4. <appRoot>\config\sources.example.json                ← 設計上的預設，永遠不會被使用
```

**後果**：

1. **建置不可重現** —— 出貨的預設來源清單取決於建置者機器上一個未納入版控的檔案。換一台機器建置就會出貨不同內容。
2. **散布個人設定** —— 所有使用者都會繼承建置者的來源清單。
3. **違背既有設計** —— `sources.example.json` 的註解明確寫著「Copy to config/sources.json and edit... product pages **you add yourself**」，且提醒「be a good citizen and respect each site's terms and rate limits」。實際行為卻是使用者**未曾新增任何來源**，安裝後就立刻開始抓取三個真實零售網站。
4. **D-2 因此擴散** —— 失效的 shimamura URL 隨之送到每一位使用者手上，每輪掃描固定浪費 45 秒。

實測佐證：Test_Darren 全新安裝後的首次掃描即回報 `sources 3`，且三個 key 與建置機個人設定一致。

**建議修正方向**：build 時排除 `config/sources.json`（只打包 `sources.example.json`），讓解析順序自然落到第 4 項。如此全新安裝會以離線 demo fixture 起步，由使用者自行新增來源 —— 這正是原本的設計意圖。D-2 對終端使用者亦隨之消失。

---

### D-4 互動模式的錯誤對話框不可見，且使 launcher 永久阻塞（**最高優先，與 D-3 並列**）

**根因已由實驗證實（2026-08-05）。** 兩個原本看似無關的症狀 —— A-6b 沒有對話框、以及 launcher 行程卡住不結束 —— 是**同一個缺陷**。

#### 證據

以隔離目錄（僅 `launcher.ps1` + `launcher.vbs`，刻意不建 `current.json` 以觸發 `BT-LCH-001`）比對兩條啟動路徑：

| 路徑 | 對話框 | 行程 |
| --- | --- | --- |
| A：直接 `powershell.exe -File launcher.ps1 -Action start` | **出現**，`IsWindowVisible=True`，關閉後 exit 1 | 正常結束 |
| B：`wscript.exe launcher.vbs start`（**真實捷徑路徑**） | **未出現** | **永久阻塞** |

以 `EnumWindows` 列舉路徑 B 那個行程的所有頂層視窗：

```
handle=199360  visible=False  title='Beyblade Tracker'      ← 對話框確實存在，只是隱藏
Process.MainWindowHandle : 0
呼叫 ShowWindow(handle, SW_SHOW) 後 → visible=True
```

#### 機制

`launcher.vbs` 以隱藏視窗啟動 PowerShell：

```vbscript
shell.Run command, 0, False   ' 0 = SW_HIDE
```

行程的 `STARTUPINFO.wShowWindow` 因而是 `SW_HIDE`，而 WinForms 建立的**第一個頂層視窗會沿用該狀態**。於是 `Show-LauncherError` 的 `$form.ShowDialog()` 開出一個看不見的強制回應對話框，並在其上**無限期阻塞**。

`Process.MainWindowHandle` 只回報可見視窗，所以會回 `0` —— 這正是先前誤判「排除卡在對話框」的原因。**該推論已作廢**；原先歸咎於 `Run-Control` 互動分支缺少逾時保護、node 繼承 handle 導致 `&` 永久等待的假說，**並非本缺陷的成因**。

#### 影響（嚴重）

1. **所有經由開始功能表捷徑或安裝器 `[Run]` 觸發的 `BT-LCH-*` 錯誤，使用者完全看不到任何提示。**
2. 整套錯誤處理 UX —— 固定代碼、繁中復原指引、「複製錯誤資訊」、「問題回報」按鈕 —— 在真實使用情境下**完全無法觸及**。這是 RUNBOOK 第 13 節的明文要求，目前未達成。
3. 每次發生就累積一個永久阻塞的隱藏 PowerShell 行程。
4. 使用者只會看到「點了捷徑但什麼都沒發生」，無從自救也無法回報。

#### 可回溯解釋的既有觀測

- A-3 首次量測中 `launcher.ps1 -Action open`（07:38:11 啟動）卡了 7.5 分鐘且 `MainWindowHandle=0`：當時服務尚未就緒，`Wait-ForManagementPage` 15 秒逾時 → `BT-LCH-004` → 隱藏對話框 → 永久阻塞。
- 安裝當下 18:27:17 觀測到的 `PID 564` 殘留，屬同一現象。

#### E2E 為何測不到

`phase7-e2e.ps1` 全程 `/VERYSILENT`，安裝器 `[Run]` 走 `Check: WizardSilent` 的 `noninteractive` 分支，而 `-NonInteractive` 模式只把代碼寫到 stderr、**不建立對話框**。新增的 `phase7-launcher-errors.ps1` 同樣只涵蓋 `-NonInteractive`。互動分支從未被任何自動化涵蓋。

#### 影響範圍已收斂：不含檔案對話框（2026-08-05）

A-7 匯出側證實「匯出／移機」捷徑**可正常運作** —— 同樣經由 `wscript.exe launcher.vbs`（隱藏視窗、互動模式），`SaveFileDialog` 正常彈出、使用者完成存檔、檔案通過完整驗證。

原因是兩者機制不同：`SaveFileDialog` 是由 comdlg32／shell 建立的共用對話框，不受呼叫端 `STARTUPINFO.wShowWindow` 影響；而 `Show-LauncherError` 的 `$form.ShowDialog()` 是本行程建立的第一個 WinForms 頂層視窗，會沿用 `SW_HIDE`。

因此 **D-4 只影響錯誤對話框**，`匯出／移機` 與 `匯入／移機` 兩個捷徑功能正常。這使嚴重度略降，但核心問題不變：使用者在**出錯時**完全得不到任何提示。

#### 修正方向（已實測可行）

實驗顯示對 `Beyblade Tracker` 視窗呼叫 `ShowWindow(hwnd, SW_SHOW)` 即可讓它現身，因此修法只需確保該表單以正常狀態顯示，例如在 `Show-LauncherError` 中於表單 `Shown` 事件呼叫 `ShowWindow(SW_SHOW)`、或搭配 `TopMost` 與 `Activate()`。**不應**改動 `launcher.vbs` 的 `shell.Run ... 0` —— 隱藏 PowerShell 主控台本身是正確設計，不該為此讓黑窗在每次啟動時閃現。

修好後應補上互動路徑的自動化涵蓋，避免再次回歸。

---

### 已排除：log 中文亂碼（**非缺陷**）

第一版診斷腳本以 `Get-Content` 未指定編碼讀取 `tracker.log`，在 Windows PowerShell 5.1 下以 ANSI 解讀 UTF-8，導致輸出呈現 `?? New product @ Yodobashi ??2450 JPY`。

以 `-Encoding UTF8` 重讀同一份 log 得到 `🆕 New product @ Yodobashi — 2450 JPY`，證實**應用程式寫出的 UTF-8 完全正確**，亂碼純屬診斷腳本缺陷，已修正。此案例與 A-6 要驗證的 BOM／編碼議題同源，記錄於此以免日後重複誤判。

---

## 4. 驗收結論

| 欄位 | 內容 |
| --- | --- |
| 執行者 |  |
| 測試機／快照 ID |  |
| 執行日期 |  |
| A 段結果 | ___ PASS / ___ FAIL / ___ 未測（共 11 項） |
| 阻斷性問題 |  |
| Go / No-Go |  |

A 段全數 PASS 只代表**安裝、執行、解除安裝**層面可接受；因 B 段受阻，仍不得將此產物標示為公開 production release。
