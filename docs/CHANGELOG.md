# Changelog

格式參考 Keep a Changelog；本專案目前使用 semantic version `1.0.0`。Git 在 2026-07-16 才建立，因此更早的開發歷史只以現存文件為準。

## [Unreleased]

### Documentation

- 建立 canonical `docs/` 文件中心與治理規則。
- 新增 PRD、Tech Spec、API Spec、Data Schema、Runbook、Ticket backlog、Post-mortem 制度及 PR template。
- 合併 Phase 0–7 歷史與 Phase 7 後暫停／代辦順序。
- 記錄 2026-07-28 ambient proxy 導致 11 項 Local Web tests 無法連線 localhost，建立 `BT-P1-001`。

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
