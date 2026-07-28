# Pull Request Description

> 本檔同時保存目前文件基線變更的可用 PR 描述，以及後續 PR 模板。
> 最後更新：2026-07-28

## 1. 目前文件基線變更（Draft PR Description）

### Title

`docs: establish canonical product and engineering documentation`

### Summary

建立 `docs/` 正式文件中心，將既有 README、Roadmap、TODO、Project Memory、安裝、發布、疑難排解、政策文件、migration、Local Web routes、測試與 Git history 整理為可供產品、工程、維運及驗收團隊長期維護的文件基線。

### Why

原始資訊散落且重複，已完成能力、未完成外部驗收與未來規劃容易混淆。這次變更定義單一來源、文件 owner、更新規則、Ticket 驗收、Incident／Post-mortem 流程與 release handoff，避免後續團隊重做 Phase 0–7 或把未通過的項目誤標完成。

### Changes

- 新增 PRD、Roadmap、Tech Spec、API Spec、Data Schema、Runbook。
- 新增 canonical Tickets backlog、Post-mortem 制度／模板、PR template、CHANGELOG。
- 根目錄 planning docs 改為導向 canonical docs；保留 release builder 所需的使用者發佈文件。
- 保留並合併使用者原先在 `ROADMAP.md` 新增的 Phase 7 後暫停點。
- 記錄 2026-07-28 config／service／test evidence；將 proxy 造成的 Web test failure 建立 Ticket，不誤判為已通過或 production incident。
- 納入下一公開版本的一般使用者體驗需求：雙擊安裝、固定錯誤代碼、使用者確認後更新，以及公開 GitHub Issue Form。
- 新增使用教學、錯誤代碼目錄與 GitHub Support／通知設定；正式 repository、Issues、Releases URL 建立後再補齊 `TBD`。

### Scope／risk

- Documentation only；沒有修改 source code、configuration、database、dependencies 或 release artifact。
- 主要風險是文件與實作不一致；以 route、migration、package scripts、Git history 與測試輸出交叉核對。

### Verification

- [x] 所有 Markdown internal links 可解析。
- [x] `git diff` 只包含 Markdown。
- [x] Version `1.0.0`、schema `10`、Phase 0–7、API routes 與 table names 與程式一致。
- [x] 原有 ROADMAP 未提交內容已完整納入。
- [x] 沒有 secret、private key、Token、Webhook 或 personal data。
- [x] `BT-DOC-001` 驗收完成。

### Follow-ups

- `BT-P0-001` Windows 公開發佈閘門。
- `BT-P1-001` Local Web tests ambient proxy isolation。
- `BT-P1-002` local-first observability。
- `BT-UX-001` 一般使用者雙擊安裝驗收。
- `BT-UX-002` 可見且穩定的錯誤代碼。
- `BT-UPD-001` 使用者確認後更新。
- `BT-SUP-001` 公開 GitHub Issues 與繁中表單。
- `BT-DOC-002` 補齊正式 URL 並完成使用者文件驗收。

## 2. 後續 PR 模板

```markdown
## Summary

用 2–4 句說明結果、使用者價值及做法。

## Related work

- Ticket：BT-...
- Roadmap／incident／design：

## Problem and evidence

目前行為、重現方式、數據或使用者影響。不要只寫「refactor」。

## Scope

-

## Out of scope

-

## Implementation／decision notes

重要架構選擇、替代方案與 trade-off。

## API／data compatibility

- API routes／request／response：None／說明
- Migration／schema version：None／說明
- Backward／rollback behaviour：

## Security／privacy／source-policy impact

- Secrets：
- External network／cost：
- Retention／diagnostics／transfer：
- robots／Terms／rate limit：

## Verification evidence

- [ ] Targeted tests：
- [ ] Full test suite：
- [ ] Config／health：
- [ ] DB integrity／FK（若適用）：
- [ ] Manual／UI／accessibility：
- [ ] Windows clean install／upgrade／rollback（若適用）：

## Documentation

- [ ] PRD／Roadmap／Tech Spec
- [ ] API Spec／Data Schema
- [ ] Runbook／Tickets／CHANGELOG
- [ ] User-facing README／INSTALL／policy

## Rollout

步驟、owner、monitoring、Go／No-Go gate。

## Rollback

觸發條件、命令／artifact、data compatibility、驗證。

## Risks and mitigations

| Risk | Likelihood／impact | Mitigation／signal |
|---|---|---|
| | | |

## Screenshots／logs

只附必要且已去敏感資料的 evidence。

## Acceptance

- [ ] Ticket acceptance criteria 全部有證據。
- [ ] Reviewer 已確認沒有未揭露 scope。
- [ ] Follow-up 已建立 Ticket，不以 TODO comment 代替。
```

## 3. Review 原則

- Reviewer 應驗證 outcome，不只檢查 diff。
- API／schema／security／release change 缺少對應 spec 或 rollback 時不可核准。
- 測試因環境失敗不可直接 waive；要先證明 environment cause 並建立／完成 Ticket。
- PR 不是新的 source of truth；合併後的決策必須回寫 canonical docs。
