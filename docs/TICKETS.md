# Delivery Tickets／Backlog

> 狀態：Active
> 最後更新：2026-08-29
> 規則：本檔是正式 backlog；Roadmap 只保存優先順序與里程碑。
> 目前驗證基線：`main` 於 2026-08-29 執行 `npm test` 通過 **260/260**（0 fail／0 skip／0 todo），
> 四項 release E2E 全綠（normal／stopfail／missing-launcher／launcher-errors 6-6）。
> 各 Ticket 內文保留當時的歷史測試數字，不回頭改寫。

## 1. 工作流程

Status：

- `Proposed`：已記錄，尚未核准執行。
- `Ready`：範圍、owner、依賴及 acceptance criteria 足以開工。
- `In Progress`：執行中。
- `Blocked`：外部條件或決策阻擋；必須記錄 blocker 與解除條件。
- `In Review`：實作完成，等待 code／product／operations 驗收。
- `Done`：所有 acceptance criteria、測試、文件及驗收證據完成。
- `Cancelled`：明確決定不做並保存原因。

Priority：`P0` 發布／資料／安全 blocker；`P1` 下一階段重要工作；`P2` 最佳化；`P3` 選配探索。

## 2. Backlog 摘要

| ID | Priority | Status | 標題 | 依賴／阻塞 |
|---|---|---|---|---|
| BT-P0-001 | P0 | Ready | 完成 Windows 發佈 | 建一個 1.0.1 ＋ GitHub Releases 發佈流程。**憑證與 hosting 已確認非必要** |
| BT-UPD-002 | P0 | Proposed | 把更新驗證公鑰內建到產物，不再依賴環境變數 | — |
| BT-REL-001 | P0 | Investigating | 更新後 `current.json` 已是新版，但服務仍執行舊版程式碼 | 需要 VM 診斷輸出 |
| BT-P1-001 | P1 | Done | 使 Local Web 測試不受 ambient proxy 影響 | 無 |
| BT-P1-002 | P1 | Done | 建立 local-first 可觀測性 | — |
| BT-P1-003 | P1 | Done | 修正 Windows PowerShell 5.1 Launcher 編碼 | — |
| BT-UX-001 | P0 | In Review | 完成一般使用者雙擊安裝與單一入口驗收 | A 段已全數 PASS；剩 verified publisher（`BT-P0-001` 的簽章） |
| BT-UX-002 | P0 | In Review | 建立可見且穩定的使用者錯誤代碼 | 五條 criteria 皆已實機驗證，但 **D-8 顯示可預期錯誤仍會被報成 `BT-LCH-999`**，僅修了冷卻一條路徑 |
| BT-UX-003 | P1 | In Review | 抓取失敗的來源錯誤訊息改為繁中且可操作 | Recipe 行三語化尚未實機複驗；另有「dns 建議語在單純斷網時誤導」待處理 |
| BT-UPD-001 | P0 | In Review | 實作使用者確認後的自動更新 UX | BT-P0-001 release channel／clean VM |
| BT-SUP-001 | P1 | In Review | 建立公開 GitHub Issues 與繁中問題回報表單 | 雙帳號收信驗收 |
| BT-DOC-002 | P1 | In Review | 建立一般使用者教學與錯誤代碼目錄 | 發布前確認文件進入 release payload |
| BT-P2-001 | P2 | Proposed | HTTP conditional request 與 bounded cache | BT-P1-002 metrics |
| BT-P2-002 | P2 | Proposed | Chrome browser pool 與 concurrency control | 效能基準 |
| BT-P2-003 | P2 | Proposed | Queue backpressure、priority 與效能基準 | BT-P1-002 |
| BT-API-001 | P2 | In Progress | 細分 Local Web API 的 HTTP status mapping | 首片已交付（冷卻→409）；其餘狀態待處理 |
| BT-EXT-001 | P1 | Blocked | Takara Tomy Mall 真實 Discovery 驗收 | Queue-it 自然解除 |
| BT-EXT-002 | P2 | Blocked | X 社群來源付費 API 啟用 | 使用者費用同意與 Developer Project |
| BT-FUT-001 | P3 | Proposed | 跨裝置同步 threat model | 明確產品需求 |
| BT-FUT-002 | P3 | Proposed | 使用者可編輯進階 Recipe | 安全／UX design |
| BT-DOC-001 | P1 | Done | 建立正式專案文件基線 | — |

## 3. Ticket 詳細內容

### BT-P0-001 — 完成 Windows 發佈

- Priority：P0
- Status：Ready
- Owner：待指定 Release Owner
- 背景：1.0.0 installer candidate、manifest verification、rollback 與 isolated E2E 基礎已存在，但尚不具備公開 production release 的完整信任鏈與外部驗收。
- **2026-08-29 範圍重新確認**：與產品負責人確認實際意圖為「使用者在自己的 Windows 電腦跑，不架網站」。據此：
  - **HTTPS hosting 不需自架** —— GitHub Releases 即滿足程式對 manifest／installer 必須為 HTTPS 的要求（`update.js:70,97`），免費且無伺服器要維護。
  - **Authenticode 憑證降為未來選配** —— 缺它只影響 SmartScreen 首次警告，功能與完整性皆不受影響（後者由 SHA-256 ＋ Ed25519 保證，已驗證）。年費不符現階段規模，日後導入成本僅在簽章步驟。
  - **clean VM final acceptance** 待 1.0.1 與 Release 網址就緒後一次完成。
  - 詳見 checklist 第四節。
- 真正的 blocker：**尚無 1.0.1**。`validateUpdateManifest()` 需 `compareVersions(manifest.version, APP_VERSION) > 0`，同版本永遠只顯示「已是最新」，更新鏈因此無法測試。
- Scope：簽章、hosting、release channel、manifest、clean install／upgrade／rollback／transfer／uninstall 驗收及 Go／No-Go。
- Out of scope：新產品功能、繞過 SmartScreen、把 private key 放入 repository／CI log。
- Acceptance criteria：
  - Setup.exe Authenticode signature 可驗證。
  - Manifest 使用 HTTPS URL、correct SHA-256、valid Ed25519 signature 且 `publishReady=true`。
  - Clean Windows 完整測試通過並附 version／schema／screenshots 或 log 摘要。
  - Update failure 可 rollback，且使用者資料完整。
  - Release／rollback owner 簽核；Runbook、CHANGELOG、下載頁一致。
- Evidence：PR、release artifact checksums、signature verification、VM checklist、DB integrity／FK result。

### BT-REL-001 — 更新後服務仍在跑舊版程式碼

- Priority：P0
- Status：Investigating
- Owner：待指定
- 背景：2026-08-29 在 clean VM 實跑更新驗收，1.0.0 → 1.0.1。更新流程回報成功，但同一次量測中：

  | 來源 | 版本 |
  | --- | --- |
  | `current.json` | 1.0.1 |
  | `/health` 的 `release.version` | **1.0.0** |

- `/health` 的版本來自 `src/release/version.js`，讀的是**執行中程式碼樹**的 `package.json`。
  所以這代表：安裝已經換版，但 **8787 仍由 1.0.0 的行程持有**。
- **使用者影響**：畫面顯示「更新已完成」，使用者卻仍在跑舊版，而且沒有任何提示。
  這比更新失敗更糟 —— 失敗至少看得見。
- 可能成因（未證實）：靜默安裝的 `[Run]` 是 `launcher.vbs restart noninteractive` 且帶 `nowait`
  （`installer.iss:55`）。若舊行程沒有確實退場，新行程就綁不上 8787，舊的繼續服務。
- 尚待確認：量測時間點距更新完成僅數分鐘，仍有可能只是重啟尚未完成。
  `update-test-diagnose.ps1`（選單 `6`）會指認 8787 由哪一個版本目錄的行程持有，以此區分。
- 資料面沒有問題：更新前後 13 項筆數完全一致。

### BT-UPD-002 — 把更新驗證公鑰內建到產物

- Priority：P0
- Status：Proposed
- Owner：待指定
- 背景：2026-08-29 撰寫更新驗收步驟時發現，`src/config.js:95` 的 `publicKey` 來自 `UPDATE_PUBLIC_KEY` 環境變數，**預設為空字串**。而 `validateUpdateManifest`（`update.js:86`）在沒有公鑰時直接丟 `BT-UPD-003`。
- **使用者影響**：公鑰是公開資訊，本來就該隨產物出貨。現行設計等於**一般使用者永遠無法驗證更新** —— 除非他自己去設一個多行 PEM 的環境變數，而那與「不需要 PowerShell」的產品主張直接矛盾。
- 這不是理論問題：更新鏈的驗收因此必須先手動設環境變數才能進行。
- Scope：把公鑰以建置時內嵌（或隨 payload 出貨的檔案）方式提供，保留環境變數作為覆寫，供測試與金鑰輪替使用。
- Out of scope：把**私鑰**放進產物或版控。
- Acceptance criteria：
  - 全新安裝在未設定任何環境變數的情況下，能完成一次成功的更新檢查與簽章驗證。
  - 環境變數若有設定則優先，以便測試與輪替。
  - 私鑰不在產物、不在版控、不在任何 log。
  - 有測試涵蓋「未設定環境變數時仍能驗簽」。

### BT-P1-001 — 使 Local Web 測試不受 ambient proxy 影響

- Priority：P1
- Status：Done
- Owner：Engineering
- 背景：2026-07-28 `npm test` 為 122/133；11 項 `test/web.test.js` 均在 fetch localhost 時收到 `Proxy response (403) !== 200 when HTTP Tunneling`。其他 122 項通過，失敗並非 application assertion。
- Problem：測試依賴 shell／npm proxy environment，造成 localhost integration test 非 hermetic，也可能掩蓋真實 Web regression。
- Scope：確認 root cause、讓 loopback test 明確 bypass proxy、加入 regression coverage、更新 Runbook。
- Constraints：不得清除或曝光使用者 proxy credentials；不得讓 production external fetch 繞過既有企業 proxy policy。
- Acceptance criteria：
  - 在有 `HTTP_PROXY`／`HTTPS_PROXY` 的測試環境仍可完成 loopback Web tests。
  - External HTTP client 的 proxy／network policy 行為不因修復意外改變。
  - `npm test` 完整 suite 通過。
  - 記錄 Node／OS／proxy variables 是否存在的低敏感度驗收摘要。
- Evidence：2026-07-29 Windows／Node v25.7.0，ambient `HTTP_PROXY`／`HTTPS_PROXY`／`ALL_PROXY` 存在且 `NO_PROXY` 原為空值；修正前目前分支為 126/138，12 項 localhost fetch 皆遭 proxy 403；加入保留 external proxy、只 bypass loopback 的 test runner 與 regression test 後，一般 `npm test` 通過 139/139。

### BT-P1-002 — 建立 local-first 可觀測性

- Priority：P1
- Status：Done
- Owner：待指定
- 背景：現有 `/health` 與 text log 可提供基本資訊，但沒有一致 event schema、歷史成功率、parser failure rate 或 queue 趨勢。
- Scope：structured logs、本機 operations page、source／parser／notification／update metrics、SLO 與 diagnostics summary。
- Privacy：預設不上傳外部 telemetry；任何 opt-in 方案須另立 PRD／threat model。
- Acceptance criteria：
  - 每個 operation 有 correlation ID、component、source、status、duration、safe error class。
  - UI 可查最後成功、連續失敗、parse failure、queue、stale／archived counts。
  - Runbook 能以這些資料完成三個演練：source parser failure、notification failure、stale data。
  - Diagnostics 仍不含 credentials、full URLs、logs 或 product history。
- Verification evidence（2026-07-30）：新增 schema 11 的 `operation_events`（correlation ID、component、operation、source key、status、duration、bounded `error_class`），bounded local retention。已於 source／parser／notification／update 路徑埋點：`runOfferMonitors`（source＋parser，含每項解析失敗計數）、`flushNotifications`（每次送出）、`recordUpdateCheck` 與更新 apply 終態。新增 `/operations` 頁與 `GET /api/operations`（最後成功、連續失敗、parser failure rate、佇列、stale／archived 計數、各來源最近錯誤類別），並加入 zh-TW／en／ja 標籤。`safeErrorClass` 保證只輸出 bounded label，永不外洩 message／URL／token；診斷匯出新增 `operations` 安全區塊。Runbook §18 補上三個演練。新增 `test/operations.test.js` focused 測試。仍待 `npm test` 全綠與 UI 實機驗收後才可標記 Done。
- FIX verification（2026-07-31）：parser 會拒絕無 URL／無有效商品欄位的 row，JSON-LD／browser connector 以 page-level empty／maintenance outcome 隔離不會進入 pipeline；parser、notification、queue、freshness、source health 的 SLO 門檻會共同決定整體狀態。operation event 欄位均受 allowlist／長度限制，diagnostics 遮蔽一般 URL、query 與 credential/token 模式；manual、scheduled、defer 與 apply internal check 都記錄安全 update event。`npm test` 192/192 通過；本機 `/operations` zh-TW、en、ja 各為 HTTP 200。Runbook parser／notification／stale 三項演練皆由相對應 regression 情境驗證。
- FIX-11–FIX-39 verification（2026-07-31）：schema 12 寫入 valid／item-invalid／item-failed／page counts；為保留既有 migration checksum，以 schema 13 新增 `page_failed_count`。Parser 分開計算 legacy event／item／page failure rate；1 valid + 99 empty pages 與 1 valid + 99 item exceptions 都為 `degraded`。Rollback accepted／running／succeeded／failed lifecycle 以 runtime sidecar 保存，共用 correlation ID 與實際 duration，runner 不會開啟或升級已還原的舊 schema DB。Rollback restore 與舊版服務啟動失敗皆保留 `BT-UPD-007` 與 duration，且每次只寫入一筆 terminal event。Rollback endpoint 必須先成功寫入 accepted sidecar 才觸發 service stop；sidecar 寫入失敗會回傳 `BT-UPD-007` 且不啟動 handoff，並以 single-flight reservation 拒絕第二個請求而不修改既有 lifecycle。accepted／running sidecar 以 5 分鐘 bounded lease 保護；service 與 rollback runner owner 都以 PID、executable、command line 與建立時間嚴格驗證，PID reuse 或無法讀取程序資訊不會誤鎖 retry。逾期但 owner 存活時仍保持鎖定；只有 owner 已消失時，才以舊 ID 寫入安全 failed 終態並以新 ID 接受 retry。running lifecycle 保存 runner identity；live runner 會跨 lease 阻擋第二個 rollback，且 service start 僅接受該 runner 的 PID＋correlation ID 授權。Web→service handoff 使用實際 service `startedAt` 與 process identity；跨程序 `rollback.lock` 以原子 owner publication 實作 single-flight，初始化中的 owner fail-closed 並允許 bounded orphan recovery。stale lifecycle 僅會在成功取得 lock 後 finalize；安裝根目錄 launcher 也會驗證 live rollback lock，避免跨版本切回 legacy control 時繞過守門。直接 CLI rollback 在沒有既有 sidecar 時會產生安全 correlation ID，僅會延續 accepted／running attempt；failed 或 succeeded 後的 retry 會建立新的 ID。API 與 diagnostics 會拒絕惡意 DB timestamp、source key、counter 與 error class；聚合計數不再截斷。`npm test` **219/219 passed**。

### BT-P1-003 — 修正 Windows PowerShell 5.1 Launcher 編碼

- Priority：P1
- Status：Done
- Owner：Engineering
- 背景：`release/windows/launcher.ps1` 含繁中文案，但原檔為無 BOM 的 UTF-8。Windows PowerShell 5.1 依系統 ANSI code page 解析無 BOM 腳本，導致例外訊息、狀態提示與匯入／匯出對話框標籤顯示亂碼。
- Root cause：Windows PowerShell 5.1 不會把無 BOM 的腳本穩定辨識為 UTF-8；Launcher 缺少明確的檔案編碼標記，既有 Phase 7 測試也只檢查 installer 宣告，未驗證 Launcher bytes。
- Scope：將 Launcher 保存為 UTF-8 with BOM；新增 byte-level regression test；把 PowerShell 5.1 編碼檢查加入 Windows release procedure。
- Acceptance criteria：
  - Launcher 前三個 bytes 為 UTF-8 BOM `EF BB BF`。
  - Windows PowerShell 5.1 能正確解析繁中錯誤、狀態與移機對話框文案。
  - Phase 7 targeted test 與完整 Node test suite 通過。
- Evidence：Windows PowerShell 5.1 實際錯誤路徑正確顯示繁中；Launcher static regression 與 safe Web error contract 已通過；`BT-P1-001` 完成後，ambient proxy 環境完整測試為 139/139。

### BT-UX-001 — 完成一般使用者雙擊安裝與單一入口驗收

> 實機驗收（2026-08-11，第四版產物 `0d4a0c73…`）：於本機測試帳號走完整輪，A 段 **10 PASS / 0 FAIL / 1 未測**。安裝、五個捷徑、登入自動啟動、首次導覽、實際抓取、兩個解除安裝分支皆通過，全程使用 GUI，未要求 Node、PowerShell 或工作排程器。首次啟動 26.9 秒（安裝後）與 34.7 秒（登入），未出現任何錯誤對話框。詳見 [WINDOWS_ACCEPTANCE_CHECKLIST.md](WINDOWS_ACCEPTANCE_CHECKLIST.md) 第 2.2 節。
>
> 狀態改為 In Review。剩餘兩項 acceptance criteria 無法在本機完成：**A-4b 無 Chrome 分支**（Chrome 為全機器安裝，換帳號仍可見，需乾淨 VM）與**verified publisher**（需 Authenticode 憑證，屬 `BT-P0-001`）。

- Priority：P0
- Status：In Review
- Owner：待指定 Windows Release Engineer
- 背景：Inno Setup installer candidate、bundled runtime、Start Menu shortcuts 與 auto-start 已存在，但仍需以一般使用者體驗及正式簽章 artifact 完成驗收。
- Scope：單一 Setup.exe、double-click install、per-user permissions、finish-page launch、捷徑、reinstall／upgrade／uninstall、Chrome prompt、SmartScreen。
- Out of scope：要求一般使用者安裝 Node、執行 PowerShell 或手動設定工作排程器。
- Acceptance criteria：
  - Clean Windows 10／11 標準帳號由下載到首次管理頁全程使用 GUI。
  - 安裝、重裝、升級與解除安裝均保留／刪除資料符合使用者選擇。
  - 正式 installer 顯示 verified publisher；無不必要 admin prompt。
  - 安裝失敗顯示 `BT-INS-*` 代碼與 recovery。
  - 使用者教學與錯誤代碼可由開始功能表或 App 開啟。
- Evidence：錄影／screenshots、installer log 摘要、clean VM matrix、DB／settings preservation。

### BT-UX-002 — 建立可見且穩定的使用者錯誤代碼

- Priority：P0
- Status：In Review
- Owner：待指定
- 背景：目前 Launcher 由 hidden VBS／PowerShell 執行，exception 可能無聲消失；其他元件也多回傳純文字，沒有可查詢的穩定代碼。
- Scope：中央 registry、`BT-<AREA>-<NNN>`、native／Web error dialog、copy／report、safe support reference、log correlation、catalog docs。
- Acceptance criteria：
  - [Error Code Catalog](ERROR_CODES.md) 所列發布 gate error 都有 deterministic trigger 與 automated test。
  - Hidden Launcher 的 current version missing、runtime missing、service failure、timeout 均顯示 dialog。
  - UI 文案為繁中、可鍵盤操作、可複製；不洩漏 secret、stack、private URL／path。
  - Error code 與 App version 可預填 Issue Form，但使用者送出前能檢視。
  - 未知 internal error 使用保留的 generic code，不把 exception message 當公開契約。
- Verification evidence（2026-07-29）：中央 registry、safe Local Web error envelope、可鍵盤操作的 copy／report dialog 與 hidden Launcher 的 `BT-LCH-001`～`005` mapping 已實作；catalog／registry、Web envelope 與 Launcher static regression tests 已新增。仍需在隔離 Windows 安裝目錄完成 native dialog 實機互動驗收後才能標記 Done。
- Verification evidence（2026-08-11）：上述實機互動驗收**已完成，並在過程中找出並修好一個嚴重缺陷**。
  - **D-4**：`launcher.vbs` 以 `SW_HIDE` 啟動 PowerShell，WinForms 第一個頂層視窗沿用該狀態，於是 `ShowDialog()` 開出一個看不見的強制回應對話框並永久阻塞。**所有經由捷徑或安裝器觸發的 `BT-LCH-*` 使用者都完全看不到**，整套錯誤 UX 在真實使用情境下無法觸及 —— 這正是本 Ticket 第二條 acceptance criteria 的核心，先前的 static regression test 完全測不到，因為它們只涵蓋 `-NonInteractive`。
  - 修正：`Show-LauncherError` 於表單 `Shown` 事件強制 `ShowWindow(SW_SHOWNORMAL)` ＋ `SetForegroundWindow` ＋ `TopMost`。刻意不改 `launcher.vbs` 的 `shell.Run ... 0` —— 隱藏主控台本身是正確設計。
  - 新增自動化：`scripts/phase7-launcher-errors.ps1` **案例 F** 走真實捷徑路徑（`wscript.exe launcher.vbs`），以 `EnumWindows` 列舉頂層視窗（`MainWindowHandle` 只回報可見視窗，正是它讓本缺陷看起來像「沒有對話框」），斷言可見、含代碼與三個按鈕、不含路徑或 URL，且 `WM_CLOSE` 後行程必須結束。反向確認：移除修正後回報 `visible=False buttons=5`。
  - 實機（2026-08-11）：對話框可見、`BT-LCH-001`、繁中無亂碼、四鍵可用；「複製錯誤資訊」的剪貼簿內容恰為代碼／App version／UTC／Support reference 四行，12 項禁用字樣（路徑、使用者名稱、`.ps1`／`.vbs`、stack、URL、token、webhook）全部未命中。
- Verification evidence（2026-08-11，第四條 criteria）：「Error code 與 App version 可預填 Issue Form」**先前不成立，已修正並於線上表單實測通過**。
  - 缺陷：三個回報入口（`release/windows/launcher.ps1`、`src/web/ui.js`、`src/errors/registry.js`）都連到 `/issues/new/choose?title=…&body=…`。但本專案的表單是 **GitHub Issue Form**（`.github/ISSUE_TEMPLATE/bug_report.yml`），沒有自由格式 body —— 每個欄位由自己的 `id` 定址，`body=` 無處可綁而被丟棄。
  - 實測（舊 URL）：標題有填入，但**「錯誤代碼」與「App 版本」兩欄皆空白** —— 正是本條 criteria 要預填的兩欄。使用者仍得自己重打。
  - 修正：改連 `/issues/new?template=bug_report.yml&title=…&error_code=…&app_version=…`，使用表單實際定義的欄位 id。
  - 實測（新 URL）：標題 `[問題回報] BT-LCH-003`、錯誤代碼 `BT-LCH-003`、App 版本 `1.0.0` 皆已填入，其餘欄位留白由使用者填寫。**驗證方式為載入表單頁面讀取欄位值，未送出任何 issue。**
  - 只預填這兩欄：它們是使用者無法準確重打的，也是表單有對應 id 的。support reference 沒有對應欄位，留在「複製錯誤資訊」的內容裡，不硬塞進不相干的欄位。URL 不帶任何路徑、token 或 stack。
  - 回歸涵蓋：`test/error-contract.test.js` 直接讀 `bug_report.yml` 取出真實欄位 id，斷言 URL 的每個參數都對得上（`template`／`title` 除外），並禁止 `body=`；另有一項確保三個入口共用同一份契約。反向確認：還原修正後 2 項失敗。
  - **順帶更正一個我方的錯誤推論**：原本以為 `/issues/new/choose` 會在使用者選擇模板時丟掉 query string。實測顯示**它會帶過去** —— 失效的唯一原因就是 Issue Form 忽略 `body=`。相關註解已改正，以免後人依據錯誤機制做判斷。
- **剩餘**：`release/windows/launcher.ps1` 已變更，A-6b 的「問題回報」按鈕需於下一版產物複驗（點擊後實際開啟的 URL 是否為修正後的形式）。這是標記 Done 前的最後一項。

### BT-UPD-001 — 實作使用者確認後的自動更新 UX

> Follow-up verification (2026-07-29): defer can be reversed; active apply controls stay hidden; temporary scheduled failure preserves the verified manifest and retries in five minutes; each new apply clears stale rollback status; rollback success requires the previous service to start and `BT-UPD-007` overrides stale health UI. Regression coverage added. Status remains In Review pending release-channel and clean-Windows-VM update/rollback acceptance.

> Remaining-fixes verification (2026-07-29): rollback status is now retained through failed preparation and cleared only after all preparation artifacts succeed. Manual check failures preserve the verified state and timestamp. Scheduling uses remaining delay and safe active-operation summaries allow Settings reload recovery; apply controls are guarded and polling is non-overlapping. Status remains In Review pending external release-channel and clean-Windows-VM acceptance.

> Packaged Windows verification (2026-07-29): rebuilt installer passed isolated silent install, service start, packaged health, synchronous stop, uninstall, and user-data preservation E2E. Silent setup does not show the optional browser prompt, while service restart remains enabled. Status remains In Review: this is not a substitute for signed release-channel and clean-Windows-VM upgrade/rollback acceptance.

> Fix-plan implementation (2026-07-30): apply now reserves a `checking` operation before manifest I/O, terminal operations have bounded retention, silent uninstall uses `SuppressibleMsgBox(..., IDYES)`, and E2E validates the installed 8787 service before uninstall. Status remains In Review pending a release artifact and clean-VM upgrade/rollback verification.

> P2 follow-up implementation (2026-07-30): Settings renders `checking` as an indeterminate active phase; Windows service force-stop requires verified PID/executable/service-path/creation-time ownership; E2E continues with bounded run-ID-scoped fallback cleanup after a graceful-stop failure. Status remains In Review pending external release gates.

> Uninstall and process-ownership follow-up (2026-07-30): the launcher has an explicit `-NonInteractive` mode with bounded waits, safe stderr codes (including the new `BT-LCH-006`) and explicit exit codes; the uninstaller runs that hidden stop as a precondition and aborts non-zero instead of deleting a running install; `unknown` ownership may request a graceful stop while force kill requires re-verified `owned` on that exact PID; the start path distinguishes `owned`, `other` and `unknown` so a stale or reused PID neither blocks startup nor kills a foreign process. Two real defects surfaced during packaged verification and were fixed: `Start-Process -PassThru` reported a null exit code, turning a successful stop into `BT-LCH-003`; and the symmetric ±10s creation-time window misread a >6s packaged cold start as `other`, so the check is now directional (process creation must precede the recorded `startedAt` within a 2s clock-skew tolerance and a 120s startup window). Verification: 182 Node tests, `config:check`, PowerShell 5.1 parser, rebuilt installer, normal packaged E2E, and a new negative stop-failure E2E that fails in ~3s with no UI and a protected install; both runs left port 8787 free and no run-ID processes or directories. Status remains In Review pending signed release channel and clean-Windows-VM upgrade/rollback acceptance.

> Missing-launcher fail-closed fix (2026-07-30): the uninstall stop precondition no longer treats a missing `{app}\launcher.ps1` as a completed stop. It now returns `False`, so a partially damaged install (antivirus quarantine, interrupted update, manual deletion) aborts the uninstall non-zero and keeps program files, the startup entry, the running service and user data; the documented recovery is to reinstall the same or a newer version, stop background tracking from the Start Menu, then uninstall. Covered by a precise static contract test scoped to `StopTrackerService()` (verified to fail on a simulated `Result := True` regression) and by a new `MissingLauncherMode` packaged E2E. Verification: 182 Node tests, `config:check`, PowerShell 5.1 parser, rebuilt installer, and all three packaged E2E runs in sequence — missing-launcher failed closed in 1s with PID preserved on 8787, normal E2E passed, stop-failure E2E failed in 4s; all three runs left port 8787 free with no run-ID processes or directories. Status remains In Review pending external release gates.

- Priority：P0
- Status：In Review
- Owner：待指定
- 背景：現有 manifest／HTTPS／SHA-256／Ed25519／backup／rollback foundation 已存在，但缺少正式 channel 與 consumer consent flow。
- Scope：startup delay、24h cadence、stable channel、version／release notes UI、defer、explicit confirmation、download progress、backup、install、post-health、rollback。
- Constraints：禁止 silent forced update；check 不等於 download consent；confirmation 只適用指定 target version／manifest digest。
- Acceptance criteria：
  - 無新版、offline、network paused、defer、成功更新、signature failure、hash mismatch、install failure、health failure、rollback 全部有測試。
  - 未按「下載並安裝」前沒有 installer download 或 process launch。
  - 更新前 consistent backup；使用者資料及 settings 保留。
  - 只接受 HTTPS、valid manifest／hash／publisher；failure 顯示 `BT-UPD-*`。
  - Clean VM 由 1.0.0 升至測試版並可 rollback。
- Verification evidence（2026-07-29）：已實作 signed stable 且 `publishReady=true` manifest、5 秒啟動延遲與持續服務 24h cadence、資料庫 network pause、保存的可用更新 UI 提示、defer、target／manifest digest confirmation、single-flight download/install、下載進度、SHA-256 驗證、backup、silent installer 重啟服務、rollback record、冪等 post-update integrity health marker、health rollback UI，以及可觀測的 rollback runner 狀態。已新增 consent／defer／cadence／pause／signature／publishReady／hash／post-health／async launch／single-flight／rollback handoff automated tests。仍待正式 HTTPS release channel 與 clean Windows VM 升級／rollback 實機驗收；因此不可標記 Done。

### BT-SUP-001 — 建立公開 GitHub Issues 與繁中問題回報表單

- Priority：P1
- Status：In Review
- Owner：Repository Owner
- 決策：程式碼 repository 可公開，使用同一 repository 的 Issues；不另建 support-only repo。
- Scope：GitHub remote、public visibility、Issues、Issue Form、labels、privacy warning、watching／Email notifications、App／docs URLs。
- Acceptance criteria：
  - Repository 公開且 Issues 對一般 read access 使用者開放。
  - 繁中 form 包含問題類型、錯誤代碼、版本、Windows、步驟、預期／實際、重現性與 privacy checkbox。
  - Form 禁止或警告上傳 secrets、DB、transfer、full logs／URLs；blank issues 預設關閉。
  - Owner 設定 `Watch → Custom → Issues`，GitHub 與 Email notification 都啟用。
  - 第二帳號建立 Issue 後，owner 收到通知；owner 回覆後，reporter 收到通知。
  - `SUPPORT.md`、User Guide 與 App 填入正式 Issues URL。
- Evidence（2026-07-29）：公開 repository 與繁中 Issue Form 已上線；GitHub 實際渲染全部必填欄位及 privacy checkbox；`bug`／`needs-triage` 自動套用；7 個分類 labels 已建立；owner 已設定 `Custom → Issues`，Watching／Participating 均啟用 GitHub／Email。剩餘第二帳號送出、owner 收信、owner 回覆、reporter 收信的 end-to-end 驗收。

### BT-DOC-002 — 建立一般使用者教學與錯誤代碼目錄

- Priority：P1
- Status：In Review
- Owner：PM／Documentation Owner
- Scope：`USER_GUIDE.md`、`ERROR_CODES.md`、`SUPPORT.md`，以及 PRD、Roadmap、Tech／API Spec、Runbook、README、Troubleshooting、CHANGELOG 交叉更新。
- Acceptance criteria：
  - 清楚區分 1.0.0 as-built 與下一版 Proposed，未把錯誤代碼／自動更新誤標為已實作。
  - 說明主要功能、雙擊安裝、首次啟動、Watchlist、通知、更新同意、備份／移機與問題回報。
  - Error codes 有 meaning、safe recovery 與 privacy guidance。
  - Support spec 有 GitHub Form fields、notification setup、triage 與 end-to-end acceptance。
  - Public repo／Issues／Release URL 已補齊；發布前確認文件進入 release payload。
- Verification evidence（2026-08-02）：`SUPPORT.md` §「公開 URL」已填入正式 repository、Issues 與 Releases URL，`USER_GUIDE.md` §10 的問題回報連結同步指向 Issue Form；表格依賴欄的「Support／Release URL 待填」已過時並移除。`USER_GUIDE.md` §8 原本仍寫「目前版本尚未實作固定錯誤代碼」，與 `BT-UX-002` 已交付的 registry／Web envelope／Launcher dialog 不符，已改為「已實作但尚未隨公開 release 發布」。剩餘唯一條件為發布時確認 `USER_GUIDE.md`、`ERROR_CODES.md`、`SUPPORT.md` 實際進入 release payload。

### BT-UX-003 — 抓取失敗的來源錯誤訊息改為繁中且可操作

- Priority：P1
- Status：In Review
- Owner：待指定
- 背景：A-9 的預期結果之一是「失敗時於來源管理頁顯示**可操作的繁中錯誤**」。此項至今從未被驗證 —— 歷輪驗收不是三個來源全數成功，就是失敗在別的地方。2026-08-11 檢視程式後確認**目前不成立**。
- 現況：
  - `recordCrawlFailure`（`src/core/store.js:110`）把 `String(error).slice(0, 500)` 原封不動寫進 `sources.last_error`。
  - 抓取路徑的 `src/net/http.js` 產生的是 `HTTP 404`、`fetch failed`、`response exceeds N bytes` 等英文訊息；browser connector 則直接吐出 Playwright 原文（例如 `page.waitForSelector: Timeout 45000ms exceeded`，見 D-2）。
  - 來源頁（`src/web/server.js:480`）逐字顯示該字串。
  - **對照組**：預覽路徑的 `src/net/public-http.js` 有完整繁中訊息（`網站回傳 HTTP 404。`、`頁面超過預覽大小限制。`）。所以問題不是沒有能力，而是抓取路徑沒做。
- Scope：為抓取失敗建立 error class → 使用者訊息的對應，涵蓋繁中／日文／英文三種 UI 語言；來源頁顯示可操作訊息與建議動作；原始技術訊息保留在 log 與診斷匯出，不丟棄。
- Out of scope：改變 `last_error` 的儲存內容（診斷仍需原文）；重寫 connector 的例外型別。
- Acceptance criteria：
  - 常見失敗（HTTP 4xx／5xx、逾時、DNS／連線失敗、內容過大、解析不到商品、robots 拒絕）在來源頁顯示對應 UI 語言的訊息與可操作建議。
  - 訊息不洩漏完整路徑、stack 或憑證；站方可控的字串仍必須逃逸。
  - 未知錯誤落到保留的泛用訊息，不把 exception message 當公開契約。
  - 每個對應都有測試；至少一項覆蓋「站方可控字串不得注入 markup」。
- 相關：`BT-UX-002`（錯誤代碼 registry）、D-2（失效 URL 造成的 45 秒逾時是本問題最早的實例）

- Verification evidence（2026-08-11 實作，**2026-08-17 於乾淨 VM 通過**）：斷網後 UI 顯示「找不到這個網域…」，英文同步為 "That domain could not be found…"，原文收在「技術細節」，接回網路後連續失敗 2→0 自行復原。詳見 VM_ROUND.md 階段 5。
  - **沿用既有機制而非另造一套**：`safeErrorClass()`（`src/core/operations.js`）本來就會把任何錯誤化約成有界、不含內容的類別（`http_NNN`、`timeout`、`dns`、`connection`、`tls`、`robots_blocked`、`access_blocked`、`network_paused`、`parse`、`not_found`、`validation`…），且設計上**永不回傳原始訊息**。因此它是安全的 join key。
  - 新增 `sourceErrorMessageKey()` 做「類別 → 翻譯鍵」對應。10 個 HTTP 狀態各有專屬建議（404 是下架、429 是放慢、503 是等待，使用者該做的事不同），其餘落到泛用 HTTP 訊息並**帶上類別**，讓訊息不會比證據更模糊。
  - **不需要 schema 變更**：分類在渲染時進行，因此既有的 `last_error` 資料也會受惠，不必 migration。
  - 三語文案全數寫入 `src/i18n.js`（繁中／日文／英文）。
  - 來源頁改為「可操作訊息在前，商店原文收在 `<details> 技術細節`」。原文不丟棄 —— 那才是回報時有用的東西 —— 但它可能含站方可控內容，所以維持逃逸並收在展開區。
  - 回歸涵蓋：五種真實失敗訊息各自得到不同建議且不落入 catch-all；英日文各自有專屬用詞；**每個類別在三種語言都必須有翻譯**（缺翻譯會退回繁中，在英文頁上不會有人發現，所以特別立一條）；未知類別不得把自己洩漏進文案。反向確認：還原渲染後 3 項失敗。
- Verification evidence（2026-08-11，第二次修正）：準備實機步驟時發現**分類漏掉兩個最常見的失敗**，已補。
  - **`fetch failed`** —— undici 在離線或主機不可達時回報的字串，也是一般使用者最常遇到的失敗。原本落到 `error` → 泛用訊息。已歸入 `connection`。
  - **`response exceeds N bytes`** —— `src/net/http.js` 的下載上限錯誤。原本同樣落到泛用訊息，而「內容過大」本來就寫在本 Ticket 的 scope 裡。新增 `too_large` 類別與三語文案（建議改用單一商品頁而非分類頁）。
  - 該規則刻意排在寬鬆的 HTTP 狀態啟發式**之前**：若上限剛好是三位數（例如 `exceeds 500 bytes`），否則會被誤讀成 `http_500`。已有測試涵蓋。
  - 新增測試以 `src/net/http.js` 與 connector **實際會拋出的字串**逐一斷言分類，而非憑想像列舉。反向確認：移除任一規則後對應測試失敗。
- Verification evidence（2026-08-28，實機驗收發現）：驗收者在**英文介面**上看到來源錯誤已翻譯，但其下的 Recipe 那一行仍是繁中。
  - 根因：`src/core/discovery.js` 把中文句子寫進 `site_recipes.last_error`，而 `src/web/server.js` 逐字輸出並硬寫 `Recipe：` 前綴 —— 與 BT-UX-003 修好的那一行只差一行，被我漏掉。
  - 修正：discovery 改存穩定 token `RECIPE_NO_CANDIDATES`，文案由 i18n 提供；新增 `no_candidates` 類別與三語文案；`Recipe` 標籤本身也改為可翻譯。
  - **既有安裝不受影響**：分類同時認得舊資料裡的中文散文，不會退回泛用訊息。
  - 反向確認：把渲染改回逐字輸出後測試失敗。
- **剩餘**：A-9 的「失敗時顯示可操作繁中錯誤」需於下一版產物實機複驗。做法：加入一個正常來源（`https://www.hlj.com/product/TKT09613`）後**中斷網路**並按「立即重新檢查」，確認顯示「無法連線到商店…」而非 `TypeError: fetch failed`。
  - **不可用已下架的 shimamura URL**：2026-08-11 實測，它在 UI 的**預覽**階段就以「網站重新導向超過 3 次。」被擋下，加不進去；且該訊息來自 `src/net/public-http.js`（預覽路徑），本來就是中文的，測不到本 Ticket 的範圍。

### BT-P2-001 — HTTP conditional request 與 bounded cache

- Priority：P2
- Status：Proposed
- Scope：ETag、Last-Modified、304 handling、per-source bounded metadata／response cache、cache invalidation。
- Acceptance criteria：減少重複 bytes／parse work；304 不建立錯誤 state transition；cache 有 size／age limit；source isolation、robots、freshness 測試不退化。

### BT-P2-002 — Chrome browser pool 與 concurrency control

- Priority：P2
- Status：Proposed
- Scope：重用 browser process、page lifecycle、per-site／global concurrency、crash recovery、shutdown cleanup。
- Acceptance criteria：無 orphan Chrome；達上限時 backpressure；source failure 不污染其他 context；cold／warm benchmark 顯示啟動數與資源改善。

### BT-P2-003 — Queue backpressure、priority 與效能基準

- Priority：P2
- Status：Proposed
- Scope：Discovery／Monitor／Notification queue limits、Watchlist priority、memory／CPU／bytes／duration benchmark。
- Acceptance criteria：負載超限時可預測降載；不丟失 audit／notification state；priority 不造成一般來源永久 starvation；基準可重現。

### BT-API-001 — 細分 Local Web API 的 HTTP status mapping

- Priority：P2
- Status：In Progress
- Owner：待指定
- Verification evidence（2026-08-28，**修正已記載的 D-8**）：本問題**並非新發現** —— checklist 的 **D-8「可預期的領域錯誤被顯示為未預期的錯誤，且無法追查」** 已於 2026-08-17 在乾淨 VM 記錄，根因分析相同（好訊息在送到畫面前被 envelope 換掉），但當時只寫了建議方向、未修。2026-08-28 於 Test_Darren 再次重現（連按兩次「立即重新檢查」），本次予以修正。
  - 根因：`requestImmediateMonitor` 丟出的冷卻錯誤沒有穩定代碼，落到 `errorEnvelope` 的泛用分支。**丟出點本來就有一句清楚的繁中訊息「立即重新檢查仍在冷卻中，請 N 秒後再試。」，卻被 envelope 丟棄，換成一句與事實不符的話。** HTTP 狀態也與格式錯誤共用 `400`。
  - 首片修正：新增 `BT-SRC-003`（含 recovery 指引與錯誤代碼目錄條目）；代碼設在**丟出點**而非事後比對訊息字串；冷卻改回傳 **409**，與 malformed request 區分。
  - 剩餘秒數刻意不進入 envelope —— 那是動態值，不該成為公開契約的一部分；使用者看到的是穩定的「稍候片刻再試」。
  - 反向確認：移除代碼或 409 對應後，各有 5 項測試失敗。
  - **2026-08-28 第二片**：`runSiteDiscovery` 的四道守門也改為帶穩定代碼（`BT-SRC-004`～`007`），「已有探索工作正在執行」與「找不到商店」另外對應 409／404。`trackerError` 擴充為可同時帶代碼與訊息 —— 代碼給使用者，原句留給 log 與診斷，不成為公開契約。
  - **剩餘範圍不變**：其餘 validation／policy／conflict／not-found 的完整對應仍待處理。
- 背景：`docs/API_SPEC.md` §12 與 §13 已記錄此限制——目前實作把 validation、policy、network 及多數 internal error 統一回傳 `400`，只有 route／Product／被辨識為 not found 的 error message 會回 `404`。`BT-UX-002` 交付的中央 error registry 已提供穩定的 `BT-<AREA>-<NNN>` 代碼與安全 envelope，因此 status code 已不是識別錯誤類別的唯一手段，但仍讓「使用者輸入錯誤」與「伺服器內部失敗」在 HTTP 層無法區分。
- 使用者影響：一般使用者不直接受影響（Local Web UI 讀的是 envelope 內的錯誤代碼）。影響的是除錯、log 判讀與未來任何以 status code 做重試決策的客戶端——目前 `500` 級失敗會被誤判為可由使用者修正的 `400`。
- Scope：
  - 由 error code registry 推導 status class，而非在各 route 手寫。
  - validation／輸入格式錯誤 → `400`；policy 拒絕（network paused、來源政策、consent 未給）→ `403`；狀態衝突（single-flight 已在執行、冷卻中、重複 apply）→ `409`；找不到資源 → `404`；未知內部錯誤 → `500`。
  - 更新 `docs/API_SPEC.md` §12／§13 與受影響的 route 表。
  - 前端錯誤處理改以錯誤代碼為準，確保不因 status 改變而退化。
- Out of scope：新增 endpoint、改變 error envelope 結構、改變既有錯誤代碼字串、加入 remote authN／authZ。
- Dependencies／Blockers：`BT-UX-002` 的 error registry 需維持為單一事實來源。
- Security／Privacy／Data impact：不得因細分 status 而洩漏 route 是否存在、內部路徑或例外訊息；`500` 仍只回傳保留代碼與 `supportRef`，不含 stack。
- Acceptance criteria：
  - [ ] 每個公開錯誤代碼在 registry 中有明確且唯一的 status class。
  - [ ] validation、policy、conflict、not found、internal 各至少一項 route-level 回歸測試斷言正確 status。
  - [ ] 未知例外回傳 `500` 與保留代碼，且 body 不含 message／stack／path。
  - [ ] Local Web UI 在新 status 下錯誤顯示與 recovery 動作不退化，三語文案不變。
  - [ ] `docs/API_SPEC.md` 的已知限制條目移除或改寫為 as-built 行為。
  - [ ] `npm test` 全數通過。
- Verification evidence：待實作。
- Related PR／release／post-mortem：待建立。

### BT-EXT-001 — Takara Tomy Mall 真實 Discovery 驗收

- Priority：P1
- Status：Blocked
- Blocker：真實分類頁 Queue-it 等候室。
- Scope：等候室自然解除後，以核准 budget 執行公開頁 Discovery、Review Queue approve、Offer monitor。
- Constraints：禁止 bypass、登入、CAPTCHA solving 或擴大 request budget 來規避限制。
- Acceptance criteria：記錄 robots／budget、pages／bytes、candidate reasons、approve 結果、後續 monitor；不跨 Site、不違反 policy。

### BT-EXT-002 — X 社群來源付費 API 啟用

- Priority：P2
- Status：Blocked
- Blockers：使用者明確費用同意、自己的 X Developer Project、最新官方 pricing／terms 查核、monthly budget。
- Scope：官方 API acquisition、credential handling、budget guard、rate／error handling、原文與 dedup 驗收。
- Constraints：預設 disabled／zero budget；不得用 HTML scraping 繞過平台控制；舊價格不可當成 current fact。
- Acceptance criteria：費用與 budget 顯式確認；超額前停止；community data 仍與 Offer／official／stock Event 隔離。

### BT-FUT-001 — 跨裝置同步 threat model

- Priority：P3
- Status：Proposed
- Deliverable：只做 discovery／design，不直接實作同步。
- Acceptance criteria：定義 data owner、identity、authN／authZ、encryption、key recovery、conflict resolution、retention、delete、offline behaviour、cost 及 migration path；Owner 做 Go／No-Go。

### BT-FUT-002 — 使用者可編輯進階 Recipe

- Priority：P3
- Status：Proposed
- Acceptance criteria：preview、schema validation、selector sandbox／limits、versioning、rollback、fixture export、budget guard、accessibility；失效 Recipe 自動暫停而非盲目 retry。

### BT-DOC-001 — 建立正式專案文件基線

- Priority：P1
- Status：Done
- Owner：PM／Documentation Owner
- Scope：PRD、Roadmap、Tech Spec、API Spec、Data Schema、README、Runbook、Tickets、Post-mortem、PR Description、CHANGELOG；合併既有 README／Roadmap／TODO／Project Memory 與 Git history。
- Acceptance criteria：
  - 文件以繁中為主，技術名稱保留英文。
  - `docs/` 有索引、ownership、更新規則與交叉連結。
  - As-built 與 Proposed 清楚分離；沒有虛構 incident／PR／驗收。
  - Root legacy planning docs 導向 canonical docs；release-required root docs 保留。
  - Markdown link、版本、schema、route、table 與 Git facts 已檢查。
  - `git diff` 只含文件，原有 ROADMAP 使用者修改已保留。
- Verification evidence：2026-07-28 link validation 通過；42 個 migration table 均有文件；`git diff --check` 通過；變更範圍只有 Markdown。

## 4. 新 Ticket 模板

```markdown
### BT-<AREA>-NNN — <標題>

- Priority：P0／P1／P2／P3
- Status：Proposed／Ready／In Progress／Blocked／In Review／Done／Cancelled
- Owner：
- 背景／問題：
- 使用者影響：
- Scope：
- Out of scope：
- Dependencies／Blockers：
- Security／Privacy／Data impact：
- Acceptance criteria：
  - [ ]
- Verification evidence：
- Related PR／release／post-mortem：
```

## 5. 驗收規則

其他團隊交付後，驗收者至少需核對：Ticket acceptance criteria、PR scope、測試證據、API／schema compatibility、security／privacy、Runbook、CHANGELOG、rollback。結果標為 Accepted、Accepted with follow-up 或 Rejected；follow-up 必須建立新 Ticket，不以口頭承諾取代。
