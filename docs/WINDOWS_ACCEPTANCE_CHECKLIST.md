# Windows 實機驗收清單（RC 1.0.0）

對象產物：`BeybladeTracker-1.0.0-Setup.exe`
SHA-256：**`58ac1ee8b84f0c669a6eb386aa4bb462dd47eb41f3a67d66a6138bc87eb5be8d`**（27,509,937 bytes，2026-08-28 第八次建置）
建立日期：2026-08-02（第一輪）／2026-08-06（第二、三輪）／2026-08-07（第四輪）／2026-08-11（第五、六輪）／2026-08-28（第七、八輪）

### 產物沿革

| 輪次 | SHA-256 | 內容 | 狀態 |
| --- | --- | --- | --- |
| 第一輪 | `7794f66f…` | 來源 commit `2eca4c9`，無修正 | 作廢。於此產物找出 D-1～D-6 |
| 第二輪 | `cf2187c6…` | 含 D-3／D-4／D-5／D-6 修正 | 作廢。四項修正皆已實機驗證；於此產物再找出 **D-7** |
| 第三輪 | `c8959c9b…` | 再加入 **D-7** 的逾時常數修正 | 作廢。D-7 已於此產物實機驗證，但殘留風險未解 |
| 第四輪 | `0d4a0c73…` | 改為 **D-7 的根本解法**（逾時不再等同啟動失敗） | **A 段 10 PASS / 0 FAIL / 1 未測即在此產物完成**，見 2.2 節 |
| 第五輪 | `a5b67183…` | 加入 `BT-UX-002` 的問題回報預填修正與 `BT-UX-003` 的來源錯誤三語化 | 作廢。未經實機驗收即被第六輪取代 |
| 第六輪 | `acb01dc5…` | 再加入 `BT-UX-003` 漏掉的兩個分類（`fetch failed`、`too_large`） | 作廢。實機驗收於此產物找出兩個新缺陷，見下 |
| 第七輪 | `2e11a4bd…` | 修正冷卻誤報 `BT-LCH-999`（`BT-API-001` 首片）與 Recipe 行未翻譯 | 作廢。未經實機驗收即被第八輪取代 |
| **第八輪** | **`58ac1ee8…`** | 再加入 **D-9 排版**、**D-8 其餘四道守門**、**卡片內回饋**、**dns 曾成功過的建議語** | **現行驗收對象** |

> 第四輪的 A 段結論在機制上不受第五、六輪影響 —— 兩者只改變「錯誤發生後顯示什麼」與「回報連結長什麼樣」，不動安裝、啟動或解除安裝路徑。因此不需重跑整個 A 段，只需補驗待辦 0a／0b 兩項與 A-4b。

> **為什麼第五輪作廢**：撰寫 0b 的實機步驟時發現，斷網產生的 `fetch failed` 當時仍落在泛用訊息，驗收者會誤以為 `BT-UX-003` 沒生效。與其交出一份已知會失敗的步驟，先修分類再重建。第五版未曾用於實機驗收。

> **第八版的建置端驗證**：來源 `main` @ `f76eb36`；單元測試 **256/256**；release E2E 四項全綠（normal／stopfail／missing-launcher／launcher-errors **6-6**）；8787 淨空、無 temp 殘留。**兩個共用資料夾**（`BeybladeTracker-Acceptance` 與 VM 用的 `BeybladeTracker-VM-Round`）皆已同步並各驗一次 `MATCH`。

> **共用資料夾已同步**：`C:\Users\Public\BeybladeTracker-Acceptance\` 的 Setup.exe、`SHA256.txt`、`verify-installer.ps1` 與全部驗收腳本皆已更新為第六版，並實際執行過 `verify-installer.ps1` 得到 `MATCH`。腳本以版控中的 `scripts/acceptance/` 為準重新同步。

## 驗收現況與待辦（最後更新 2026-08-11）

> **A 段已於第四版產物全數完成，只剩 A-4b。** 2026-08-11 在 Test_Darren 走完一輪完整驗收：安裝 → 導覽 → A-9 新標準 → 捷徑 → 互動對話框 → 登出登入 → 兩次解除安裝。11 項中 10 項 PASS，A-4b 仍需乾淨 VM。詳見第 2.3 節。

### 一、缺陷：7 項發現，5 項真缺陷，**全部已修並實機驗證**

| 缺陷 | 狀態 | 修正 | 實機證據 |
| --- | --- | --- | --- |
| D-1 | **非缺陷** | 爬蟲的螢幕外 Chrome，屬既有設計 | 由 `browser.js` 的 `--window-position=-32000,-32000` 與 A-2 排除 launcher 涉入 |
| D-2 | **隨 D-3 消失** | 失效的 shimamura URL 不再隨產物出貨 | 四組對照實測確認為商品下架，非程式缺陷 |
| **D-3** | ✅ 已修並驗證 | build 排除 `config/sources.json`、改帶 `fixtures/`、加入三道 build 斷言 | 安裝後 payload 的 `config\` 僅含 `sources.example.json`；`fixtures\beyblade-x.json` 已打包 |
| **D-4** | ✅ 已修並驗證 | `Show-LauncherError` 於 `Shown` 事件強制 `ShowWindow`／`TopMost` | 經真實隱藏 launcher 路徑，`BT-LCH-003` 對話框正常顯示，含代碼、繁中指引、App version、Support reference 與四個按鈕 |
| **D-5** | ✅ 已修並驗證 | `ui.js:126` 兩處 `'\n'` → `'\\n'` | 部署後逐頁 `node --check`，**12 頁全數通過**（第一輪 `/settings` 為唯一失敗） |
| **D-6** | ✅ 已修並驗證 | `restoreBackup` 新增 `ignorePid`；匯入失敗時將 pending 檔移置一旁 | pending 檔被消耗；`tracker-before-restore-20260805-232207Z.db`（532,480 bytes）存在；observations 2 → **495**（基準 494 ＋ 重啟後一次掃描） |
| **D-7** | ✅ 已修並驗證，**根因已解** | 第三輪：逾時鏈 `START_TIMEOUT_MS` 15s→60s、launcher start 90s／restart 130s、管理頁 30s。<br>第四輪：**逾時不再等同啟動失敗**，改由服務自身證據判定 | 第三版產物安裝後 **55.5 秒**就緒且**未出現任何對話框**；第四版的判定改動有 6 項單元回歸測試 |

**修正端驗證（2026-08-07，第四版）**：單元測試 **230/230**；release E2E 四項全綠（normal／stopfail／missing-launcher／launcher-errors **6-6**）；無 temp 殘留、無殘留行程、8787 淨空。

新增的回歸涵蓋：

| 缺陷 | 新增涵蓋 | 反向確認 |
| --- | --- | --- |
| D-7 | `test/service-lifecycle.test.js` 6 項，涵蓋慢啟動判定為 `still-starting`、health 佐證、行程已死不得被 health 救回、狀態檔屬於他人不得佐證、health 探測拋錯不得改變判定 | 移除 `confirmStartOutcome` 呼叫後 **3 項失敗** |
| D-4 | `scripts/phase7-launcher-errors.ps1` **案例 F**：以 `wscript.exe launcher.vbs start`（真實捷徑路徑）觸發 `BT-LCH-001`，用 `EnumWindows` 列舉頂層視窗並斷言 `IsWindowVisible=True`、代碼與三個按鈕存在、內容不含路徑／URL，最後 `WM_CLOSE` 後行程必須結束 | 移除 `Show-LauncherError` 的 `Add_Shown`／`ShowWindow` 後，案例 F 失敗並回報 **`visible=False buttons=5`** —— 正是 D-4 的特徵：控制項全部建好，就是看不見 |

> **兩個負向 E2E 仍通過**是關鍵回歸把關：`Assert-E2eNoLauncherDialog` 確認 D-4 的對話框修正未讓靜默模式（安裝器、解除安裝器、自動化）跳出任何視窗。案例 F 是它的正向對照 —— 一個確認「該跳窗時跳得出來」，一個確認「不該跳窗時不跳」。

> **順帶修掉一個到期的時間炸彈測試**：`test/web.test.js` 的運維指標測試把 `operation_events.created_at` 寫死為 `2026-07-30`，而該指標只統計 7 天內的事件，因此該測試自 **2026-08-06 起必然失敗**（與本輪改動無關）。已改為以現在時刻寫入。同檔其他寫死日期的測試都注入了假時鐘，不受影響。

### 二、A 段項目現況

「第四版」欄記錄 2026-08-11 於現行驗收對象上的複驗結果。

| 項目 | 狀態 | 第四版 | 備註 |
| --- | --- | --- | --- |
| A-1 安裝（預設路徑、per-user、內建 runtime） | ✅ PASS | ✅ | `Installation process succeeded.`；`current.json`、內建 node、5 捷徑、`Run` 機碼含 `noninteractive` 皆到位；**安裝完成未跳出任何對話框** |
| A-2 五個開始功能表捷徑 | ✅ PASS | ✅ | 五個全數可用；8787 於 **1.4 秒**停止監聽 |
| A-3 登入自動啟動 | ✅ PASS | ✅ | 登入 10:52:51 → 服務 10:53:25，**34.7 秒**；驗收者確認登入作業系統時**無任何視窗**；無殘留 launcher 行程 |
| A-4a Chrome 已安裝分支 | ✅ PASS | ✅ | `available=True name=Google Chrome` |
| A-4b **無 Chrome 分支** | ✅ **PASS** | — | **2026-08-17 於乾淨 VM 完成**，六項全通過：精靈提示出現且文案載明後果、選「是」導向官方下載頁、選「否」仍可完成安裝、`browser.available=False` 且提供下載連結、離線 fixture 正常、**在完全沒有 Chrome 的機器上以 JSON-LD 抓到真實商品**（HLJ）。該 VM 亦未安裝任何 Node.js，順帶佐證「不需開發工具」 |
| A-5 首次啟動導覽 | ✅ PASS | ✅ | 導覽跳出 → 填完儲存 → 關閉重開**不再出現**。這半段是第一輪缺的，至此補齊，`onboardingCompleted` 確實寫入 |
| A-6a 錯誤代碼（非互動，已自動化） | ✅ PASS | ✅ | 案例 A–E，`npm run test:release:launcher-errors` |
| A-6b 互動對話框 | ✅ **PASS** | ✅ | 對話框可見性已自動化（案例 F）；剪貼簿內容檢查 2026-08-11 通過；**2026-08-17 於乾淨 VM 完整複驗，含「問題回報」按鈕與表單預填**（`issues/new?template=…`，錯誤代碼與 App 版本欄皆已填入） |
| A-7 匯出側 | ✅ PASS | — | 內含恰好兩檔、SHA-256 相符、七項安全掃描未命中 |
| A-7 匯入側 | ✅ PASS | — | 第一輪 FAIL（D-6），修正後通過 |
| A-8 Telegram 與 DPAPI | ✅ PASS | — | 含**跨帳號解密失敗**驗證與對照組；`powershellDpapi()` 真實路徑首次獲得實證 |
| A-9 實際抓取 | ✅ **PASS** | ✅ | **依 D-3 後的新標準完成三小項**，見下。**2026-08-17 於乾淨 VM 另完成失敗路徑**：拔虛擬網路線 → `errorClass:"dns"` → UI 顯示可行動繁中、英文同步、接回網路後連續失敗 2→0 自行復原 |
| A-10 解除安裝（保留資料） | ✅ PASS | ✅ | 程式檔案／捷徑／`Run` 機碼／登錄項目全數移除；使用者資料保留且 `integrity_check=ok` |
| A-11 解除安裝（刪除資料） | ✅ PASS | ✅ | `DelTree` 分支再次執行成功，使用者資料整個目錄消失 |

**A-9 依新標準的三小項（2026-08-11）**

| 小項 | 結果 |
| --- | --- |
| (a) 全新安裝只有離線 demo-fixture | ✅ payload 中個人 `sources.json` 已排除、`sources.example.json` 與 `fixtures/` 均在；生效來源只有 `demo-fixture`（啟用）與 `example-jsonld`（停用）。**三個真實日本商店確實不再出貨 —— D-3 的使用者可見效果至此首次獲得驗證** |
| (b) fixture 可正常運作 | ✅ 首次掃描 3 items／2 events，2 則通知送出，`healthy=true` |
| (c) 使用者自行新增來源後可抓取 | ✅ 由管理頁加入 `https://www.hlj.com/product/TKT09613`，解析成功（5446 ms，1 item／1 event），`hlj-com` `healthy=true`。全庫成長為 sources 3／products 3／offers 4 |

**A-6b 剪貼簿內容（2026-08-11）**：複製內容恰為四行 —— `錯誤代碼：BT-LCH-001`、`App version：unknown`、`UTC：…`、`Support reference：67e6f957b2e0`。自動安全掃描（安裝路徑、使用者目錄、使用者名稱、`.ps1`／`.vbs`、stack 字樣、URL、token、webhook）**全部未命中**，且四個必要欄位齊全。`App version` 為 `unknown` 屬 `BT-LCH-001` 的設計行為（此情境讀不到 `current.json`）。

### 三、待辦（依建議順序，2026-08-28 重新盤點）

**A 段 11 項已全數 PASS。** 剩下的是 VM 輪未跑完的部分、該輪找出的缺陷、以及今天的修正尚未在產物上複驗。

| # | 待辦 | 需要什麼 | 備註 |
| --- | --- | --- | --- |
| ~~1~~ | ~~**D-9 非中文語系排版被擠壞**~~ | — | **2026-08-28 已修並量測**：文字欄由 37% 回到 57%，卡片高度少 53px。仍待實機於三語各看一次（可併入第 5 項） |
| ~~2~~ | ~~**附帶發現二：操作回饋在視野外**~~ | — | **2026-08-28 已修**：回饋改寫在被操作的那張卡片內（每張卡片各有 `aria-live` 區域），找不到才退回頁面頂端。這是 D-8 的觸發源，從源頭止血 |
| ~~3~~ | ~~**附帶發現一：dns 建議語會誤導**~~ | — | **2026-08-28 已修**：`dns` 且該來源**曾成功過**時改用另一句 —— 「網域應該仍然存在，通常代表這台電腦目前沒有網路連線」。三語齊備 |
| 4 | **第八版產物的實機複驗** | 部分完成 | **2026-08-29 於乾淨 VM 六項中五項 PASS**：D-9 排版、卡片內回饋、冷卻（`BT-SRC-003`）、探索守門（`BT-SRC-005`）、dns 建議語（三語）。首次啟動 **33.7 秒**、無對話框。<br>**⑥ Recipe 三語未觀察到** —— 該次探索成功找到 7 個候選商品，recipe 錯誤被清除，卡片上沒有訊息可看。條件不成立，非修正失效；該路徑有自動化涵蓋 |
| 5 | ~~VM 的 A 段主流程（步驟 4～9）~~ | **不單獨執行** | 步驟 4／6／7／8／9 已於 2026-08-11 在 Test_Darren（真實標準帳號、真實登出登入、真實解除安裝）通過，且第 5～8 版**未動到安裝器、launcher 或服務生命週期**，結論不受影響。<br>**RUNBOOK 第 13 節的 clean VM gate 也不會因為補跑它們而關閉** —— 該節同時要求 update／migration／rollback／transfer／SmartScreen，那些全部卡在 B 段。<br>**併入 B 段解鎖後的那一次 clean VM final acceptance 一起做。** |
| 6 | 收尾清理 | — | 兩個共用資料夾（`BeybladeTracker-Acceptance`、`BeybladeTracker-VM-Round`）、Test_Darren 帳號、VM、`BeybladeTracker-backup-20260802`。**第 5 項做完再動** |

> **磁碟提醒**（VM_ROUND.md 記載）：2026-08-17 收工時差異磁碟已達 32.7 GB，主機 C: 僅餘 22.9 GB。
> 還原 S0 會丟棄該差異碟，可立即回收約 32 GB —— 而還原 S0 正是階段 2 的第一個動作。

> 第 1～3 項都是 VM 輪找出來、尚未處理的東西。第 2、3 項在 VM_ROUND.md 裡被記為「附帶發現」而非缺陷編號，但它們都有明確的使用者影響，不應該因為沒有編號就消失。

### 三之一、A-4b 的剩餘風險評估（2026-08-11，**已由 08-17 的 VM 輪解除**）

> **本節已過時但保留。** A-4b 已於 2026-08-17 在乾淨 VM 完成，六項全數 PASS。
> 保留的理由是：當時為了縮小風險而補的三項自動化測試仍然有效，而且下方對「哪些能自動化、
> 哪些非實機不可」的判斷過程，日後遇到類似取捨時可以直接參考。

（以下為 2026-08-11 當時的評估原文）

A-4b 需要乾淨 VM，短期內不一定會做，所以先把「不做會怎樣」查清楚並記下來，而不是讓它掛在那裡當一個模糊的未知數。

**能自動化涵蓋的部分已經補上**（3 項測試，皆經反向確認）：

| 涵蓋 | 測試 |
| --- | --- |
| Windows 上四條路徑都不存在時，回報 `available=false` 且**仍提供下載連結**（提示要用它），並確認三條路徑**確實都被探測過** | `test/phase7.test.js` |
| 出貨的預設來源**沒有任何** `browser` connector 或 `channel: chrome` | `test/phase7.test.js` |
| 從 UI 新增的來源**一律是 `jsonld`**，不可能產生 browser 來源 | `test/source-manager.test.js` |

原本的負向涵蓋只有 `platform: 'linux'`，那只走到提前返回，完全沒有探測邏輯。

**因此剩餘風險的範圍是：**

沒有 Chrome 的使用者，在**預設路徑上根本碰不到瀏覽器** —— 預設來源是離線 fixture 與停用的範例，而 UI 新增的來源永遠是 `jsonld`。`browser` connector 只能靠手動編輯 `config/sources.json` 產生。這三件事現在都被測試鎖住了。

**真正只能靠 VM 驗的，只剩安裝精靈那個提示：**

```pascal
if (CurPageID = wpReady) and (not WizardSilent) and (not ChromeInstalled) then
  MsgBox('找不到 Google Chrome。…是否開啟官方 Chrome 下載頁？', mbConfirmation, MB_YESNO);
```

即 [installer.iss:65-79](../release/windows/installer.iss)：三個 `FileExists` 加一個 `MsgBox`。靜默模式**不該**跳提示這個負向已由 E2E 涵蓋；未涵蓋的是互動模式**該跳時跳不跳得出來**、以及「是」會不會開啟下載頁。

**評估**：複雜度低，但這正是 D-4 給的教訓所在 —— D-4 也是「對話框該跳時跳不出來」，而且同樣通過了當時所有測試。差別在於 D-4 的成因（`SW_HIDE` 繼承）是結構性的、自動化構不到；這裡是 Inno Setup 的原生 MsgBox，沒有同類機制。所以風險確實較低，但**不是零**。

**若最終決定不做 VM**：必須在發佈說明明確寫出「沒有 Chrome 的機器上，安裝精靈的提示未經實機驗證」，不得默默省略。

### 四、B 段：發佈（2026-08-29 依實際產品意圖重寫）

先前這一段寫著「需 HTTPS 發佈站」「需 Authenticode 憑證」，讓人以為必須**架網站**並**買憑證**。
與產品負責人確認後，實際意圖是：

> 使用者在自己的 Windows 電腦上跑，瀏覽器只是操作介面。**不打算架網站。**
> 需要的是：更新時使用者收得到通知，以及錯過通知後有地方可以自己啟動更新。

依此重寫。

#### 「HTTPS 發佈站」不等於架網站

程式只要求兩個網址是 HTTPS（[update.js:70,97](../src/release/update.js)）：manifest 與安裝器。
**GitHub Releases 即滿足此條件** —— 免費、HTTPS、無伺服器要維護，且 repo 已存在。
發佈時上傳兩個檔即可：`BeybladeTracker-<版本>-Setup.exe` 與 `release-manifest.json`
（build script 已會產生，設定 `RELEASE_BASE_URL` 指向 Release 資產網址即可）。使用者端以
`UPDATE_MANIFEST_URL` 指向該 manifest。

#### Authenticode 憑證：降為未來選配

沒有憑證的唯一差別是 **SmartScreen 會在首次執行下載的安裝器時顯示「Windows 已保護您的電腦」**，
使用者需點「更多資訊 → 仍要執行」。功能不受影響。

**完整性不依賴憑證** —— SHA-256 ＋ Ed25519 簽章鏈已實作並驗證（含負向與竄改控制），
那才是防止安裝到被竄改檔案的機制。憑證買的是 Windows 的信任 UI。

年費約 200～400 美元。**現階段不採購**；若日後使用者增加、SmartScreen 警告造成實際困擾再評估。
屆時更新與 rollback 鏈都已驗證過，導入成本只在簽章步驟。

#### 真正還缺的

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| **建立 1.0.1 作為更新目標** | 待做 | **硬性**。`validateUpdateManifest()` 需 `compareVersions(manifest.version, APP_VERSION) > 0`；manifest 與已安裝版本同為 1.0.0 時永遠只顯示「已是最新」。**更新鏈非有第二個版本不可測** |
| **GitHub Releases 發佈流程** | 待做 | 上傳兩個檔、確認資產網址、設定 `RELEASE_BASE_URL` 與 `UPDATE_MANIFEST_URL` |
| 線上更新／rollback／migration 實機驗收 | 受阻於上兩項 | 有了 1.0.1 與 Release 網址即可進行 |
| SmartScreen | **不做** | 見上；改為在發佈說明告知使用者會看到該警告與如何繼續 |
| 更新通知的可見性 | ✅ **已完成** | 見下 |

#### 更新通知的可見性（2026-08-29 已補）

原本每 24 小時的排程檢查發現新版時**只寫進 log**，畫面上只有設定頁看得到。
使用者若不主動開設定頁，永遠不會知道有更新 —— 那使「排程檢查」失去意義。

已改為：**所有頁面**在主要內容之上顯示橫幅，含版本號與前往設定的連結；已選擇延後者改用
較安靜的措辭並保留入口；沒有更新時不顯示。三語齊備，並有測試涵蓋四種情形。

#### Ed25519 簽章

管線已驗證可用（含負向與竄改控制），金鑰在 `C:\Users\yedon\.beyblade-release`；
詳見 [RELEASE_CANDIDATE_1.0.0.md](RELEASE_CANDIDATE_1.0.0.md) 第 8 節。**私鑰不得提交 Git。**

#### 對 RUNBOOK 第 13 節 clean VM gate 的影響

該節要求乾淨 VM 完成 install／first run／startup／**update／migration／rollback／transfer**／
uninstall／data retention／**SmartScreen**。其中 SmartScreen 既然決定不做，該 gate
**不會以原文形式被滿足**。建議發佈前將該節改寫為與本節一致的條件，並把「未簽章、使用者會看到
SmartScreen 警告」列為明示的已知限制，而非未完成項。

### 五、環境現況（供日後接續）

| 項目 | 狀態 |
| --- | --- |
| 測試帳號 | `Test_Darren`，**目前無任何安裝、無使用者資料**（2026-08-11 A-11 以「刪除資料」收尾）。帳號本身保留，A-4b 之外若需複驗可直接重裝 |
| 共用資料夾 | `C:\Users\Public\BeybladeTracker-Acceptance`，含**第六版**安裝器、`SHA256.txt`、`verify-installer.ps1`（雜湊皆已同步並實測 `MATCH`）、`ROUND4-RUNBOOK.md`、各項驗收腳本與歷輪結果檔。腳本以版控中的 `scripts/acceptance/` 為準 |
| 第一輪安裝 log | 已改名為 `install-testdarren-20260802.log` 保存，避免被後續輪次覆蓋 |
| A-11 安全備份 | `a11-safety-copy`（8 檔，2026-08-11）。A-11 判定不依賴它，可自行刪除 |
| 分支 | **已合併回 `main`**（[PR #2](https://github.com/yedongsian/beyblade-tracker/pull/2)，2026-08-11，merge commit `656e142`）。D-3～D-7 五個修正自此在 `main` 上，從 `main` 建置的產物不再帶著它們出貨。<br>分支名 `codex/bt-api-001` 沿用自 `BT-API-001`，但其上內容全部是驗收與缺陷修正，與該 ticket 無關 |
| 驗收腳本 | 已納入版控：`scripts/acceptance/`（21 支腳本＋README），以 `$PSScriptRoot` 定位，整個資料夾可複製到乾淨 VM 使用。收尾清理刪掉共用資料夾也不會遺失 |
| 8787 | 淨空、無殘留行程 |

### ⚠ D-3 改變了全新安裝的預設行為

修正後，全新安裝不再內建 yodobashi／shimamura／hlj 三個真實商店，而是落到 `config/sources.example.json`：僅啟用離線的 `demo-fixture`，`example-jsonld` 為停用。

因此 **A-9 的驗收方式必須改變**：不能再期待「安裝後自動抓取三個真實商店」，而應驗證
（1）離線 demo fixture 可正常運作，（2）使用者自行新增來源後可正常抓取。這才符合
`sources.example.json` 所述的設計意圖（「product pages **you add yourself**」）。

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
| **PASS**（2026-08-11，第四版） | 2026-08-02 首次觀察：驗收者確認安裝後管理頁確有出現此導覽（描述為「輸入連結跟說明」，即 Telegram 區塊），但**未確認是否按下儲存完成**，因此當時只判「部分」。<br><br>2026-08-11 於第四版產物補齊後半段：導覽如期跳出 → 填完並儲存 → **關閉分頁重開管理頁，導覽不再出現**。這證明 `onboardingCompleted` 確實寫入，也正是本項真正的驗證重點。 |

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
2026-08-07 於第四版產物重跑並加入案例 F（互動對話框可見性，見 A-6b）：**6 PASS / 0 FAIL / 0 SKIPPED**。

案例 D 需要 port 8787 淨空（`Wait-ForManagementPage` 硬編碼該位址，無法改 port）；腳本會偵測監聽者並標記 `SKIPPED` 而非誤判為通過。首次執行即因 Test_Darren 的服務占用而正確跳過，停止該服務後重跑始得 PASS。

#### A-6b 互動對話框路徑（已部分自動化）

原本自動化只涵蓋 `-NonInteractive`（僅寫 stderr、不開對話框），這正是 D-4 得以出貨的原因。**2026-08-07 起，同一支腳本新增案例 F 涵蓋互動路徑**：以 `wscript.exe launcher.vbs`（隱藏視窗、互動模式，即開始功能表捷徑的真實路徑）觸發錯誤，斷言對話框可見、含代碼與三個按鈕、畫面文字不含路徑與 URL，且關閉後行程確實結束。做法與反向確認見缺陷 **D-4** 的「互動路徑的自動化涵蓋」一節。

**仍須人工的部分**：`C:\Users\Public\BeybladeTracker-Acceptance\a6-dialog.ps1` 的**剪貼簿內容檢查**。案例 F 驗的是畫面上顯示的文字，而「複製錯誤資訊」寫進剪貼簿的是另一個字串（`launcher.ps1` 的 `$copyText`），兩者是不同路徑，前者通過不蘊含後者安全。

| 判定 | 證據／備註 |
| --- | --- |
| **A-6a：PASS**<br>**A-6b：PASS** | A-6a 見上表。<br><br>**對話框可見性**：2026-08-05 首次人工執行**失敗**（根因 D-4）—— 以 `wscript.exe launcher.vbs start` 觸發 `BT-LCH-001`，畫面上完全沒有出現任何對話框，驗收者三題皆答 N，剪貼簿維持哨兵值未被寫入。修正後於 2026-08-07 由案例 F 自動驗證通過：`visible=True closed=True code=BT-LCH-001`，且畫面文字未命中任何不安全字樣。RUNBOOK 第 13 節「每個 hidden Launcher 路徑都必須顯示 native dialog」**已達成並上鎖**。<br><br>**剪貼簿內容（2026-08-11 補齊）**：於第四版產物以 `a6-dialog.ps1` 人工執行。對話框可見（`PID 27636 visible=True`），驗收者四題全答 Y，代碼為 `BT-LCH-001`、繁中無亂碼、四個按鈕可點。按下「複製錯誤資訊」後，剪貼簿內容恰為四行：<br>`錯誤代碼：BT-LCH-001`／`App version：unknown`／`UTC：2026-08-11T02:50:25.8539921Z`／`Support reference：67e6f957b2e0`。<br>安全掃描（安裝路徑、使用者目錄、使用者名稱、`.ps1`／`.vbs`、`at line`、`CategoryInfo`、`Exception`、`StackTrace`、`http://`、`https://`、`token`、`webhook`）**全部未命中**，四個必要欄位齊全，判定 **PASS**。關閉對話框後行程正常結束，暫存目錄已清除。 |

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
| **匯出側：PASS**<br>**匯入側：FAIL** | **匯入側 2026-08-05 執行並失敗**，根因見缺陷 **D-6**：移機檔通過驗證並成功暫存至 `runtime\pending-import.beyblade-transfer`（123,745 bytes），但服務重新啟動時 `applyPendingTransfer` 被 `restoreBackup` 的執行中守門擋下（讀到服務自身 PID），導致服務結束、匯入從未套用。匯入前後資料庫 `observations` 均為 **2**，與移機檔基準 **494** 不符；`sources.json` 的三個來源來自安裝包預設（D-3），不足以證明還原成功。<br><br>匯出側證據如下。<br><br>2026-08-05 由「匯出／移機」捷徑匯出 `beyblade-transfer-20260805-104427.beyblade-transfer`（壓縮 123,745 bytes／解壓 1,171,557 bytes）。<br><br>`format=beyblade-transfer-v1`、`appVersion=1.0.0`、`schemaVersion=13`、`exclusions=["secrets","runtime","logs","debug-html"]`。內含檔案**恰好兩個**：`tracker.db`（876,544 bytes）與 `sources.json`（1,833 bytes），兩者 SHA-256 重算皆符；DB 檔頭為 `SQLite format 3`；`sources.json` 含 3 個來源。<br><br>安全性掃描七項（Telegram token 格式、`secrets.json`、webhook 字樣、Discord webhook URL、`tracker.pid`、`tracker.log`、debug HTML）**全部未命中**。<br><br>匯出前後 `tracker.db` 的 SHA-256 相同（`53405a0f…`），確認匯出為唯讀操作。<br><br>匯入側依路線 1 執行順序，留待 A-11 清空資料後進行，以驗證跨乾淨環境還原。 |

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
| **PASS**（第二輪，2026-08-06） | D-5 修正後於設定頁完成儲存並測試。<br><br>**憑證保護**：`config\secrets.json` 建立（836 bytes），`version=1`、`provider=windows-dpapi-current-user`；`telegram.token`（352 字元）與 `telegram.chatId`（308 字元）皆為 base64 密文。整份檔案掃描 Bot Token 格式**未命中**。<br>**設定頁**：HTML 未回傳任何 Token 明文，欄位為 `type="password"`，並顯示 DPAPI provider 字樣。<br>**通知送達**：驗收者確認 Telegram 實際收到測試訊息。<br><br>**跨帳號解密（關鍵）**：將密文複本交由同機的另一個 Windows 帳號（`yedon`）以相同 entropy 嘗試 `ProtectedData.Unprotect`，兩個值皆失敗並回報 `Key not valid for use in specified state`，證實 `CurrentUser` scope 生效。<br>對照組：同一份 entropy 於該帳號自行加解密可正常運作，排除「entropy 錯誤導致假陰性」。<br>驗證後密文複本已即時刪除，共用資料夾無任何憑證殘留。<br><br>**此為 `powershellDpapi()` 真實路徑的首次實證** —— `test/phase7.test.js:28` 注入假的 `protect`／`unprotect`，該路徑從未被自動化測試執行過，PRIVACY.md 對 DPAPI 的宣稱在此之前沒有任何實機依據。 |

<details>
<summary>第一輪結果（BLOCKED，保留作對照）</summary>

| 判定 | 證據／備註 |
| --- | --- |
| **BLOCKED** | 2026-08-05 嘗試執行，因 **D-5** 無法進行：設定頁 JavaScript 語法錯誤導致整頁事件處理器未掛載，按「安全儲存並測試」不會送出任何請求，`secrets.json` 未建立。<br><br>已排除的原因：DPAPI 本身正常（以安裝包內的 `SecretStore` 用假值實測，667 ms 寫入密文並正確回讀，`provider=windows-dpapi-current-user`）；`config` 目錄可寫；`network.enabled=true`。<br><br>**須待 D-5 修正後重測。** |

> **已知測試落差**：`test/phase7.test.js:28` 以注入的 `protect`／`unprotect` 假函式建立 `SecretStore`，因此**真實 Windows DPAPI 路徑從未被任何自動化測試執行過**。本項是唯一能驗證該路徑的機會，亦是 PRIVACY.md 對 DPAPI 宣稱的唯一實證來源。
>
> 本輪雖未能經由 UI 完成，但步驟 2 的直接實測已證明 `SecretStore` 的真實 DPAPI 加解密可用。仍待驗證者為：UI 儲存流程、設定頁不回傳明文、以及跨帳號解密應失敗。

</details>

### A-9 實際網路抓取

**操作**：啟用既有商店來源，執行一次掃描。

**預期結果**：三個實際來源皆能擷取並解析；失敗時於來源管理頁顯示可操作的繁中錯誤。

| 判定 | 證據／備註 |
| --- | --- |
| **PASS**（2026-08-11，第四版，依新標準） | **(a) 全新安裝只有離線 demo-fixture**：payload 的 `config\` 只有 `sources.example.json`（1080 bytes），個人 `sources.json` 已排除，`fixtures\beyblade-x.json` 已打包。生效來源恰為 `demo-fixture`（啟用）與 `example-jsonld`（停用）。<br><br>**(b) fixture 可正常運作**：首次啟動自動掃描 `demo-fixture: 3 items, 2 events`，2 則通知送出，`healthy=true`。<br><br>**(c) 使用者自行新增來源後可抓取**：由管理頁「貼上網址 → 預覽 → 加入」流程新增 `https://www.hlj.com/product/TKT09613`，解析成功（5446 ms，1 item／1 event），`hlj-com` `healthy=true`，全庫成長為 sources 3／products 3／offers 4。<br><br>**UI 端的繁中錯誤呈現仍未檢視** —— 本輪三個來源全數成功，沒有失敗案例可看。這是本項唯一未觸及的角落。<br><br>2026-08-11 後續：檢視程式後確認該呈現**原本就不成立**（抓取路徑的錯誤是英文，見 `BT-UX-003`），已實作三語可操作訊息，待下一版產物複驗（待辦 0b）。 |

<details>
<summary>第一輪結果（部分，保留作對照）</summary>

| 判定 | 證據／備註 |
| --- | --- |
| **部分** | 2026-08-02 首次啟動自動執行掃描：`sources 3, ok 2, failed 1, itemsSeen 2, eventsCreated 1`，通知 1 送出。`yodobashi-ux20`（895 ms）與 `hlj-ux20`（2026 ms）成功；**`shimamura-ux20` 失敗**：`page.waitForSelector: Timeout 45000ms exceeded`，等待 `.catalogue__infoTitle`，耗時 48379 ms。見缺陷 **D-2**。<br><br>此結果建立在 D-3 的錯誤行為之上（那三個來源本來就不該出貨），故不能作為第四版的判定依據。 |

</details>

### A-10 解除安裝 — 選「保留資料」

**操作**：由 Windows「已安裝的應用程式」解除安裝，資料提示選「**是**」。

**預期結果**：
- 解除安裝前背景服務已停止
- 程式檔案（`versions\`、`current.json`）移除，開始功能表捷徑移除，`Run` 機碼移除
- `%LOCALAPPDATA%\BeybladeTracker` 的商品、歷史、設定與備份**完整保留**

| 判定 | 證據／備註 |
| --- | --- |
| **PASS** | 2026-08-05 由「設定 → 應用程式 → 已安裝的應用程式」解除安裝，資料提示選「是」。<br><br>**已移除**：安裝目錄、`current.json`、5 個開始功能表捷徑、`Run` 機碼、`HKCU` 解除安裝登錄項目；8787 停止監聽，無殘留 Beyblade node 行程。<br><br>**已保留**：2 份自動備份、`config\sources.json`、`data\tracker.db`、`logs\tracker.log`、`runtime\tracker-status.json`。資料庫前後比對 `integrity_check=ok`、`schemaVersion=13`，筆數完全相同：products 1、offers 2、events 1、sources 3、**observations 514**。<br><br>`tracker.db` 由 929,792 增為 933,888 bytes 且 `-wal`／`-shm` 消失，屬服務關閉時的 WAL checkpoint，非資料變動；`runtime\tracker.pid` 一併清除，為正常關閉行為。 |

> 判定採「筆數 + `integrity_check`」而非位元組雜湊：服務停止必然觸發 WAL 併回主檔，雜湊比對會產生假性失敗。

### A-11 解除安裝 — 選「刪除資料」⚠️ 破壞性

**操作**：重新安裝後再次解除安裝，資料提示選「**否**」。

**預期結果**：`%LOCALAPPDATA%\BeybladeTracker` 整個目錄被移除（`DelTree`），程式檔案亦移除。

> **這是唯一從未被執行過的路徑。** E2E 使用 `/SUPPRESSMSGBOXES`，一律取得預設值 `IDYES`（保留），因此 `PreserveUserData = False` 的分支從未執行。此操作會永久刪除使用者資料，**必須**在快照後執行，測完立即還原快照。

| 判定 | 證據／備註 |
| --- | --- |
| **PASS** | 2026-08-05 重新安裝後，由「設定 → 應用程式」解除安裝並於資料提示選「否」。<br><br>刪除前使用者資料含 9 個檔案（2 份自動備份、`sources.json`、`tracker.db` 933,888 bytes 及 WAL／SHM、`tracker.log`、`tracker-status.json`、`tracker.pid`）。<br><br>刪除後：安裝目錄、開始功能表捷徑、`Run` 機碼、解除安裝登錄項目**全部移除**，`%LOCALAPPDATA%\BeybladeTracker` **整個目錄消失**，8787 停止監聽。<br><br>**`installer.iss` 的 `DelTree` 分支至此首次獲得實測驗證。** 執行前已將使用者資料完整備份至 `a11-safety-copy`（9 個檔案）以防意外，驗收判定不依賴該備份。 |

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

## 2.2 第四輪驗收紀錄（2026-08-11，Test_Darren）

執行步驟見 [WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md](WINDOWS_ACCEPTANCE_ROUND4_RUNBOOK.md)（A-4b 的 VM 輪次可照抄步驟 3～9）。結果如上表；本節記錄過程中值得留存的事。

### 首次啟動耗時：根本解法未被觸發，但變異依舊

| 情境 | 耗時 |
| --- | --- |
| 第四輪 安裝後 | **26.9 秒**（安裝完成 10:36:20 → `startedAt` 10:36:47） |
| 第四輪 登入自動啟動 | **34.7 秒**（登入 10:52:51 → `startedAt` 10:53:25） |

兩次都在 60 秒預算內，因此 `still-starting` 這條新路徑**這一輪並未被實機觸發**，全程也沒有出現任何 `BT-LCH-*` 對話框。連同前三輪，同一台機器的實測值為 18／18.6／26.9／34.7／37.5／55.5 秒 —— 變異近三倍的事實不變，這正是把成敗判定從時間改為證據的理由。

> 需要留意：這條路徑**沒有被實機驗收觸發過**。要觸發它得讓首次啟動超過 60 秒，本機目前做不到。
>
> 事後補上的涵蓋：`test/service-start-confirmation.test.js` 會啟動一個真實行程，讓它寫出與 `bin/service.js` 相同格式的 `starting` 狀態記錄後刻意撐過預算，再以真實的 `Win32_Process` 查詢判定歸屬（斷言 `ownership === 'owned'`，若 CIM 查詢失敗會退化為 `unknown` 而使測試失敗）。這比原本全部注入假物件的單元測試強得多，但仍**不等於**在封裝安裝上走過一次。

### 兩個 harness 缺陷（不是產品缺陷，但毀掉了證據）

**其一：提早按 Enter 無法與失敗區分。** `r2-install.ps1`、`a10-uninstall-keep.ps1`、`a11-uninstall-delete.ps1` 都以 `Read-Host '完成後按 Enter'` 當作「動作已完成」的信號，之後立刻量測。若在動作真正發生前按下 Enter，輸出會與「安裝失敗」「解除安裝失敗」**完全一樣**。本輪因此誤判過兩次，各浪費一輪重做。

三支腳本已改為**等待實際狀態改變**（安裝目錄出現／消失，最多 5 分鐘），並在逾時時明講「這代表動作未執行或未完成，下方檢查不具參考價值」，而不是留下一份看起來像失敗的報告。

**其二：在提示處中斷腳本會讓整項驗收沒有證據。** 第一次的 A-11 在 `Read-Host` 等待時被關掉，`a11-result.txt` 就停在提示那一行，完全沒有「刪除後」段落 —— 即使解除安裝實際上成功了，該項仍等於沒驗。`a11-uninstall-delete.ps1` 已加上明確警告。

### 一個會誤導後人的過期結論

`r2-startup-timing.ps1` 寫死著第二輪的門檻與判語：「service-control start 上限為 15 秒 >>> 已超過，足以解釋 `BT-LCH-003` 誤報」。第四版的預算是 60 秒，且逾時已不再等同失敗，因此這段話會把正常的啟動寫成誤報。已改為依 60 秒預算判讀，並說明超過時會回報 `still-starting` 而非失敗。

**教訓**：把版本相關的常數與結論寫死在驗收腳本裡，會在產物演進後污染證據檔。腳本應該只記錄觀測值，或從產物本身讀取門檻。

### A-10 的基準線來自別處

本輪 A-10 執行得太早：`a10-uninstall-keep.ps1` 於 11:27:13 啟動時服務尚未寫出資料庫，「解除安裝前」只看到一個 0 bytes 的 `tracker.log`，因此**腳本自己的前後筆數比對沒有成立**。

判定仍為 PASS，基準線改採等價狀態的獨立紀錄：同樣是「全新安裝 ＋ 一次 fixture 掃描」，`r2-install-result.txt`（10:42:53）記錄的筆數為 products 2／offers 3／events 2／sources 2／observations 3，而 A-10 解除安裝後讀到的是**完全相同的五個數字**，且 `integrity_check=ok`、`schemaVersion=13`。程式檔案、捷徑、`Run` 機碼與登錄項目則全數移除。

### 順帶澄清的一個疑點

`a2-result.txt` 記錄「停止後仍存在的 node 行程：PID 32952、25788」，與第三輪的「無殘留」不同。查 `tracker.log` 得 `02:49:21.672Z service shutting down: stop.request`，而腳本在 port 關閉後（10:49:22）立即取樣 —— 服務當時正在做關閉收尾（WAL 併回主檔）。**是取樣時機，不是行程洩漏**；後續各檢查點均為「無 Beyblade node 行程」。

---

## 2.3 路線 2：乾淨 VM — 執行順序與快照規劃

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

### D-7 首次啟動耗時超過判定視窗，導致誤報 `BT-LCH-003`（**已修**）

服務**成功啟動**，但 launcher 仍彈出「背景服務啟動失敗」對話框。

#### 根因

`src/release/service-lifecycle.js` 原本的 `START_TIMEOUT_MS = 15_000`，但首次啟動要先完成 schema migration、自動備份、以及套用任何 pending 匯入才會回報就緒。實測耗時：

| 情境 | 耗時 |
| --- | --- |
| 第一輪 安裝後 | 約 18 秒 |
| 第一輪 登入自動啟動 | **37.5 秒** |
| 第二輪 安裝後（含套用匯入） | 18.6 秒 |

**三次皆超過 15 秒**，因此 `service-control` 回報 timeout、`Run-Control` 取得非零離開碼、launcher 丟出 `BT-LCH-003` —— 儘管服務隨後正常運作。

#### 這個缺陷一直存在，是 D-4 的修正讓它現形

第一輪同樣會發生，只是對話框被隱藏視窗吃掉，使用者與驗收者都看不到。修好錯誤顯示之後，這個長期存在的誤報才浮出水面。

#### 修正

依實測最壞值（37.5 秒）重設整條逾時鏈，並維持各層之間的關係：

| 層級 | 原本 | 現在 |
| --- | --- | --- |
| `START_TIMEOUT_MS` | 15s | **60s** |
| launcher `start` | 40s | 90s |
| launcher `restart` | 80s | 130s |
| `Wait-ForManagementPage` | 15s | 30s |

`restart`（130s）須大於 `stop`＋`start`（35＋60＝95s），已確認成立。

#### 實機驗證（2026-08-07，產物 `c8959c9b…`）

安裝完成 10:31:57 → 服務 `startedAt` 10:32:53，耗時 **55.5 秒**，**未出現任何錯誤對話框**。D-7 修正生效。

#### 根本解法（2026-08-07，第四版產物）

第三輪的修正只是把門檻從 15 秒調到 60 秒，並未改變「逾時即失敗」這個判定方式，因此下方的殘留風險仍在。第四輪改掉判定本身：

| 層級 | 改動 |
| --- | --- |
| `src/release/service-lifecycle.js` | 新增 `confirmStartOutcome()`。`runStartSequence` 逾時後不再直接回報失敗，而是先取證 |
| `scripts/service-control.js` | 新增 `probeHealth()`；新增 `still-starting` 分支，回報「仍在啟動中」並以成功離開 |
| `release/windows/launcher.ps1` | `Wait-ForManagementPage` 成為唯一宣告啟動失敗的地方 |

判定依據不是時間，而是服務自己留下的證據：

1. 狀態檔已寫入 `running` 且 PID 相符 → `started`（競態補撈）
2. 子行程已死 → `exited`，真失敗
3. 子行程存活，且**狀態檔由它自己持有並停在 `starting`** → `still-starting`，**不是失敗**
4. 以上皆非，但 `/health` 有回應 → `still-starting`
5. 都不成立 → `timeout`，真失敗

第 3 點是關鍵：`bin/service.js` 在所有慢工作（migration、自動備份、套用 pending 匯入）**之前**就會寫出一筆帶有自身 PID、執行檔與啟動時間的 `starting` 狀態記錄，因此「這個行程確實是我們的服務、而且還在啟動中」是可查證的事實，不是猜測。

`/health` 只能佐證、不能單獨定案 —— 它不會告訴你是**哪個行程**在回應。但它與「子行程仍存活」併用時有意義：若有別的監聽者占著 8787，我們的子行程會因綁不到 port 而結束，而不是活著。

**逾時的角色因此只剩「使用者要等多久才拿到回饋」**，不再決定成敗，也就不必為變異去猜一個夠大的數字。真正卡住的服務會走到 `Wait-ForManagementPage`，回報 `BT-LCH-004`（等候逾時，服務未回應）—— 這是誠實的描述，而不是 `BT-LCH-003` 那句與事實不符的「啟動失敗」。

> ⚠ **這條新路徑尚未在真機上走過一次。** 2026-08-11 的第四輪實測為 26.9 秒與 34.7 秒，都在 60 秒預算內就回報 `started`，因此 `still-starting` 分支只有單元測試涵蓋。要在實機觸發它，得讓首次啟動超過 60 秒 —— 本機做不到。列為已知涵蓋落差。

<details>
<summary>原殘留風險紀錄（保留作對照）</summary>

#### ⚠ 殘留風險：首次啟動耗時變異極大，固定逾時仍然脆弱

同一台機器、同一個產物家族的實測值：

| 情境 | 耗時 |
| --- | --- |
| 第一輪 安裝後 | 約 18 秒 |
| 第二輪 安裝後 | 18.6 秒 |
| 第一輪 登入自動啟動 | 37.5 秒 |
| **第三輪 安裝後** | **55.5 秒** |

最快與最慢相差近三倍（推測與 Defender 掃描剛寫入的 114 MB payload 及當下機器負載有關）。60 秒門檻在本次只剩 **4.5 秒**餘裕；較慢的機器仍可能再次誤報。

**建議的根本解法**：不要讓「等待逾時」直接等同於「啟動失敗」。逾時後應先確認服務的真實狀態（`tracker.pid` 對應的行程是否存活、`/health` 是否回應），確認確實未啟動才回報 `BT-LCH-003`。如此逾時只影響「要等多久才給使用者回饋」，不再決定成敗判定，也就不需要為變異去猜一個夠大的數字。

此為設計改動，未納入第三輪修正，列為後續項目 —— **已於 2026-08-07 的第四輪實作，見上節。**

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

#### 互動路徑的自動化涵蓋（2026-08-07 補上）

`scripts/phase7-launcher-errors.ps1` 新增**案例 F**，走的正是本缺陷的路徑：`wscript.exe launcher.vbs start`（隱藏主控台、互動模式）觸發 `BT-LCH-001`，然後

- 以 `EnumWindows` + `GetWindowThreadProcessId` 列舉該行程的**所有**頂層視窗。這是必要的：`Process.MainWindowHandle` 只回報可見視窗，正是它讓 D-4 一直看起來像「根本沒有對話框」
- 斷言該視窗 `IsWindowVisible=True`
- 以 `EnumChildWindows` 讀出控制項文字，斷言含 `BT-LCH-001` 與「複製錯誤資訊」「問題回報」「關閉」三個按鈕，且**不含**安裝路徑、使用者目錄、`.ps1`／`.js`、URL 或 stack 字樣
- 送出 `WM_CLOSE` 後，launcher 行程必須在 15 秒內結束 —— 這一條專門盯住「永久阻塞」

無互動桌面時會標記 `SKIPPED` 而非誤判為通過（`-SkipDialogCase` 或 `[Environment]::UserInteractive` 為否）。

撰寫時踩到一個值得記下的陷阱：只用視窗標題等待會**與對話框自己賽跑**。WinForms 表單一建立就帶著標題，早於 `Shown` 事件與控制項實體化，因此第一版腳本抓到的是 `visible=False buttons=0` 的空殼，看起來像修正沒生效。等待條件必須是「可見**且**控制項已建立」。

反向確認：拿掉 `Add_Shown` 的 `ShowWindow` 後，案例 F 回報 **`visible=False buttons=5`** —— 五個控制項全部建好，就是看不見。這正是 D-4 的特徵，也證明這條斷言確實盯著對的東西。

---

### D-5 設定頁的 JavaScript 語法錯誤，整頁互動功能失效（**最高優先**）

`/settings` 的內嵌 script 有語法錯誤，瀏覽器**完全不執行該段程式**，因此頁面上所有事件處理器都沒有掛上。使用者按任何按鈕都不會有反應，也不會送出任何請求。

#### 根因

`src/web/ui.js:126`（位於 `settingsScript()` 自第 112 行起的**模板字面值**內）：

```js
...message(deferred?'updateDeferred':'updateAvailable',{version:availableUpdate.version})+'\n'+availableUpdate.publisher+...
```

`'\n'` 在模板字面值中會被**外層 JavaScript**求值為真實換行字元，於是輸出到瀏覽器的程式碼變成單引號字串內含實際換行 —— 未閉合的字串字面值：

```
SyntaxError: Invalid or unexpected token
```

同一檔案的第 99 行（4 處）與第 101 行（1 處）都正確使用了 `\\n`，**只有第 126 行的 2 處寫成單反斜線**。

#### 影響範圍（已逐頁實測）

擷取每頁的內嵌 script 以 `node --check` 驗證，12 頁中僅 `/settings` 失敗：

| 正常 | `/`、`/products`、`/offers`、`/events`、`/catalog`、`/watchlist`、`/community`、`/review`、`/exclusions`、`/sources`、`/privacy` |
| --- | --- |
| **失效** | **`/settings`** |

設定頁上失效的功能包含：

- Telegram 憑證的**儲存／傳送測試／清除**（直接使 A-8 無法進行）
- 版本更新的**檢查／套用／延後／回滾**（連帶影響 B 段的線上更新驗收）
- 設定頁上的**匯出／匯入移機檔**按鈕
- 隱私與診斷設定的儲存

開始功能表的「匯出／移機」「匯入／移機」捷徑**不受影響**，因為它們不經過網頁（A-7 匯出側因此仍通過）。

#### 診斷經過

1. 使用者回報輸入 Token 後「沒有紀錄」，且 `secrets.json` 未建立。
2. 排除 DPAPI：以安裝包內的 `SecretStore` 用假值實測，667 ms 成功寫入密文並正確回讀。
3. 排除權限與網路：`config` 目錄可寫，`network.enabled=true`。
4. `tracker.log` 在該時段**無任何** `web request failed` 紀錄，而伺服器對所有錯誤都會記錄 —— 代表請求從未送達。
5. 於瀏覽器重新載入設定頁，主控台出現 `Uncaught SyntaxError: Invalid or unexpected token`。
6. 擷取內嵌 script 以 `node --check` 取得確切位置，回溯至 `ui.js:126`。

#### 為什麼自動化測試沒抓到

219 項測試全數通過，其中包含「Phase 7 settings UI stores privacy choices and never returns Telegram plaintext」等設定頁測試 —— 但這些測試驗的是**伺服器端行為與 HTML 內容**，從未把產生出來的內嵌 JavaScript 拿去做語法檢查。

**建議補上的測試**：對每個頁面擷取 `<script nonce>` 內容並以 `new Function(src)` 或 `node --check` 驗證可解析。這類錯誤只要一行測試即可永久防堵。

#### 修正

`src/web/ui.js:126` 的兩處 `'\n'` 改為 `'\\n'`。

---

### D-6 匯入移機檔後服務永久無法啟動（**最嚴重**）

匯入功能完全失效，且失敗後**應用程式無法再啟動** —— 使用者點了「匯入／移機」之後，程式就此打不開，且畫面上沒有任何錯誤訊息。

#### 機制（已由獨立實驗證實為必然，非競態）

匯入是兩階段設計：`bin/import.js` 只驗證移機檔並寫入 `runtime\pending-import.beyblade-transfer`，真正的還原在**服務啟動時**由 `src/app.js:47` 的 `applyPendingTransfer()` 執行。

但 `bin/service.js` 的啟動順序是：

```js
async function main() {
  writeFileSync(PID_FILE, String(process.pid));   // 158：先寫入「自己的」PID
  ...
    app = createApp();                            // 163：createApp → applyPendingTransfer
```

`applyPendingTransfer` 呼叫 `restoreBackup(..., { pidFile })`，其守門邏輯（`src/maintenance/backup.js:96-100`）為：

```js
const pid = Number(readFileSync(candidate, 'utf8').trim());
if (isProcessAlive(pid)) throw new Error(`Tracker 仍在執行中 (PID=${pid})，請先停止服務再還原。`);
```

於是服務讀到**自己剛寫入的 PID**、判定「仍在執行中」，拋錯後結束。

#### 實驗證據

以隔離的 `BEYBLADE_USER_ROOT`、非預設 port、且無任何其他實例執行的環境重現：

```
服務 PID : 7116
[error] service failed to start: Tracker 仍在執行中 (PID=7116)，請先停止服務再還原。
pending 檔是否仍在 : True
資料庫是否建立     : False
```

錯誤中的 PID 與服務自身 PID **完全相同**，證實為自我阻擋。

實機側亦留下相同紀錄（Test_Darren，2026-08-05）：

```
14:28:08.630 [info]  service shutting down: stop.request
14:28:11.599 [error] service failed to start: Tracker 仍在執行中 (PID=3268)，請先停止服務再還原。
```

#### 影響

1. **移機／匯入功能完全無法使用** —— 這是 Phase 7 的主打功能，INSTALL.md 與 README 皆有記載。
2. **失敗後應用程式形同磚化**：`pending-import` 檔不會被消耗，因此**之後每一次啟動都會重複失敗**，包括登入自動啟動與捷徑。使用者必須手動刪除該檔才能恢復，但無從得知。
3. 疊加 **D-4**：整個過程由隱藏的 launcher 執行，使用者看不到任何錯誤，只知道「點了匯入之後程式就打不開了」。

#### 為什麼自動化測試沒抓到

`test/phase7.test.js:60` 的呼叫是：

```js
const applied = applyPendingTransfer(incomingConfig);   // 未傳入 { pidFile }
```

而正式路徑 `src/app.js:47` 傳的是 `{ pidFile: initialPaths.pidFile }`。守門迴圈 `[pidFile, ...pidFiles].filter(Boolean)` 在測試中為空陣列，**該檢查從未被執行**。測試與正式環境使用不同參數，因此測試通過而實際功能損壞。

#### 修正方向

`restoreBackup` 的守門應忽略呼叫端自身的行程，例如在比對時排除 `process.pid`；或由 `applyPendingTransfer` 明確傳入可忽略的 PID。**測試須以與 `app.js` 相同的參數呼叫**，否則同類問題會再次漏測。

亦建議在還原失敗時將 `pending-import` 檔移置一旁（例如改名為 `.failed`），避免應用程式陷入永久無法啟動的狀態。

#### 現場恢復方式

刪除 `%LOCALAPPDATA%\BeybladeTracker\runtime\pending-import.beyblade-transfer` 後即可正常啟動。

---

### D-8 可預期的領域錯誤被顯示為「未預期的錯誤」，且無法追查

2026-08-17 於乾淨 VM 發現。按「探索商品」後畫面無明顯反應（該操作實際需約 3 分鐘），
使用者再按一次，隨即跳出：

```
BT-LCH-999  發生未預期的錯誤
Beyblade Tracker 發生未預期的內部錯誤。
Support reference：7-zHcIZbVatV
```

#### 根因：好訊息在送到畫面前被換掉

`src/core/discovery.js:352-365` 的 `runSiteDiscovery` 有四道守門，每一道的訊息都清楚可行動：

```js
if (!site)     throw new Error('找不到要探索的商店。');
if (running)   throw new Error('這間商店已有探索工作正在執行，請等待完成。');
if (!seed)     throw new Error('這間商店沒有可用的探索網址。');
if (!sameSite) throw new Error('探索網址不在這間商店的網域內。');
```

但 `src/errors/registry.js` 的 `errorCodeFor()` 只比對少數特定模式（SHA-256、更新相關字樣），
其餘一律 `return 'BT-LCH-999'`。上述四句因此全部被替換成「發生未預期的內部錯誤」。

本次資料庫證據指向**守門 2**：`discovery_runs` 唯一一筆為
`site_id=3 status=success started=14:10:42 finished=14:13:54`，
而兩次失敗發生於 `14:10:49` 與 `14:12:13`，皆落在該區間內 —— 即「已有探索正在執行」。

**探索功能本身正常**：95 頁、19,368,370 bytes、找到 8 個候選、`error=null`。
壞掉的只有錯誤呈現。

#### 更嚴重的一面：support reference 對不到任何東西

`src/web/server.js:930` 僅記錄代碼與參考編號：

```js
logger.warn(`web request failed: code=${envelope.code} supportRef=${envelope.supportRef}`);
```

**實際的錯誤訊息從未被記錄到任何地方。** 因此使用者依照對話框指示「複製錯誤資訊後回報」，
開發者拿到 `7-zHcIZbVatV`、翻遍完整 log 也無從得知發生什麼事。
這使**所有** `BT-LCH-999` 都不可診斷，不限於本情境。

#### 附帶的 UX 成因

「探索商品」按下後沒有立即回饋，而該操作耗時約 3 分鐘，使用者自然會再按一次 ——
重複點擊幾乎是被誘發的，而非誤用。

#### 建議修正方向

1. `errorCodeFor()` 對已知的領域錯誤給予專屬代碼（或允許呼叫端以 `trackerError` 標註），
   讓「已有探索執行中」「沒有可用的探索網址」等訊息如實呈現給使用者。
2. 伺服器端記錄原始錯誤訊息與堆疊，並與 `supportRef` 關聯，使回報編號可被查詢。
   對外仍只回傳安全的訊息，兩者並不衝突。
3. 探索觸發後立即給予「已開始，約需數分鐘」的回饋，並在執行期間停用該按鈕。

---

### D-9 非中文語系的來源管理頁排版被擠壞（**已修**）

> **2026-08-28 已修並量測。** `.source-card` 的動作欄由 `auto` 改為 `minmax(0,40%)`，
> 讓按鈕在自己的欄位內換行，而不是把文字欄擠掉。詳見本節末的「修正與量測」。

2026-08-17 於乾淨 VM 發現。同一張來源卡片，繁中排版正常（資訊各佔一行、按鈕靠右對齊），
切換為 English 後左側文字欄被壓縮到約三分之一寬，`Next monitor` 的時間戳被折成兩行、
錯誤訊息折成四行，整張卡片高度暴增。

#### 根因

`src/web/ui.js:30`：

```css
.source-card{display:grid;grid-template-columns:minmax(0,1fr) auto;…}
```

右欄為 `auto`，寬度由按鈕文字決定。英文按鈕明顯較長
（`Disable and keep history`、`Discover products`、`Test connection`），
右欄因此撐大並壓縮左側 `minmax(0,1fr)` 的文字欄。

改為單欄的媒體查詢在 `@media(max-width:820px)`（`ui.js:50`），一般桌面寬度不會觸發，
所以問題在正常視窗大小下就會出現。

日文語系尚未實測，但按鈕字串長度介於中英之間，可能有相同或較輕的問題。

#### 建議修正方向

限制動作欄的最大寬度（例如 `minmax(0,1fr) minmax(auto,42%)`），或提高改為單欄的斷點，
使長字串語系提早堆疊。無論採哪種，修正後應在三種語系各看一次來源管理頁。

#### 修正與量測（2026-08-28）

採用建議的第一種做法：`grid-template-columns` 由 `minmax(0,1fr) auto` 改為 `minmax(0,1fr) minmax(0,40%)`。

在 1180px 寬、English 介面、含一則錯誤訊息的來源卡片上實際量測：

| | 文字欄 | 動作欄 | 卡片高度 |
| --- | --- | --- | --- |
| 修正前（`auto`） | **37%** | 58% | 270px |
| 修正後（上限 40%） | **57%** | 39% | 217px |

37% 正好對應原始描述的「被壓縮到約三分之一寬」。修正後文字欄回到 57%，卡片高度少 53px。

繁中不受影響：按鈕較短時該欄仍依內容縮小，不會被撐到 40%。
回歸測試斷言該欄**不得**為 `auto` 且必須有百分比上限；還原成 `auto` 後測試失敗。

**仍待實機**：三種語系各看一次來源管理頁（VM 輪的階段 3 可一併完成）。

---

### 已排除：log 中文亂碼（**非缺陷**）

第一版診斷腳本以 `Get-Content` 未指定編碼讀取 `tracker.log`，在 Windows PowerShell 5.1 下以 ANSI 解讀 UTF-8，導致輸出呈現 `?? New product @ Yodobashi ??2450 JPY`。

以 `-Encoding UTF8` 重讀同一份 log 得到 `🆕 New product @ Yodobashi — 2450 JPY`，證實**應用程式寫出的 UTF-8 完全正確**，亂碼純屬診斷腳本缺陷，已修正。此案例與 A-6 要驗證的 BOM／編碼議題同源，記錄於此以免日後重複誤判。

---

## 4. 驗收結論

| 欄位 | 內容 |
| --- | --- |
| 執行者 | Darren Ye |
| 測試機／帳號 | 開發機 `C--Dev-Beyblade-dev` 的本機測試帳號 `Test_Darren`（路線 1） |
| 產物 | 第四輪 `0d4a0c73…`，27,479,037 bytes |
| 執行日期 | 2026-08-02（第一輪）／08-05～08-07（第二、三輪）／**2026-08-11（第四輪，收尾）** |
| A 段結果 | **11 PASS / 0 FAIL / 0 未測**（共 11 項） |
| 未測項 | 無。A-4b 已於 2026-08-17 在乾淨 VM 完成 |
| 阻斷性問題 | 無。五項真缺陷（D-3～D-7）全部已修並實機驗證 |
| Go / No-Go | **A 段 Go（但不完整）**；B 段仍全數受阻，見下 |

A 段 10 項 PASS 代表**安裝、執行、解除安裝**層面可接受，但這不是完整的發佈判定，原因有三：

1. **A-4b 未測** —— 沒有 Chrome 的機器上安裝會發生什麼，至今無人驗過。
2. **路線 1 不等於 RUNBOOK 要求的 clean VM** —— 本機有全機器安裝的 Chrome 與 `C:\Program Files\nodejs`，「不需開發工具」只能以間接方式證明（見 2.1 節末）。
3. **B 段全數受阻** —— 線上更新、rollback、migration 升級與 SmartScreen 都需要外部條件（Authenticode 憑證、HTTPS 發佈站、一個 1.0.1 版本）。

因此**仍不得將此產物標示為公開 production release**。
