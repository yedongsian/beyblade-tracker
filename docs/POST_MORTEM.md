# Incident Management and Post-mortem

> 狀態：Active
> 最後更新：2026-07-29

## 1. 目前紀錄

截至 2026-07-28，專案紀錄中**沒有已確認的重大 production incident 或完成的 post-mortem**。

已知的 Takara Queue-it 是外部存取限制；X API 未啟用是產品安全預設。2026-07-28 Local Web 測試受 ambient proxy 影響屬 test-environment issue，已於 2026-07-29 由 `BT-P1-001` 修正，並非 production incident。

## 2. 何時宣告 Incident

符合任一條件即建立 Incident ID `INC-YYYYMMDD-NN`：

- 使用者資料遺失、損壞或 backup／restore 無法恢復。
- Token、Webhook、signing key 或其他秘密可能外洩。
- 系統在未核准情況下存取來源、付費 API 或外送資料。
- 大量重複通知、錯誤購買狀態或 stale Offer 被顯示為 fresh purchasable。
- 所有主要來源、Web UI、更新或 migration 長時間不可用。
- Release／update／rollback 造成無法啟動或資料不相容。
- 任何需要 emergency network pause、版本 rollback 或 DB restore 的非演練事件。

## 3. Severity

| Severity | 定義 | 初始回應目標 |
|---|---|---|
| SEV-1 | 資料／秘密風險、未授權外連、廣泛不可用且無安全 workaround | 立即停止風險行為；Owner 儘速接手 |
| SEV-2 | 主要功能不可用、錯誤通知／資料新鮮度影響明顯，但可安全 workaround | 同日 triage |
| SEV-3 | 局部來源／功能退化，核心資料與安全無風險 | 下一個工作週期處理 |

## 4. Incident 流程

1. **Detect／declare**：建立 ID、UTC start、severity、reporter、version、schema。
2. **Contain**：必要時 network pause、stop service、disable source；先保護資料與使用者。
3. **Preserve evidence**：建立一致性 backup；保存低敏感度 health／error 摘要，不覆寫原始 DB。
4. **Communicate**：記錄 impact、current status、next update；single-user 專案至少通知 Owner。
5. **Recover**：採最小安全修復、rollback 或 restore；每步可逆且有驗證。
6. **Validate**：health、DB integrity、FK、counts、source／notification、regression tests。
7. **Close**：記錄 end time、residual risk、follow-up tickets。
8. **Post-mortem**：SEV-1／2 或任何 restore／rollback 事件在五個工作日內完成。

## 5. Blameless 原則

Post-mortem 聚焦系統條件、決策資訊、控制缺口與可驗證改善，不把個人失誤當 root cause。使用「哪個 guardrail 缺失，使這個行為能造成影響」取代「誰做錯」。

## 6. Post-mortem 模板

```markdown
# INC-YYYYMMDD-NN — <事件名稱>

## Metadata

- Severity：
- Status：Draft／Reviewed／Closed
- Start／Detect／Mitigate／End（UTC）：
- Duration：
- Affected version／schema：
- Incident owner：
- Reviewers：
- Related Ticket／PR／release：

## Executive summary

用非技術語言說明發生什麼事、影響誰、如何恢復。

## Impact

- 使用者影響：
- 資料／privacy／security impact：
- Affected sources／channels：
- Incorrect／lost／delayed records：

## Detection

如何發現；哪個 signal 應更早發現但沒有。

## Timeline（UTC）

| Time | Event／decision／evidence |
|---|---|
| | |

## Technical narrative

以資料流說明 failure 如何產生與擴散。

## Root cause

可由 evidence 支持的直接原因與系統原因；未知處明確標示。

## Contributing factors

-

## What worked

-

## What did not work

-

## Recovery and verification

列出 backup、rollback／restore、health、DB integrity、tests 及使用者驗證。

## Corrective actions

| Ticket | Priority | Owner | Due | 驗收條件 |
|---|---|---|---|---|
| | | | | |

## Lessons and policy changes

需要更新的 PRD／Tech Spec／Runbook／release gate。

## Evidence handling

說明 evidence 位置；不得貼 secrets、full private URLs 或 personal data。
```

## 7. 結案條件

- Impact、timeline 與 root cause 有證據支持，未知處未被猜測填補。
- Recovery 已驗證，沒有未記錄 residual risk。
- 每個 corrective action 有 Ticket、priority、owner 與可驗收條件。
- 相關 Runbook、spec、test、alert 或 release gate 已更新。
- Owner 與至少一位 reviewer 確認。
