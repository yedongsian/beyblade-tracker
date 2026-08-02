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
|  |  |

### A-2 開始功能表捷徑（5 個）

**操作**：逐一點開下列捷徑。

**預期結果**：五個捷徑皆存在於「Beyblade Tracker」群組且可正常運作。

| 捷徑名稱 | 預期行為 | 判定 | 證據 |
| --- | --- | --- | --- |
| Beyblade Tracker | 以預設瀏覽器開啟管理頁 |  |  |
| 匯出／移機 | 出現匯出對話框 |  |  |
| 匯入／移機 | 出現選檔對話框 |  |  |
| 停止背景追蹤 | 服務停止，`/health` 不再回應 |  |  |
| 服務狀態 | 顯示狀態視窗，文字為繁中且無亂碼 |  |  |

### A-3 登入後自動啟動

**操作**：安裝時保留「登入 Windows 後自動啟動背景追蹤」→ **登出後重新登入**。

**預期結果**：
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\BeybladeTracker` = `"...\wscript.exe" "...\launcher.vbs" start noninteractive`
- 登入後服務自動啟動，`/health` 正常
- **登入過程不出現任何視窗、主控台或對話框**（`noninteractive` 的重點）

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

### A-4 Chrome 偵測兩個分支

**操作**：分兩次測試。

**預期結果**：

| 情境 | 預期 | 判定 | 證據 |
| --- | --- | --- | --- |
| 已安裝 Chrome | 精靈不顯示提示；`/health` 顯示 browser available、name = `Google Chrome` |  |  |
| 移除 Chrome 後安裝 | 精靈在「準備安裝」頁顯示找不到 Chrome 的提示；選「是」開啟 `https://www.google.com/chrome/`；選「否」仍可完成安裝，HTTP-only 來源可正常掃描 |  |  |

> 偵測路徑依序為 `CHROME_PATH`、`%PROGRAMFILES%`、`%PROGRAMFILES(X86)%`、`%LOCALAPPDATA%` 下的 `Google\Chrome\Application\chrome.exe`。

### A-5 首次啟動導覽

**操作**：首次開啟管理頁，完成導覽。

**預期結果**：可設定語言、通知、掃描頻率與資料保存；設定儲存後重開仍保留。

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

### A-6 繁中文案與錯誤代碼

**操作**：在 Windows PowerShell 5.1 環境操作 Launcher；並依 RUNBOOK 第 13 節「Launcher error verification」製造 `current.json` 缺失、runtime 缺失、service failure、health timeout。

**預期結果**：
- Launcher 狀態提示、匯入／匯出對話框文字為繁中且無亂碼
- 每個失敗路徑顯示 native dialog，含固定 `BT-LCH-*` 代碼、繁中復原指引、「複製錯誤資訊」與「問題回報」
- 複製內容**只含**代碼、App version、UTC 與 safe support reference；**不得**含完整路徑、stack、Token、Webhook 或 URL

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

> 建置端已確認 `release/windows/launcher.ps1` 開頭為 `EF BB BF`（UTF-8 with BOM），亂碼風險已預先排除。

### A-7 匯出／匯入移機

**操作**：由捷徑匯出 `.beyblade-transfer`，在另一台（或還原快照後的）測試機匯入。

**預期結果**：
- 匯入時驗證 SHA-256 與 SQLite 完整性後重新啟動
- 商品、事件、觀測筆數不遺失
- 移機檔**不含** Token、Webhook、PID、日誌或 debug HTML；通知憑證需重新設定

| 判定 | 證據／備註 |
| --- | --- |
|  |  |

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
|  |  |

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

## 2.1 建議執行順序與快照規劃

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
