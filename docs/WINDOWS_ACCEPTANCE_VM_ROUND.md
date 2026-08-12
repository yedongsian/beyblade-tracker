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
| SHA-256 | `a5b67183ba1d981e697ed0ea4876787e7d597a693c50df43df7ac68a9da18f3c` |
| 大小 | 27,505,644 bytes（第五次建置） |
| 位置 | `C:\Users\Public\BeybladeTracker-Acceptance\` |

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

> **範圍選擇**：第四版產物已在本機測試帳號完成 A 段 10 PASS，第五版只改了
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

## 階段 5：A-9 失敗來源錯誤呈現

加入這個已下架的商品頁（D-2 的那一個，必定失敗）：

```
https://www.shop-shimamura.com/item/0363100014177/
```

等一次掃描後到來源管理頁，確認：

- 顯示**可操作的繁中建議**（例如「這個商品頁已不存在，可能已下架。請確認網址，或停用此來源。」）
- **不是**英文原文（`HTTP 404`、`page.waitForSelector: Timeout ...`）
- 展開**「技術細節」看得到原始訊息** —— 原文保留是刻意的，回報時需要
- 把 UI 語言切成日文或英文，確認訊息**跟著換語言**

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
