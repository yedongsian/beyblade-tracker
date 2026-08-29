# 乾淨 VM 驗收輪 — 從安裝 VirtualBox 開始

本檔涵蓋**建立乾淨 VM 到完成驗收**的完整順序。
A 段各項的詳細操作步驟見 [WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md](WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md)，本檔不重複。

## 這一輪要完成什麼

| # | 項目 | 為什麼只能在 VM 做 |
| --- | --- | --- |
| 1 | **A-4b 無 Chrome 分支** | Chrome 全機器安裝，本機任何帳號都看得到它 |
| 2 | **A-6b 問題回報按鈕** | 需要在產物上點擊，驗證開啟的 URL |
| 3 | **A-9 失敗來源錯誤呈現** | 需要實機加一個必定失敗的來源 |

第 2、3 項理論上在本機測試帳號也做得到，但既然要開 VM，一起做完省一輪。

## 產物

| | |
| --- | --- |
| 檔案 | `BeybladeTracker-1.0.0-Setup.exe` |
| SHA-256 | `58ac1ee8b84f0c669a6eb386aa4bb462dd47eb41f3a67d66a6138bc87eb5be8d` |
| 大小 | 27,509,937 bytes（2026-08-28 第八次建置） |
| 位置 | 主機 `C:\Users\Public\BeybladeTracker-VM-Round`（**VM 掛載的是這個**，VM 內為 `Z:`）。`BeybladeTracker-Acceptance` 是路線 1 用的另一個資料夾，兩者都已同步為第八版 |

---

---

## 執行進度（2026-08-16）

**主機準備與 VM 建立已完成，`S0-no-chrome` 快照已拍。下次從第三部分階段 1（A-4b）開始。**

| 項目 | 狀態 |
| --- | --- |
| VirtualBox | 7.2.14 r174565 已安裝 |
| VM | `Beyblade-Acceptance`，6144 MB／4 核心／128 MB VRAM／64 GB 動態磁碟 |
| 韌體 | EFI + TPM `v2_0` + UEFI Secure Boot enabled（皆已驗證至 `.vbox` 設定檔層級） |
| Windows | 11 Enterprise 評估版 25H2 zh-tw 已安裝 |
| Guest Additions | 7.2.14 已安裝，RunLevel 2 |
| 共用資料夾 | `BTAcceptance` → `C:\Users\Public\BeybladeTracker-VM-Round`（自動掛載、可寫；VM 內為 `Z:`） |
| 驗收帳號 | `AcceptanceUser`（標準使用者，已確認不在 Administrators 群組） |
| 驗收檔案 | 已複製至 VM 的 `C:\Users\Public\BeybladeTracker-Acceptance`（29 個檔） |
| **快照** | **`S0-no-chrome`**（UUID `1fbe2d2d-fa45-4913-abce-f2405ca1521c`）**已建立** |
| 磁碟 | VDI 21.3 GB＋差異碟 0.4 GB；主機 C: 剩 48.6 GB |

### 建立過程中值得記下的三件事

1. **安全開機需要四個步驟**，本文原先未載明：`modifynvram inituefivarstore` →
   `enrollmssignatures` → **`enrollorclpk`**（註冊平台金鑰，缺這步 `secureboot --enable`
   會失敗並回報 "platform key (PK) is not enrolled"）→ `secureboot --enable`。
   另 `--tpm-type` 的值必須以 `=` 連寫（`--tpm-type=2.0`），空白分隔會靜默失效。
2. **本 VM 為 Entra ID 加入之裝置**。OOBE 時以個人的學校帳號登入，因此 `葉東憲` 為
   `AzureAD\` 帳號。驗收者評估該帳號已無組織管控（校友身分）後決定沿用。
   影響：登入畫面預設走組織帳號，本機帳號須輸入 `.\AcceptanceUser` 才登得進去。
   **此為環境變因，記錄於此以供日後判讀。**
3. 共用資料夾在 VM 內視為網路磁碟機，`.ps1` 會被執行原則擋下。一律以
   `powershell -NoProfile -ExecutionPolicy Bypass -File Z:\<script>.ps1` 執行。

### 階段 1（A-4b）進度：2026-08-17

| 步驟 | 結果 | 證據 |
| --- | --- | --- |
| 1 準備安裝頁出現找不到 Chrome 提示 | **PASS** | 文案：「找不到 Google Chrome。一般 HTTP 商店仍可使用，但需要瀏覽器的來源將無法掃描。是否開啟官方 Chrome 下載頁？」明確載明後果與補救 |
| 2 選「是」開啟官方下載頁 | **PASS** | 實際導向 `https://www.google.com/chrome/` |
| 3 還原 S0 後選「否」仍可完成安裝 | **PASS** | 安裝於 `C:\Users\AcceptanceUser\AppData\Local\Programs\Beyblade Tracker`，`current.json={"version":"1.0.0"}`，內建 node、`launcher.ps1`、5 個開始功能表捷徑、`Run` 機碼（含 `noninteractive`）、解除安裝登錄項目皆齊全，全程未要求提權 |
| 4 服務啟動與瀏覽器偵測 | **PASS** | `/health=ok`；`browser.available=False`；`browser.downloadUrl=https://www.google.com/chrome/`；8787 監聽、無殘留 launcher 行程 |
| 4b 離線 demo fixture | **PASS** | `demo-fixture` enabled/healthy，掃描得 3 items、2 events，送出 2 則通知 |
| 5 JSON-LD 來源（無 Chrome 亦可抓） | **PASS** | 以 UI 新增 `https://www.hlj.com/product/TKT09613`；log：`parser extract hlj-com success validCount:1 pageCount:1`、`source hlj-com: 1 items, 1 events`；筆數 products 2→3、offers 3→4、events 2→3、observations 3→4；`last_success_at=14:13:52`。**在完全沒有 Chrome 的機器上抓到真實商品** |
| 6 設定頁顯示找不到 Chrome 並提供下載連結 | **PASS** | 設定頁顯示「瀏覽器：找不到 Google Chrome」與「前往官方 Chrome 下載頁」，HTML 含 `google.com/chrome` |

**A-4b 六項全數通過 —— 本輪唯一非 VM 不可的項目完成。**

### 階段 4（A-6b）：**PASS**，2026-08-17

以真實捷徑路徑（`wscript.exe launcher.vbs`，隱藏視窗）觸發 `BT-LCH-001`：

| 檢查 | 結果 |
| --- | --- |
| 對話框出現且可操作 | **PASS** — 代碼、標題「找不到目前版本」、繁中復原指引無亂碼，四個按鈕皆可點 |
| 「複製錯誤資訊」內容 | **PASS** — 恰好四行：`錯誤代碼：BT-LCH-001`／`App version：unknown`／`UTC：…`／`Support reference：72255034ffc8`；未含路徑、stack、URL 或憑證字樣 |
| 「問題回報」網址 | **PASS** — `issues/new?template=bug_report.yml&…`，非舊的 `/issues/new/choose` |
| 表單預填 | **PASS** — 標題 `[問題回報] BT-LCH-001`、「錯誤代碼」欄 `BT-LCH-001`、「App 版本」欄 `unknown` |
| 關閉後行程結束 | **PASS** — 無殘留，暫存目錄已清除 |

`App 版本` 為 `unknown` 屬設計行為：本情境刻意移除 `current.json`，版本本就讀不到。

附帶觀察：GitHub 要求登入時，`return_to` 完整保留了整串 query，登入後仍正確帶入所有預填欄位。

> **判讀注意**：結果檔中「沒有偵測到標題為 Beyblade Tracker 的視窗」一行是**腳本偵測過早**所致
> （原本只等 8 秒，VM 走 Hyper-V 後端較慢），**不是** D-4 回歸 —— 對話框確實出現且可操作。
> 已將該偵測改為輪詢至多 40 秒。

附帶佐證：`sources` 表顯示 UI 新增的來源 `managed_by='ui'`、`connector='jsonld'`，
與文件所述「UI 新增的來源一律為 jsonld，不會是 browser connector」相符。
另外此 VM **未安裝任何 Node.js**（診斷腳本必須改用安裝包內建的 `runtime\node.exe`），
是「一般使用者不需開發工具」這項主張的實地佐證。

#### 附帶取得：D-3 使用者可見效果的首次驗證

本次是**全新使用者設定檔上的全新安裝**，來源清單為：

```
demo-fixture    enabled=True   healthy=True
example-jsonld  enabled=False  healthy=True
```

即 `sources.example.json` 的內容，**不含建置者的三個真實商店，也不含任何 browser connector**。
先前各輪皆在既有使用者資料的機器上進行，來源一直是自移機檔還原的個人設定，因此
D-3 的終端使用者效果直到此刻才真正被證實。**A-9 新標準的前半（離線 fixture 可運作）亦於此通過。**

#### 判讀注意

首次安裝後服務就緒需時較久（VM 走 Hyper-V 後端），過早蒐證會得到「`/health` 連不上、
資料庫未就緒、log 為空」的輸出，與「安裝失敗」完全無法區分。本輪即發生一次。
蒐證腳本應等待至少 180 秒再判定。

### 下次開始前（2026-08-17 更新）

**階段 1、4、5 已完成**（A-4b、A-6b、A-9 全數 PASS）。**下次從階段 2 開始。**

接續步驟：

1. **還原 `S0-no-chrome`**（階段 2 的第一步）。目前狀態已裝好 App 並含測試資料，
   還原會全部捨棄 —— 這是預期的，所有證據都已寫在主機端的共用資料夾，不受影響。
2. 登入 `AcceptanceUser` → **安裝 Google Chrome** → 拍快照 **`S1-with-chrome`**
3. 依 [ROUND4 runbook](WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md) 步驟 1～9 跑 A 段主流程（階段 3）

> **2026-08-28 更新**：產物已換第八版，另有六項修正需在主流程中一併確認。
> **逐步操作見本檔最末的「第八版：階段 2 ＋ 階段 3 詳細步驟」。**

> **磁碟提醒**：2026-08-17 收工時差異磁碟已達 32.7 GB（VM 合計 54 GB），主機 C: 僅餘 22.9 GB。
> **還原 S0 會丟棄該差異碟，可立即回收約 32 GB** —— 這也正是階段 2 的第一個動作，
> 因此接續前先還原，空間問題與流程需求可一併解決。拍 S1 之後仍會再長，期間勿往 C: 存放大檔。

已產出的證據（主機端 `C:\Users\Public\BeybladeTracker-VM-Round\`）：
`a4b-result.txt`、`a4b-installcheck.txt`、`a6-dialog-result.txt`、`discovery-diag.txt`。

---

# 第一部分：主機準備

## 1.1 先知道這件事

開發機（Windows 11 Home 26100、15.8 GB RAM、8 邏輯核心、C: 約 80 GB 可用）目前
**VBS 與「記憶體完整性」正在執行**，`HypervisorPresent = True`。

VirtualBox 仍可運作，但會退回 Hyper-V 後端，效能明顯變差（nested paging 失效）。

**建議：先不要動它，直接裝來跑。** 這一輪大部分時間在等安裝、點精靈，慢一點可以接受。
關閉「記憶體完整性」會降低日常工作機的防護，為一次性測試不太值得。真的慢到不能用再考慮
（設定 → 隱私權與安全性 → Windows 安全性 → 裝置安全性 → 核心隔離）—— **那是系統安全設定，請自行決定與操作**。

> 別被 `VirtualizationFirmwareEnabled = False` 誤導。那**不代表** BIOS 沒開 VT-x，
> 而是 Hyper-V 接管後 Windows 看不到原始狀態。虛擬化是正常的。

## 1.2 安裝 VirtualBox

```bash
winget install Oracle.VirtualBox
```

會跳 UAC，按「是」。安裝過程網路會短暫斷線（安裝虛擬網路卡），正常。裝完建議重開機一次。

> **替代方案**：VMware Workstation Pro 對 Hyper-V 並存的處理較好，個人使用有免費授權
> （請自行確認目前條款）。若 VirtualBox 慢到受不了，這是不用關閉 VBS 的另一條路。

## 1.3 取得 Windows 11 ISO

**建議用 Windows 11 Enterprise 90 天評估版**（Microsoft Evaluation Center）。兩個理由：

- 授權上明確就是給評估用途
- **OOBE 不強迫登入 Microsoft 帳號** —— 一般版會強迫，而你不會想在測試 VM 裡登入真實帳號

一般版 ISO（微軟官方下載頁）也可以，未啟用只是有浮水印、個人化鎖住，對驗收無影響。

---

# 第二部分：建立 VM

## 2.1 新增 VM

VirtualBox → 新增：

| 設定 | 值 | 理由 |
| --- | --- | --- |
| 名稱 | `Beyblade-Acceptance` | — |
| 類型／版本 | Microsoft Windows / **Windows 11 (64-bit)** | — |
| **跳過自動安裝** | **勾選** | 自己控制 OOBE 才能建本機帳號 |
| 記憶體 | **6144 MB** | 主機留 10 GB |
| 處理器 | **4** 核心 | 8 個分一半 |
| **啟用 EFI** | **勾選** | Windows 11 必要 |
| 硬碟 | **64 GB** 動態配置 | Win11 最低要求 |

建立後 **設定 → 系統 → 主機板**：

- **TPM：v2.0**（Windows 11 必要，VirtualBox 7.0 起支援）
- **啟用安全開機**：勾選

**顯示 → 視訊記憶體：128 MB**。網路保持預設 **NAT**（A-9 需要對外網路）。

> ⚠ **磁碟空間**：C: 只剩約 80 GB。64 GB 動態硬碟裝完實際約佔 25～30 GB，
> 加上 S0／S1 兩個快照的差異磁碟，整輪可能到 40～50 GB。做得完，但期間別再往 C: 塞大檔。
> 驗收結束刪掉整個 VM 即可回收。

## 2.2 安裝 Windows

掛載 ISO 啟動，兩個卡點：

**「按任意鍵從光碟開機」** —— 出現時要真的按，否則跳過。

**OOBE 強迫登入 Microsoft 帳號**（一般版才有）：按 **Shift + F10** 開命令提示字元，輸入

```
start ms-cxh:localonly
```

即可建立本機帳號。此指令隨 Windows 版本會變（舊的 `oobe\bypassnro` 已被移除）；
**用 Enterprise 評估版就沒這問題**。

**裝完先不要裝 Chrome。**

## 2.3 Guest Additions 與共用資料夾

安裝器沒有公開發佈站（正是 B 段被卡住的原因），所以要用共用資料夾傳檔。

1. VM 選單 → **裝置 → 插入 Guest Additions CD 映像**
2. VM 內執行光碟機裡的 `VBoxWindowsAdditions.exe`，裝完重開
3. VM 設定 → **共用資料夾 → 新增**
   - 路徑：`C:\Users\Public\BeybladeTracker-Acceptance`
   - **自動掛載**：勾選
   - **唯讀**：**不要勾**（腳本要寫結果檔回來）
4. 把整個資料夾複製到 VM 內的 `C:\Users\Public\BeybladeTracker-Acceptance`

> Guest Additions 是測試載具而非開發工具，不影響「一般使用者不需開發工具」這個主張。
> 但它確實裝在 VM 裡，驗收紀錄會如實載明。

## 2.4 建立標準使用者帳號

A-1 的 acceptance criteria 明確要求**標準帳號**。Windows 安裝建的是系統管理員，需另外建：

設定 → 帳戶 → 其他使用者 → 新增帳戶 → 「我沒有這位人員的登入資訊」→
「新增沒有 Microsoft 帳戶的使用者」，**權限維持「標準使用者」**。

驗收全部在這個帳號裡做。

## 2.5 拍快照 S0 ⭐

在**尚未安裝 Chrome** 的狀態下：VM 選單 → 快照 → 拍攝快照，命名 **`S0-no-chrome`**。

**A-4b 只有在這個狀態測得到。** 裝了 Chrome 之後要回來，就只能還原快照。

---

# 第三部分：驗收（順序不可調換）

## 階段 1：A-4b 無 Chrome 分支（在 S0 上）

登入標準帳號，先驗雜湊：

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Public\BeybladeTracker-Acceptance\verify-installer.ps1
```

須 `MATCH`。然後：

| 步驟 | 要確認什麼 |
| --- | --- |
| 1 | 執行安裝器，在**「準備安裝」頁**應出現「找不到 Google Chrome」提示 |
| 2 | 選**「是」** → 應開啟 `https://www.google.com/chrome/`。確認後關閉瀏覽器 |
| 3 | **還原 S0**，重跑安裝器，這次選**「否」** → 應**仍可完成安裝** |
| 4 | 安裝後開管理頁，確認 `demo-fixture`（離線）正常掃描 |
| 5 | 加一個 JSON-LD 來源（`https://www.hlj.com/product/TKT09613`），確認**沒有 Chrome 也能抓** |
| 6 | 設定頁應顯示找不到 Chrome，並提供官方下載連結 |

第 5 步是重點：證明 HTTP-only 來源不受影響。

> 已由自動化鎖住、不需在此重驗的部分：預設來源沒有任何 browser connector、
> UI 新增的來源一律是 `jsonld`、偵測會探測全部三條路徑。詳見 checklist 第三之一節。

完成後**還原 S0**。

## 階段 2：安裝 Chrome，拍快照 S1

還原 S0 的乾淨狀態 → 安裝 Google Chrome → 拍快照 **`S1-with-chrome`**。

之後所有測試以 S1 為基準；任何一項搞砸都可以還原重來，不必重裝 Windows。

## 階段 3：A 段主流程

照 [ROUND4 runbook](WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md) 的**步驟 1～9** 跑。

> **範圍選擇**：第四版產物已在本機測試帳號完成 A 段 10 PASS，第六版只改了
> 「錯誤發生後顯示什麼」與「回報連結長什麼樣」，沒動安裝、啟動、解除安裝路徑。
>
> - **最小範圍**：只做階段 1、4、5，約 30 分鐘
> - **完整範圍**：連 A 段主流程一起跑，約 75 分鐘。好處是這才真正滿足
>   RUNBOOK 第 13 節的 clean VM gate —— 路線 1 從來沒滿足過
>
> 既然 VM 已經架好，建議做完整範圍。

## 階段 4：A-6b 問題回報按鈕

跑 `a6-dialog.ps1`，除了原本四題與剪貼簿檢查，**多點一次「問題回報」按鈕**，確認：

- 開啟的是 `.../issues/new?template=bug_report.yml&...`（**不是** `/issues/new/choose`）
- 表單的**「錯誤代碼」欄已填入** `BT-LCH-001`
- 「App 版本」欄顯示 `unknown`（此情境讀不到 `current.json`，屬設計行為）
- **不要送出**，看完關掉

### 階段 5（A-9）結果：**PASS**，2026-08-17

以主機端 `VBoxManage controlvm … setlinkstate1 off` 拔除虛擬網路線，再按「立即重新檢查」。

| 檢查 | 結果 |
| --- | --- |
| 掃描確實失敗並分類 | **PASS** — log：`source monitor hlj-com status:"failed" errorClass:"dns"`、`getaddrinfo ENOTFOUND www.hlj.com`，連續失敗累計為 2 |
| 離線 fixture 不受影響 | **PASS** — 同時段 `demo-fixture` 仍 success |
| UI 顯示可行動的繁中 | **PASS** — 「找不到這個網域。請確認網址拼寫，以及網域是否仍然存在。」 |
| 未直接曝露英文原文 | **PASS** — 原文收在「技術細節」可展開處 |
| 切換語言 | **PASS** — English 顯示 "That domain could not be found. Check the spelling and whether the domain still exists."，`Monitor failures: 2` 同步 |

| 接回網路後可自行復原 | **PASS** — 連續失敗 2→0、`lastSuccessAt` 更新為 15:40:19Z、`lastError` 清除；`lastFailureAt` 保留為 14:57:01Z |

復原行為正確：成功後清除當前錯誤與失敗計數，但保留曾經失敗的時間戳，
使「此來源過去出過問題」的事實不致被抹除。

> **判讀注意**：失敗後**必須重新整理頁面**才看得到。首次觀察時頁面仍是失敗前渲染的舊畫面
> （`下次監控` 仍為舊值、連續失敗顯示 0），一度被誤判為「沒有顯示錯誤」。

#### 附帶發現一：離線時的建議語會誤導

拔網路線造成的是 `getaddrinfo ENOTFOUND`，被分類為 `dns`，因此顯示「請確認網址拼寫，以及網域是否仍然存在」。
但該來源**先前已成功抓取過**（`lastSuccessAt` 有值），網域顯然存在 —— 真正的原因是本機沒有網路。
對筆電斷線這種最常見的情境，這句話會把使用者導向錯誤的方向（去檢查網址拼寫）。

建議：分類為 `dns` 時，若該來源曾經成功過、或本機無任何網路連線，改用連線相關的建議語。

#### 附帶發現二：操作回饋顯示在看不到的地方

`ui.js:153`／`154` 的「立即重新檢查」與「探索商品」**都有寫入回饋**，但目標是整頁共用的
單一狀態列 `#source-action-status`（位於頁面上方）。使用者在下方的來源卡片按下按鈕時，
回饋出現在捲動範圍之外，因此看起來像「按了沒反應」——本輪即因此連按兩次而觸發 D-8。

建議：回饋顯示在被操作的那張卡片內，或按下後將狀態列捲入視野。

---

## 階段 5：A-9 失敗來源錯誤呈現

> **不能用 D-2 那個已下架的 shimamura URL。** 2026-08-11 實測：UI 新增來源會先做預覽，
> 該網址在預覽階段就以「網站重新導向超過 3 次。」被擋下，**根本加不進去**。
> 而且那句訊息來自 `src/net/public-http.js`（預覽路徑），本來就是中文的 —— 測不到本項要驗的東西。
>
> BT-UX-003 管的是**加進去之後、掃描時**的失敗，所以要讓一個已成功加入的來源在掃描時失敗。

做法：**先加一個正常來源，再斷網強制重新檢查。**

1. 用「貼上網址 → 預覽 → 確認加入」加入 `https://www.hlj.com/product/TKT09613`，確認掃描成功
2. **中斷 VM 的網路**（VirtualBox 選單 → 裝置 → 網路 → 取消「連接網路卡」；或在 Windows 內停用網路卡）
3. 到來源管理頁按該來源的**「立即重新檢查」**（有 60 秒冷卻）
4. 等掃描失敗後重新整理頁面

等一次掃描後到來源管理頁，確認：

- 顯示**可操作的繁中建議**：**「無法連線到商店。請確認網路連線，稍後會自動重試。」**
- **不是**英文原文（`TypeError: fetch failed`）
- 展開**「技術細節」看得到原始訊息** —— 原文保留是刻意的，回報時需要
- 把 UI 語言切成日文或英文，確認訊息**跟著換語言**

驗完把網路接回來，再按一次「立即重新檢查」，錯誤訊息應消失。

## 階段 6：回報

各腳本的 `*-result.txt` 都寫在共用資料夾，主機可直接讀。另外請回報只有你看得到的：

| # | 回報項目 |
| --- | --- |
| 1 | 階段 1 的六個步驟結果，特別是**提示有沒有出現**、**選「否」能否完成安裝** |
| 2 | 階段 4 開啟的 URL 形式與欄位是否已預填 |
| 3 | 階段 5 顯示的是建議還是英文原文；切語言是否跟著換 |
| 4 | 首次啟動耗時、登入自動啟動耗時（若做完整範圍） |
| 5 | 任何非預期的視窗、對話框或 `BT-*` 代碼 |

---

# 第四部分：收尾

全部完成後：

1. 刪除整個 VM（VirtualBox → 移除 → 連同檔案一併刪除），回收約 40～50 GB
2. 刪除測試帳號 `Test_Darren`
3. 刪除共用資料夾 `C:\Users\Public\BeybladeTracker-Acceptance`
4. 刪除 `C:\Users\yedon\BeybladeTracker-backup-20260802`

驗收腳本已納入版控（`scripts/acceptance/`），刪掉共用資料夾不會遺失任何東西。

---

# 如果最後決定不做這一輪

A-4b 停在「未測」，`BT-UX-001` 無法結案，A 段停在 10/11。

剩餘風險的完整評估見 [checklist 第三之一節](WINDOWS_ACCEPTANCE_CHECKLIST.md)。摘要：
能自動化涵蓋的已經補上（3 項測試），真正只剩 `installer.iss` 的三個 `FileExists`
加一個 `MsgBox` 沒被驗過。複雜度低，但 D-4 同樣是「對話框該跳時跳不出來」且通過了當時所有測試。

**若決定不做，發佈說明必須明寫「沒有 Chrome 的機器上，安裝精靈的提示未經實機驗證」**，不得默默省略。

---

# 第八版：階段 2 ＋ 階段 3 詳細步驟（2026-08-28）

> 階段 1、4、5 已於 08-17 完成（A-4b、A-6b、A-9 全數 PASS）。本節是**剩下的部分**。
> 產物已換成第八版，帶著六項尚未在產物上看過的修正，本節把它們併進主流程一起驗。

## 產物與環境

| | |
| --- | --- |
| SHA-256 | `58ac1ee8b84f0c669a6eb386aa4bb462dd47eb41f3a67d66a6138bc87eb5be8d` |
| 大小 | 27,509,937 bytes |
| 主機共用資料夾 | `C:\Users\Public\BeybladeTracker-VM-Round`（**VM 掛載的是這個**，不是 `BeybladeTracker-Acceptance`） |
| VM 內磁碟機 | `Z:` |
| 驗收帳號 | `AcceptanceUser`（登入時要輸入 **`.\AcceptanceUser`**，因為本 VM 是 Entra ID 加入的裝置） |

### 三個每次都會踩到的地方

1. **共用資料夾是網路磁碟機，`.ps1` 會被執行原則擋下。** 一律用
   `powershell -NoProfile -ExecutionPolicy Bypass -File Z:\<script>.ps1`
2. **服務就緒很慢**（VM 走 Hyper-V 後端）。蒐證前至少等 **180 秒**，否則會得到
   「`/health` 連不上、資料庫未就緒、log 為空」——那跟「安裝失敗」長得一模一樣。
3. **失敗訊息要重新整理頁面才看得到。** 頁面不會自己更新，08-17 就因此誤判過一次。

---

## 階段 2：還原 S0 → 裝 Chrome → 拍 S1

### 2.1 還原 `S0-no-chrome`

VirtualBox → 快照 → 選 `S0-no-chrome` → 還原。

> 目前 VM 裡裝著 App 和測試資料，**還原會全部捨棄 —— 這是預期的**。
> 所有證據都已寫在主機端的共用資料夾，不受影響。
>
> **順帶回收磁碟**：08-17 收工時差異磁碟已 32.7 GB，主機 C: 只剩 22.9 GB。
> 還原 S0 會丟棄該差異碟，**立即回收約 32 GB**。

### 2.2 安裝 Chrome

登入 `.\AcceptanceUser`，用 Edge 到 `https://www.google.com/chrome/` 下載安裝。
這一步就是把 VM 從「A-4b 的無 Chrome 狀態」變成「一般使用者的正常狀態」。

### 2.3 拍快照 `S1-with-chrome`

**這步不要跳過。** 之後任何一項搞砸都能還原重來，不必重裝 Windows。

---

## 階段 3：A 段主流程 ＋ 六項複驗

照 [ROUND4 runbook](WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md) **步驟 1～9** 跑，
並在下列時機順便確認六件事。**六件都只有自動化測試，從未在產物上看過。**

### 3.1 安裝（runbook 步驟 1～3）

```
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\verify-installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\install-with-log.ps1
```

`verify-installer` 須 `MATCH`（預期雜湊會顯示「來自 SHA256.txt」，那是正常的）。
`install-with-log` 的**離開代碼必須是 0**。

裝完**等三分鐘**再繼續。然後：

```
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\r2-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\r2-startup-timing.ps1
```

Chrome 已裝，所以這次 `/health` 應顯示 `browser available=True name=Google Chrome`
（A-4b 那輪是 `False`）。

### 3.2 導覽（runbook 步驟 4）

開管理頁 → 導覽跳出 → 填完儲存 → **關掉重開，導覽不該再出現**。

### 3.3 ⭐ 檢查 ①：D-9 排版

管理頁右上角語言切成 **English**，看來源管理頁的卡片。

- **應該**：左側文字欄佔約一半以上，時間戳不折行
- **不該**：左欄被壓到約三分之一、`Next monitor` 折成兩行、錯誤訊息折成四行

主機端量到的是 37% → 57%。用眼睛看得出來差別就對了。看完切回繁中。

### 3.4 加來源（runbook 步驟 5）

用「貼上網址 → 預覽 → 確認加入」加：

```
https://www.hlj.com/product/TKT09613
```

確認掃描成功。

### 3.5 ⭐ 檢查 ②：卡片內回饋

在 `Hlj` 那張卡片按「**立即重新檢查**」。

- **應該**：訊息出現在**那張卡片自己的區域**（按鈕下方）
- **不該**：只出現在頁面最上方（那是舊行為，也正是讓人以為沒反應而連按的原因）

### 3.6 ⭐ 檢查 ③：冷卻不再誤報

**立刻再按一次**「立即重新檢查」（60 秒冷卻內）。

- **應該**：`BT-SRC-003`，標題「**仍在冷卻中**」，訊息「這個來源剛剛才手動檢查過。」
- **不該**：`BT-LCH-999`「發生未預期的錯誤」

### 3.7 ⭐ 檢查 ④：探索守門

在任一有「探索商品」按鈕的卡片按下去，**立刻再按一次**。

- **應該**：`BT-SRC-005`，標題「**探索已在執行中**」，訊息「這間商店已有一個探索工作正在進行。」
- **不該**：`BT-LCH-999`

> 探索本身要跑數分鐘，不必等它跑完，看到第二次的回應就夠了。

### 3.8 ⭐ 檢查 ⑤：dns 建議語

1. 主機端拔虛擬網路線：
   `VBoxManage controlvm "Beyblade-Acceptance" setlinkstate1 off`
   （或 VM 選單 → 裝置 → 網路 → 取消「連接網路卡」）
2. 等冷卻過後按「立即重新檢查」
3. **重新整理頁面**

- **應該**：「找不到這個網域，**但這個來源先前抓取成功過**，所以網域應該仍然存在。
  通常代表這台電腦目前沒有網路連線。請確認網路後再試。」
- **不該**：「找不到這個網域。請確認網址拼寫，以及網域是否仍然存在。」
  ← 這是舊的誤導版本，08-17 就是看到這句

展開「技術細節」應看得到 `getaddrinfo ENOTFOUND www.hlj.com`。

驗完把網路線接回（`setlinkstate1 on`）。

### 3.9 ⭐ 檢查 ⑥：Recipe 三語

語言切 **English**，看有 Recipe 錯誤的那張卡片。

- **應該**：`Discovery Recipe：Discovery ran but recognised no candidate products…`
- **不該**：`Recipe：本次探索沒有辨識到候選商品…`（中文出現在英文頁）

> 若卡片上沒有 Recipe 錯誤，可在 3.7 讓探索跑完（沒有候選商品時就會出現）。

### 3.10 其餘主流程（runbook 步驟 6～9）

捷徑（`a2-shortcuts.ps1`）→ 錯誤對話框（`a6-dialog.ps1`）→ 登出登入（`a3-logon.ps1`）
→ A-10 保留資料解除安裝 → 重裝 → A-11 刪除資料解除安裝。

> `a6-dialog.ps1` 的視窗偵測已放寬到 40 秒（VM 較慢），不會再誤報「沒有偵測到視窗」。

---

## 回報

腳本的 `*-result.txt` 都寫在 `Z:`（即主機的 `BeybladeTracker-VM-Round`），我可以直接讀。
請另外告訴我只有你看得到的：

| # | 回報 |
| --- | --- |
| 1 | 六項檢查各自的結果（尤其是**看到的實際文字**） |
| 2 | 首次啟動耗時、登入→就緒耗時 |
| 3 | 導覽儲存後是否不再跳出 |
| 4 | `/health` 的 `browser available` 是否為 True |
| 5 | 任何非預期的視窗、對話框或 `BT-*` 代碼 |

完成後 `BT-UX-002`／`BT-UX-003` 可結案，**RUNBOOK 第 13 節的 clean VM gate 也才真正滿足** ——
那是路線 1 從頭到尾沒達成過的。

---

## 階段 3 結果（2026-08-29）

安裝與六項檢查中的五項已完成。**A 段主流程步驟 4～9 尚未執行**，見文末「尚未完成」。

### 安裝與啟動

| 檢查 | 結果 | 證據 |
| --- | --- | --- |
| 安裝 | **PASS** | `Installation process succeeded.` 17:00:55；帳號 `AcceptanceUser`（標準使用者） |
| **首次啟動耗時** | **PASS** | 安裝完成 17:00:56 → 服務 `startedAt` 17:01:29，**33.7 秒**，在 60 秒預算內，**未出現任何對話框** |
| D-3 三項 | **PASS** | 個人 `sources.json` 已排除／`sources.example.json` 在／fixtures 已打包，皆為 True |
| `/health` | **PASS** | `ok`，來源僅 `demo-fixture`（啟用）與 `example-jsonld`（停用） |
| 資料庫 | **PASS** | `integrity ok`、`schemaVersion 13` |

> `sources.example.json` 顯示 1117 bytes（先前紀錄為 1080）。已查核：**內容未變**，
> 37 行剛好對應 LF→CRLF 的 37 bytes 差異，屬換行符轉換，非內容變動。

### 六項修正的實機複驗

| # | 項目 | 結果 | 實際看到的文字 |
| --- | --- | --- | --- |
| ① | **D-9 排版** | **PASS** | English 介面下文字欄回到約三分之二寬，按鈕在自己的欄位內換行；日文同樣正常 |
| ② | **卡片內回饋** | **PASS** | 「這間商店已有一個探索工作正在進行。」以紅字出現在 **Hlj 那張卡片內**，非頁面頂端狀態列 |
| ③ | **冷卻不再誤報** | **PASS** | `BT-SRC-003`「**仍在冷卻中**」／「這個來源剛剛才手動檢查過。」＋兩條復原指引。**不是** `BT-LCH-999` |
| ④ | **探索守門** | **PASS** | `BT-SRC-005`「**探索已在執行中**」／「這間商店已有一個探索工作正在進行。」。**不是** `BT-LCH-999` |
| ⑤ | **dns 建議語** | **PASS（三語）** | 繁中「找不到這個網域，**但這個來源先前抓取成功過**…通常代表這台電腦目前沒有網路連線。」／English "…but this source has fetched successfully before…the machine has no network connection right now."／日本語「…この取得元は以前に取得成功しているため…」。三語皆展開「技術細節」可見 `getaddrinfo ENOTFOUND www.hlj.com` |
| ⑥ | **Recipe 三語** | **未觀察到** | 見下 |

**③④ 是 D-8 的兩條路徑，②是它們的觸發源。** 三者同時通過，代表 D-8 在使用者實際會走的兩條路徑上都已解除，
而且造成連按的原因也一併移除。

#### ⑥ 為什麼沒看到

Hlj 的探索**成功找到 7 個候選商品**（卡片顯示「7 個待審核」），因此 `updateRecipe(db, siteId, true)`
清除了 recipe 錯誤 —— **卡片上根本沒有 Recipe 訊息可看**。這不是修正失效，是條件不成立。

該路徑目前由自動化涵蓋（`test/web.test.js` 的三語 Recipe 測試，反向確認過）。
若要實機補驗，需要一個**探索後找不到任何候選商品**的來源。

### 尚未完成

`Z:` 於 2026-08-29 只產出 `install-testdarren.log`、`r2-install-result.txt`、`r2-timing-result.txt` 三個檔。
以下腳本未產生新結果檔，因此**不列為已驗**：

| 缺 | 對應 |
| --- | --- |
| `a2-result.txt` | 步驟 6 五個開始功能表捷徑 |
| 新的 `a6-dialog-result.txt` | 步驟 7 錯誤對話框（現存為 08-17 的） |
| `a3-result.txt` | 步驟 8 登入自動啟動 |
| `a10-result.txt`／`a11-result.txt` | 步驟 9 兩個解除安裝分支 |

另外 runbook 步驟 4（首次啟動導覽，儲存後不應再跳出）亦無紀錄。

**這些在路線 1 都已於 2026-08-11 通過**（真實標準帳號、真實登出登入、真實解除安裝），
且第 5～8 版**未動到安裝器、launcher 或服務生命週期**，因此結論不受影響。

**不建議現在單獨補跑。** RUNBOOK 第 13 節的 clean VM gate 除了 install／first run／startup／
uninstall／data retention，還同時要求 **update、migration、rollback、transfer、SmartScreen** ——
那五項全部卡在 B 段（憑證、HTTPS 發佈站、1.0.1 版本）。**補跑步驟 4～9 不會讓該 gate 關閉。**

正確做法是等 B 段解鎖後做**一次完整的 clean VM final acceptance**，屆時把它們一併涵蓋。
本輪真正非 VM 不可的項目是 A-4b，已於 2026-08-17 完成。
