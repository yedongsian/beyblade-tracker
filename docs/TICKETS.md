# Delivery Tickets／Backlog

> 狀態：Active
> 最後更新：2026-07-28
> 規則：本檔是正式 backlog；Roadmap 只保存優先順序與里程碑。

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
| BT-P0-001 | P0 | Blocked | 完成 Windows 公開發佈閘門 | 憑證、hosting、key owner、clean VM |
| BT-P1-001 | P1 | Ready | 使 Local Web 測試不受 ambient proxy 影響 | 無 |
| BT-P1-002 | P1 | Proposed | 建立 local-first 可觀測性 | 產品指標與 UI scope 決策 |
| BT-P2-001 | P2 | Proposed | HTTP conditional request 與 bounded cache | BT-P1-002 metrics |
| BT-P2-002 | P2 | Proposed | Chrome browser pool 與 concurrency control | 效能基準 |
| BT-P2-003 | P2 | Proposed | Queue backpressure、priority 與效能基準 | BT-P1-002 |
| BT-EXT-001 | P1 | Blocked | Takara Tomy Mall 真實 Discovery 驗收 | Queue-it 自然解除 |
| BT-EXT-002 | P2 | Blocked | X 社群來源付費 API 啟用 | 使用者費用同意與 Developer Project |
| BT-FUT-001 | P3 | Proposed | 跨裝置同步 threat model | 明確產品需求 |
| BT-FUT-002 | P3 | Proposed | 使用者可編輯進階 Recipe | 安全／UX design |
| BT-DOC-001 | P1 | Done | 建立正式專案文件基線 | — |

## 3. Ticket 詳細內容

### BT-P0-001 — 完成 Windows 公開發佈閘門

- Priority：P0
- Status：Blocked
- Owner：待指定 Release Owner
- 背景：1.0.0 installer candidate、manifest verification、rollback 與 isolated E2E 基礎已存在，但尚不具備公開 production release 的完整信任鏈與外部驗收。
- Blockers：Authenticode certificate、HTTPS hosting、Ed25519 offline key owner、clean Windows VM／test machine、SmartScreen acceptance。
- Scope：簽章、hosting、release channel、manifest、clean install／upgrade／rollback／transfer／uninstall 驗收及 Go／No-Go。
- Out of scope：新產品功能、繞過 SmartScreen、把 private key 放入 repository／CI log。
- Acceptance criteria：
  - Setup.exe Authenticode signature 可驗證。
  - Manifest 使用 HTTPS URL、correct SHA-256、valid Ed25519 signature 且 `publishReady=true`。
  - Clean Windows 完整測試通過並附 version／schema／screenshots 或 log 摘要。
  - Update failure 可 rollback，且使用者資料完整。
  - Release／rollback owner 簽核；Runbook、CHANGELOG、下載頁一致。
- Evidence：PR、release artifact checksums、signature verification、VM checklist、DB integrity／FK result。

### BT-P1-001 — 使 Local Web 測試不受 ambient proxy 影響

- Priority：P1
- Status：Ready
- Owner：待指定
- 背景：2026-07-28 `npm test` 為 122/133；11 項 `test/web.test.js` 均在 fetch localhost 時收到 `Proxy response (403) !== 200 when HTTP Tunneling`。其他 122 項通過，失敗並非 application assertion。
- Problem：測試依賴 shell／npm proxy environment，造成 localhost integration test 非 hermetic，也可能掩蓋真實 Web regression。
- Scope：確認 root cause、讓 loopback test 明確 bypass proxy、加入 regression coverage、更新 Runbook。
- Constraints：不得清除或曝光使用者 proxy credentials；不得讓 production external fetch 繞過既有企業 proxy policy。
- Acceptance criteria：
  - 在有 `HTTP_PROXY`／`HTTPS_PROXY` 的測試環境仍可完成 loopback Web tests。
  - External HTTP client 的 proxy／network policy 行為不因修復意外改變。
  - `npm test` 133/133 通過。
  - 記錄 Node／OS／proxy variables 是否存在的低敏感度驗收摘要。
- Evidence：Before／after test output、targeted Web test、full suite。

### BT-P1-002 — 建立 local-first 可觀測性

- Priority：P1
- Status：Proposed
- Owner：待指定
- 背景：現有 `/health` 與 text log 可提供基本資訊，但沒有一致 event schema、歷史成功率、parser failure rate 或 queue 趨勢。
- Scope：structured logs、本機 operations page、source／parser／notification／update metrics、SLO 與 diagnostics summary。
- Privacy：預設不上傳外部 telemetry；任何 opt-in 方案須另立 PRD／threat model。
- Acceptance criteria：
  - 每個 operation 有 correlation ID、component、source、status、duration、safe error class。
  - UI 可查最後成功、連續失敗、parse failure、queue、stale／archived counts。
  - Runbook 能以這些資料完成三個演練：source parser failure、notification failure、stale data。
  - Diagnostics 仍不含 credentials、full URLs、logs 或 product history。

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
