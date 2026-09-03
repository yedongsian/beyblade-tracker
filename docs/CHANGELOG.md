# Changelog

格式參考 Keep a Changelog；本專案目前使用 semantic version `1.0.4`。Git 在 2026-07-16 才建立，因此更早的開發歷史只以現存文件為準。

## [1.0.4] — 2026-09-04

修正一個「更新功能對一般使用者根本不存在」的缺陷。

### 修正的缺陷

- **BT-UPD-002** 更新來源與驗證公鑰改為**內建於產物**。

  先前 `src/config.js` 的兩個設定都只來自環境變數，且預設為空字串：

  | 使用者沒設 | 實際結果 |
  | --- | --- |
  | `UPDATE_MANIFEST_URL` | 設定頁顯示「正式更新來源尚未設定」，**永遠不檢查更新** |
  | `UPDATE_PUBLIC_KEY` | 就算設了網址，也直接丟 `BT-UPD-003` |

  也就是說，1.0.3 以前的所有版本，**一般使用者收不到也驗不了更新**。
  先前每一輪更新驗收之所以能通過，都是因為手動設了那兩個環境變數 ——
  那是測試手續，被誤當成產品行為。

  公鑰是公開資訊，本來就該隨產物出貨。它現在由建置流程**從簽章私鑰導出**，
  而不是另外指定一個公鑰檔：手動配兩個檔案總會有配錯的一天，
  而配錯的症狀是 `BT-UPD-003`，與「沒設公鑰」完全相同，極難查。導出則不可能配錯。

  內建的更新網址指向 `/releases/latest/download/release-manifest.json`，
  永遠解析到**最新的非 prerelease 發佈**。寫死某個版本的話，
  每個版本只會檢查到自己，永遠發現不了新版。

  **這也改變了發佈流程：把一個發佈標記為正式版（取消 prerelease），
  就等於把它推送給所有使用者。**

  環境變數仍然優先，驗收可以覆寫指向特定 manifest。

### 給 1.0.3 以前的使用者

舊版沒有內建更新來源，**無法自動更新到本版**，請手動下載安裝。這是最後一次需要手動升級。

## [1.0.3] — 2026-09-03

1.0.2 的更新鏈已在 clean VM 上**實測通過**（1.0.1 → 1.0.2 → 回滾至 1.0.1，資料 13 項筆數不變、
資料庫完整性 `ok`）。本版修正在那次實測中才浮現的兩個問題。

### 修正的缺陷

- **BT-UX-006** 更新完成後，App 仍持續兜售它剛剛裝好的那一版，「安裝更新」按鈕也還在，
  最長會延續到 24 小時後的下一次排程檢查。

  成因：儲存下來的檢查結果裡那個 `updateAvailable` 是**檢查當下**算出的事實，
  設定頁、全站橫幅與兩支 status API 全都直接讀它，沒有一處拿現在執行的版本重新比對。
  新增 `pendingUpdate(state, currentVersion)`，四處統一走它。

  **這個缺陷在 `BT-REL-001` 修好之前不可能被看見** —— 在此之前從來沒有一次更新真正完成過。

- **回滾失敗時保留原因。** `rollbackUpdate` 的 `catch` 會把 `restoreBackup` 的真正錯誤丟掉，
  於是「備份檔不見」「備份驗證不過」「服務仍在執行」三種需要不同處置的失敗，
  被壓成同一句「無法還原更新前的備份」。原因現在保留給日誌，
  對外的錯誤信封仍只有代碼與 recovery。

### 已知未修

- `BT-UX-005`（P2）開啟 App 的第一眼看不到更新橫幅：橫幅為伺服器端渲染，
  而啟動檢查在 5 秒後才跑。任何一次導覽或重新整理都會看到。
- `BT-UX-007`（P2）更新**成功**後沒有使用者可及的回滾入口；回滾按鈕只在健康檢查失敗時出現。
- `BT-UPD-002`（P0）驗證公鑰仍未內建於產物，一般使用者無法驗證更新簽章。

## [1.0.2] — 2026-08-30

修正一個會讓**所有線上更新永久失效**的缺陷。1.0.1 的更新鏈在 clean VM 上實測不通過，
本版是修正版；沒有這一版，1.0.1 的使用者按下「安裝更新」之後會一直停在舊版而不自知。

### 修正的缺陷

- **BT-REL-001** 更新後服務從未換版。`classifyServiceProcess` 以「執行檔路徑完全相同」
  判斷一個行程是不是自己的服務；更新會把新版裝在**另一個**版本目錄並改寫 `current.json`，
  於是新版的 service-control 把仍在服務的舊版視為陌生行程而拒絕停止它 ——
  連接埠永遠不釋出，新版永遠起不來。這是永久死結，不是競態。

  身分比對改為「同一個安裝根目錄下的任一已安裝版本」：執行檔須位於
  `<installRoot>\versions\<版本>\runtime\node.exe`，且命令列須含**同一個**版本的
  `bin\service.js`。防止誤殺重用 PID 之無關行程的保護完全保留。

- **更新的成功判準**不再只看安裝器的離開代碼。安裝器離開代碼 0 只代表檔案寫好了，
  與「哪一個版本在服務」無關 —— 上述缺陷正是活在這個落差裡：畫面顯示「更新已完成」，
  舊版卻繼續回應，並繼續提供同一個更新。

  新增 `verifying` 階段與 `BT-UPD-008`（更新未生效）。這個確認刻意是反向的：
  成功的接手必然會停掉執行此確認的行程，所以**還活著撐到逾時本身就是失敗**。

### 驗收說明

BT-REL-001 的修正在**新版**的 service-control 裡 —— 它正是要去停舊服務的那一方。
因此 1.0.1 → 1.0.2 是第一條能真正走通的更新路徑，也是本版必須在 VM 上實測的原因。

## [1.0.1] — 2026-08-29

第一個可作為更新目標的版本。1.0.0 從未公開發佈，因此以下皆為發佈前的修正與強化。
**建立 1.0.1 的主要目的**：`validateUpdateManifest()` 需要 manifest 版本高於已安裝版本，
在有第二個版本之前，線上更新鏈完全無法測試。

### 修正的缺陷（實機驗收找出）

- **D-3** 發佈產物不再夾帶建置機的個人來源設定；全新安裝以離線 fixture 起步。
- **D-4** 隱藏 launcher 的錯誤對話框現在看得見，且關閉後行程會結束。
- **D-5** 設定頁的行內 script 語法錯誤，曾使整頁事件處理器失效。
- **D-6** 匯入移機檔後服務無法啟動（自我 PID 阻擋），且失敗檔會被移置一旁而非永久卡住。
- **D-7** 啟動成敗改由服務自身證據判定，逾時只決定等待多久，不再誤報 `BT-LCH-003`。
- **D-8** 可預期的錯誤（冷卻、探索四道守門）不再顯示為「未預期的內部錯誤」，並改用 409／404。
- **D-9** 非中文語系的來源卡片排版不再把文字欄壓成三分之一。

### 使用者可見的改善

- 抓取失敗改顯示可操作的三語訊息，商店原文收在「技術細節」；離線時不再誤導使用者去檢查網址拼寫。
- 操作回饋顯示在被操作的那張來源卡片內，而非頁面頂端 —— 那正是造成連按、進而觸發 D-8 的原因。
- **有可用更新時，所有頁面都會顯示提示**。先前只有設定頁看得到，排程檢查等同無效。
- 「問題回報」按鈕現在真的會預填錯誤代碼與 App 版本。

### 內部

- 驗收與 E2E 腳本不再寫死版本號（原有 21 處），改由 `package.json` 或已安裝的 `current.json` 推導。
- 驗收腳本納入版控（`scripts/acceptance/`）。
- 新增 `BT-SRC-003`～`BT-SRC-007` 錯誤代碼。

驗證：`npm test` **260/260**；四項 release E2E 全綠（normal／stopfail／missing-launcher／launcher-errors 6-6）。

## [Unreleased]

> 目前驗證基線：`codex/bt-upd-001` 於 2026-08-02 執行 `npm test` 通過 **219/219**（0 fail／0 skip／0 todo）。下方 Development history 保留各階段當時的歷史數字。

- BT-P1-002: local-first observability — schema 13 `operation_events` now stores distinct valid, item-invalid, item-failed, page and page-failed counts. Parser SLOs independently evaluate item and page failure rates; operation, API and diagnostics timestamps are strictly projected ISO-8601 UTC values; defer/resume/rollback lifecycle events use a shared correlation ID and safe error class. No external telemetry; error classes never carry messages, URLs, credentials, or database-injected fields.
- BT-UPD-001 follow-up: reversible defer, stable in-progress update controls, retry without discarding a verified manifest, rollback status reset per apply, and service-start-confirmed rollback status with `BT-UPD-007` priority.
- BT-UPD-001 remaining fixes: retain rollback failure evidence until update preparation completes, preserve verified update state on manual-check failure, schedule from the remaining cadence, and expose only safe active-operation progress so Settings can resume after reload without overlapping apply or poll requests.
- BT-UPD-001 Windows packaging hardening: silent setup suppresses the optional browser prompt without suppressing service restart; uninstall waits for the launcher to stop the service; isolated packaged E2E now verifies install, health, uninstall, and user-data preservation with bounded Inno Setup cleanup.
- BT-UPD-001 concurrency and packaging follow-up: reserve update operations before manifest I/O, retain bounded terminal progress, make silent uninstall default to preserving data, and validate the installed service PID/status/8787 health during packaged E2E with strict cleanup failures.
- BT-UPD-001 P2 follow-up: present manifest checking separately from download progress, verify process ownership before a forced Windows stop, and keep E2E cleanup scoped to the current run after graceful-stop failures.
- BT-UPD-001 uninstall and process-ownership follow-up: give the launcher an explicit non-interactive mode with bounded waits and safe exit codes, make a hidden non-interactive service stop a precondition of uninstall, let `unknown` ownership still request a graceful stop while force kill requires re-verified `owned`, teach the start path to tell `owned`, `other` and `unknown` apart, and add a negative packaged E2E for the silent stop-failure path.

### Fixed

- 讓 `npm test` 在保留 external proxy policy 的同時，於隔離 child process 明確 bypass loopback proxy；新增環境合併回歸測試（`BT-P1-001`）。
- 修正 Windows PowerShell 5.1 將無 BOM UTF-8 `launcher.ps1` 當成 ANSI 解碼，造成繁中錯誤訊息、狀態提示與移機對話框標籤亂碼；新增 Launcher BOM 防回歸測試（`BT-P1-003`）。
- 新增 BT-UX-002 中央錯誤代碼 registry、safe Local Web error envelope 與 hidden Launcher native dialog；未知 internal error 使用 `BT-LCH-999`，不公開 exception message、stack、secret、private URL 或 path。
- BT-UPD-001：更新只接受 signed stable manifest，並要求使用者以 target version 與 manifest digest 明確確認後，才下載、備份或啟動 installer；加入 defer、24h cadence、進度、post-update health 與 rollback flow。
- BT-UPD-001 follow-up：修正持續服務的 recurring update check、資料庫 network pause、冪等 health marker、非同步 installer spawn failure，以及 Web rollback 的安全停機 handoff。
- BT-UPD-001 follow-up：silent installer 現在完成後重啟服務；補齊 defer、single-flight、health／rollback 結果 UI、`publishReady` 驗證、manifest error mapping 與英日介面文字。
- BT-UPD-001：修正 silent uninstall 在 stop 失敗時開啟 WinForms 視窗並造成 90 秒 timeout；launcher 新增 `-NonInteractive` bounded 模式（新代碼 `BT-LCH-006`），uninstaller 以 non-interactive stop 為前置條件，失敗即中止移除。
- BT-UPD-001：修正 non-interactive launcher 因 `Start-Process -PassThru` 回傳 null exit code，把成功的 service stop 判成 `BT-LCH-003`；改用自有 process handle 讀取 exit code。
- BT-UPD-001：修正 packaged cold start（process 建立到 `startedAt` 可超過 6 秒）被 ±10 秒對稱 creation-time 視窗誤判為 `other`；改為方向性檢查——process 不得在紀錄的 `startedAt` 之後建立（PID reuse 容忍 2 秒 clock skew），startup 視窗放寬至 120 秒。
- BT-UPD-001：修正 uninstall stop 前置條件在 `launcher.ps1` 遺失時 fail open（回傳 stop success 後繼續移除執行中的安裝）；改為 fail closed，並新增 `MissingLauncherMode` packaged E2E 與精確的 installer static contract test。

### Documentation

- 建立 canonical `docs/` 文件中心與治理規則。
- 新增 PRD、Tech Spec、API Spec、Data Schema、Runbook、Ticket backlog、Post-mortem 制度及 PR template。
- 合併 Phase 0–7 歷史與 Phase 7 後暫停／代辦順序。
- 記錄 2026-07-28 ambient proxy 導致 11 項 Local Web tests 無法連線 localhost，建立 `BT-P1-001`。
- 核准一般使用者易用性方向：雙擊安裝、可見錯誤代碼、使用者確認後更新與公開 GitHub Support。
- 新增 `USER_GUIDE.md`、`ERROR_CODES.md` 與 `SUPPORT.md`；錯誤代碼及完整 update UX 明確標為下一版 Proposed，不誤列為 1.0.0 已完成。
- 新增 `BT-UX-001`、`BT-UX-002`、`BT-UPD-001`、`BT-SUP-001` 與 `BT-DOC-002` 的範圍、依賴及驗收條件。
- 建立公開 repository `yedongsian/beyblade-tracker`、繁中 GitHub Issue Form、privacy confirmation 與使用教學／錯誤代碼入口。
- 完成 GitHub Issue Form 實際渲染驗收、問題分類 labels，以及 owner 的 `Custom → Issues` 與 Email notification 設定。
- 修正 `USER_GUIDE.md` §8 過期敘述：固定錯誤代碼（registry、管理頁安全錯誤對話框、Launcher 原生對話框 `BT-LCH-001`～`006`、保留代碼 `BT-LCH-999`）已由 `BT-UX-002` 實作，僅尚未隨公開 release 發布；原文誤稱「目前版本尚未實作」。
- 統一 `BT-SUP-001` 狀態：摘要表與 Ticket 內文原為 `In Review` 與 `Ready` 不一致，一律更正為 `In Review`（剩餘條件為第二帳號 Issue 通知 end-to-end 驗收）。
- 更新 `BT-DOC-002` 依賴欄：Support／Issues／Release URL 已補齊，依賴改為「發布前確認文件進入 release payload」，並補上驗收證據。
- 於 Roadmap、CHANGELOG 與 Tickets 標示目前驗證基線 `npm test` 219/219；各階段歷史數字維持原樣不回頭改寫。
- 新增 `BT-API-001`（P2、Proposed）：細分 Local Web API 的 HTTP status mapping，取代目前把多數 exception 折成 `400` 的行為；本次僅建立 Ticket，未實作。

## [1.0.0] — 2026-07-18

### Added

- Windows per-user installer、bundled Node runtime、Start Menu／auto-start、data-preserving uninstall。
- Signed update manifest validation、SHA-256、Ed25519 verification、staged update 與 rollback 基礎。
- Transfer export／import、consistent backup／restore、privacy-preserving diagnostics。
- Windows DPAPI CurrentUser Telegram secret storage。
- Manual Product split／merge audit、listing exclusion review／override、global network control。
- Product／Offer tracking、price／stock observations、events、notification aggregation。
- Source preview／management、controlled Discovery、Review Queue、Catalog、Watchlist、official／community intelligence。
- 繁中、日文、英文 Local Web UI。

### Changed

- 商品 identity 使用 normalized SKU 與 variant key，避免衝突 SKU／異色版誤合併。
- HTTP、Telegram、Discord 加入 timeout、response size limit、`Retry-After` 與有限 backoff。
- Offer freshness、stale／archive／recovery 與 stability confirmation 成為正式監控行為。

### Security

- Secrets 不寫入 DB／logs／diagnostics／transfer bundle。
- Local Web mutation 受 loopback Host／Origin 與 CSRF 保護。
- External URL acquisition 阻擋 private／local address 並驗證 redirect。
- 預設不繞過 login、CAPTCHA、Queue-it、paywall 或 anti-automation。

### Known release gaps

- Installer candidate 尚未完成公開 Authenticode、HTTPS release hosting、production Ed25519 key governance 與 clean Windows SmartScreen 驗收。
- Takara 真實 Discovery 仍受 Queue-it 外部條件阻擋。
- X community source 預設 disabled／zero budget，需使用者自行接受費用及設定 Developer Project。

## Development history

### 2026-07-18 — Phase 7 release and hardening

- Commit `51652dc`。
- Schema 9–10：identity／exclusion hardening、manual audit、network control。
- 新增 installer、update、rollback、transfer、diagnostics、privacy／source／release 文件。
- 歷史驗收紀錄為 133 Node tests、16 Web routes；公開發布閘門仍未完成。

### 2026-07-16 — Phase 6 community intelligence

- Commit `b709f0e`。
- Schema 8；community source registry、unverified posts、fingerprint／origin dedup、Watchlist match、filter 與 retention。
- X source 保持 user setup required、disabled、zero budget。

### 2026-07-16 — Phases 3–5

- Commit `7b22537`。
- Schema 5–7；三語 UI、Catalog／aliases／parts／terminology、Offer freshness scheduler、Watchlist、official registry／announcement／preview。

### 2026-07-16 — Catalog roadmap

- Commit `cde1ac7`；建立 Catalog 產品方向，後續由 Phase 3–5 實作。

### 2026-07-16 — Phase 2 live-validation record

- Commit `d42a293`；記錄 restart 與 live validation，Takara 真實頁仍受外部等候室限制。

### 2026-07-16 — Phase 2 Discovery and Review Queue

- Commit `de77719`。
- Schema 4；robots／Sitemap／bounded frontier、Recipe、candidate Review Queue。

### 2026-07-16 — Phase 0–1 completion record

- Commit `3783a4d`；補記 completion baseline。

### 2026-07-16 — Repository baseline

- Commit `689c181`。
- Schema 1–3；core pipeline、connectors、SQLite、notifications、backup／restore、source management、Local Web UI。

## 維護規則

- 使用者可感知或重大工程變更進入 `[Unreleased]`。
- Release 時把 Unreleased 移至具日期的 version；不要修改已發布內容以掩蓋歷史。
- Internal refactor 若無行為變更可省略；security、schema、API、migration、release／rollback 行為不可省略。
- Commit hash 是 traceability 證據，不取代 Ticket／PR／release acceptance。
