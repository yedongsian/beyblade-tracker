# API Specification — Local Web API

> 狀態：Active／As-built
> 對應版本：1.0.0
> Base URL：`http://127.0.0.1:8787`
> 最後更新：2026-07-28

## 1. 定位與相容性

本 API 供同一個 Local Web App 使用，不是公開、多租戶或遠端整合 API。目前沒有 `/v1` version prefix，也沒有向第三方承諾 backward compatibility。若未來公開，應先新增版本、authentication、authorization、rate limit、CORS 與正式 OpenAPI contract；不得直接暴露現有 server。

## 2. 通用規則

### Network boundary

- Server 預設只監聽 `127.0.0.1`。
- `Host` 只接受 `127.0.0.1`、`localhost`、`[::1]`。
- Mutation request 若有 `Origin`，hostname 必須是 loopback。
- 所有 `POST`、`PATCH`、`PUT`、`DELETE` 必須帶 UI session 產生的 `X-CSRF-Token`。
- `NETWORK_ENABLED=0` 或 UI network switch 關閉時，需要外部網路的 endpoint 會失敗。

### Content type

- JSON endpoint request：`Content-Type: application/json`。
- 一般 JSON request body 上限 32 KiB。
- Transfer import body 上限 160 MiB，payload 是 base64 gzip bundle。
- JSON response：`application/json; charset=utf-8`。
- Export response：`application/gzip`。

### Status code

| Code | 意義 |
|---|---|
| 200 | 成功查詢或同步 mutation。 |
| 201 | Resource 已建立，例如 source、watchlist、split product。 |
| 202 | 非同步工作已受理，例如 monitor request、transfer import、update apply。 |
| 400 | 現有實作將 validation、policy、network 及多數 internal error 統一回傳為 400。 |
| 404 | Route、Product 或 error message 被辨識為 not found。 |

錯誤 body 為安全 envelope：`{"status":"error","error":{"code":"BT-<AREA>-<NNN>","message":"<localized message>","recovery":[],"appVersion":"…","timestamp":"…","supportRef":"…"}}`。未知 exception 使用 `BT-LCH-999`；不得回傳原始 exception、stack、secret、private URL 或 path。

## 3. HTML routes

| Method | Path | 說明 |
|---|---|---|
| GET | `/` | Overview 與 health summary。 |
| GET | `/products` | Product 列表。 |
| GET | `/products/:id` | Product、Offer、price／stock timeline 與 identity actions。 |
| GET | `/offers` | Offer 與 freshness／archive 狀態。 |
| GET | `/events` | 最近 Event。 |
| GET | `/catalog` | Catalog、evidence、aliases、parts、terminology review。 |
| GET | `/watchlist` | Watchlist、alerts、official source preview。 |
| GET | `/community` | Unverified community clues 與 source filters。 |
| GET | `/review?status=` | Candidate Review Queue；status 預設 `pending`。 |
| GET | `/exclusions?status=` | Listing exclusion review；status 預設 `all`。 |
| GET | `/sources` | Source、Discovery settings、network control。 |
| GET | `/settings` | Language、notification、transfer、diagnostics、update settings。 |
| GET | `/privacy` | Privacy policy。 |
| GET | `/source-policy` | Source use policy。 |

## 4. Health

### `GET /health`

回傳整體 status、network state、release、browser、UTC time、counts 與每來源健康度。當任一 enabled source 的 `consecutive_failures >= 3` 時 `status=degraded`，否則為 `ok`。

主要 response fields：

```json
{
  "status": "ok",
  "network": { "enabled": true, "reason": null },
  "release": {},
  "browser": {},
  "time": "2026-07-28T00:00:00.000Z",
  "counts": {
    "sources": 3,
    "enabledSources": 3,
    "products": 0,
    "offers": 0,
    "purchasableOffers": 0,
    "events": 0,
    "pendingNotifications": 0,
    "pendingCandidates": 0,
    "watchlists": 0,
    "officialAnnouncements": 0,
    "communitySources": 1,
    "communityPosts": 0,
    "communitySourcesNeedingSetup": 1
  },
  "sources": []
}
```

## 5. Read APIs

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/sources` | — | `{sources: ManagedSource[]}` |
| GET | `/api/settings` | — | Sanitized user settings；不得含 Telegram plaintext。 |
| GET | `/api/candidates` | `status`，預設 `pending` | `{candidates: Candidate[]}` |
| GET | `/api/terminology` | `status`，預設 `pending` | `{terms: TerminologyReview[]}` |
| GET | `/api/watchlists` | — | `{watchlists: Watchlist[], alerts: WatchlistAlert[]}` |
| GET | `/api/official-sources` | — | `{sources: OfficialSource[], announcements: OfficialAnnouncement[]}` |
| GET | `/api/community` | — | `{sources: CommunitySource[], posts: CommunityPost[]}` |
| GET | `/api/update` | — | 驗證 stable manifest，回傳 update availability、release notes、publisher、size、manifest digest 與 defer state；只檢查，不下載。 |

## 6. Settings、privacy 與 notification

| Method | Path | Request | Response／副作用 |
|---|---|---|---|
| POST | `/api/settings` | Onboarding fields：language、notification、scan／retention 等 | `{settings}` |
| POST | `/api/settings/language` | `{language:"zh-TW"|"ja"|"en"}` | `{language}` |
| POST | `/api/privacy` | `{privacyAccepted,sourcePolicyAccepted,diagnosticsConsent}` | `{settings}` |
| POST | `/api/notifications/telegram` | `{token,chatId,test?}` | DPAPI 保存；`test=true` 時送測試訊息。 |
| POST | `/api/notifications/telegram/test` | `{}` | 使用已保存憑證送測試訊息。 |
| DELETE | `/api/notifications/telegram` | — | 清除 DPAPI Telegram 憑證。 |

Telegram endpoint 只有在 server 提供 `secretStore` 時可用。Token／chat ID 不得出現在 settings GET response、DB、log、diagnostics 或 transfer bundle。

## 7. Source 與 Discovery

| Method | Path | Request | 成功結果 |
|---|---|---|---|
| POST | `/api/sources/preview` | `{url}` | 安全 preview、normalized URL／domain、candidate 與 budget。 |
| POST | `/api/sources` | `{url,name?,confirmed:true,discoveryOnly?}` | 201；建立／重用 Site、Source、Seed。 |
| POST | `/api/sources/:id/test` | `{}` | Connector test 與 item count。 |
| POST | `/api/sources/:id/check-now` | `{}` | 202；建立 `monitor_requests` queued row。 |
| PATCH | `/api/sources/:id` | `{enabled:boolean}` | 啟用／停用；保留歷史。 |
| DELETE | `/api/sources/:id` | — | 語意等同 disable，不做 hard delete。 |
| POST | `/api/sites/:id/discover` | `{budget?:{...}}` | `{run}`；同步執行受控 Discovery。 |
| PATCH | `/api/sites/:id/discovery-settings` | Budget、interval、include／exclude terms | 更新 Discovery settings／Recipe。 |
| PATCH | `/api/network` | `{enabled:boolean,reason?}` | `{network}`；`.env` hard lock 優先。 |

Discovery budget fields 包含 `maxPages`、`maxDepth`、`maxSeconds`、`maxBytes`；實作亦保存 browser pages、concurrency 與 minimum interval 的 server-side limits。

## 8. Review APIs

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/candidates/:id/review` | `{action:"approve"|"defer"|"exclude",note?}` | `{candidate}` |
| POST | `/api/candidates/review` | `{ids:number[],action,note?}` | `{candidates}` |
| POST | `/api/terminology/:id/review` | `{action:"approve"|"exclude"|"reopen",value?,note?}` | `{term}` |
| POST | `/api/exclusions/:id` | `{action:"confirm"|"allow"|"reopen",note?}` | `{exclusion}` |

Candidate approve 可能建立 Product／Offer／Event；defer、exclude 與 reopen 應保留原始 evidence 與 review history。

## 9. Product identity

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/products/:id/split` | `{offerIds:number[],name?,note?}` | 201；新 Product、移動的 Offers 及 audit。不得移走原 Product 全部 Offers。 |
| POST | `/api/products/merge` | `{sourceProductId,targetProductId,note?}` | 合併結果與 audit；source／target 不得相同。 |

所有 split／merge 都需保存 before／after snapshot、Offer IDs、note 與 timestamp。

## 10. Watchlist、official 與 community

| Method | Path | Request | Response／限制 |
|---|---|---|---|
| POST | `/api/watchlists` | name、target、match mode、keywords、exclude terms、notification events 等 | 201 `{watchlist,message}` |
| PATCH | `/api/watchlists/:id` | `{enabled:boolean}` | `{watchlist}` |
| DELETE | `/api/watchlists/:id` | — | 刪除 Watchlist 及 cascade child rows。 |
| POST | `/api/official-sources/:id/confirm` | `{}` | 確認 first-scan preview 並回傳 message。 |
| PATCH | `/api/community-sources/:id` | muted、retention、exclude terms、sensitive／spam filters | `{source}`；不得藉此自動開啟付費 access。 |

## 11. Transfer、diagnostics 與 update

| Method | Path | Request | Response／副作用 |
|---|---|---|---|
| POST | `/api/transfer/export` | — | gzip `.beyblade-transfer` download；含 DB／sources hashes，不含 secrets。 |
| POST | `/api/transfer/import` | `{data:"<base64>"}` | 202 `{staged,restartRequired:true}`；驗證後 staged，稍後要求 restart。 |
| POST | `/api/diagnostics/export` | — | gzip diagnostics；需使用者 consent，排除 credentials、URLs、logs 與 product history。 |
| GET | `/api/update` | — | 驗證 manifest 並回傳 update availability。 |
| GET | `/api/update/status` | — | 回傳最近一次自動或手動檢查的安全摘要、defer、post-update health 與 rollback runner 結果，供 Settings UI 顯示；不會發出網路請求。 |
| POST | `/api/update/defer` | `{targetVersion,manifestDigest}` | 保存該已驗證版本的 defer 選擇；不下載。 |
| POST | `/api/update/apply` | `{confirmed:true,targetVersion,manifestDigest}` | 202；確認值必須匹配當前 signed manifest，才開始下載、驗證、備份與 installer launch；同時間只允許一個 operation。 |
| GET | `/api/update/progress/:operationId` | — | 只回傳本機 operation 的安全 phase、bytes progress、target version 或公開錯誤代碼。 |
| POST | `/api/update/rollback` | `{}` | 回傳 `202` 後由服務安全停機，再由外部 rollback runner 還原 update 前 backup 與切回前一個 version pointer；不會在仍開啟 DB 的 Web process 中直接還原。 |

## 12. API 已知限制與後續改善

- Error mapping 尚未細分 validation 400、policy 403／409、not found 404 與 internal 500；目前多數 exception 都回傳 400。
- 沒有 formal OpenAPI document；本檔是現況 contract。
- 沒有 remote authentication／authorization，因現行 boundary 是 loopback single-user。
- 沒有 idempotency key；部分 mutation 依 DB unique constraints 或業務規則去重。
- `DELETE /api/sources/:id` 實際為 disable，路由語意容易誤解，未來若變更需先提供 compatibility plan。

## Deferred update control

`POST /api/update/resume` accepts `{}`, clears the saved defer decision for the currently verified manifest, and returns `{resumed:true,state,deferred:false}`. It never downloads or installs an update.

`GET /api/update/status` returns the last verified result without starting a network request. While an apply is active it also returns an allowlisted `operation` object with only `id`, `targetVersion`, `phase`, `received`, `total`, and optional `errorCode`; it never includes installer locations, backup locations, manifest URLs, signatures, or exception details.

`GET /api/update` records a new check only after a successful verified response. `BT-UPD-002` and `BT-UPD-003` responses leave the stored verified result and `lastCheckedAt` unchanged.

## 13. Update error contract

此 error envelope 與 update consent API 已實作為下一個 release candidate 行為；仍不是 1.0.0 已發布能力。

### Error response

Local UI API 應以中央 registry 產生 stable error envelope：

```json
{
  "status": "error",
  "error": {
    "code": "BT-UPD-003",
    "message": "更新簽章無法驗證。",
    "recovery": ["保留目前版本", "問題回報"],
    "supportRef": "safe-correlation-id",
    "timestamp": "2026-07-28T00:00:00.000Z"
  }
}
```

HTTP status 應區分 validation、policy、conflict、not found 與 internal failure；不再把多數 exception 都折成 400。

### `GET /api/update`

成功且有新版時至少回傳：current version、target version、channel、release notes、published time、download size、publisher、manifest digest、是否已 defer。此 endpoint 只檢查，不下載 installer。

### `POST /api/update/apply`

預期 request：

```json
{
  "confirmed": true,
  "targetVersion": "1.1.0",
  "manifestDigest": "sha256-of-confirmed-manifest"
}
```

The server first validates the confirmation shape (`confirmed:true`, semantic target version, 64-hex manifest digest), then synchronously reserves a `checking` operation. A concurrent valid request returns that operation ID with `inProgress:true`; it does not start another manifest request, download, backup, or installer launch. Safe summaries omit URLs, paths, signatures, and exception details. Terminal progress is retained for ten minutes, capped at twenty records, then returns 404.

`checking` is an active phase with `received:0` and `total:0`; clients should show it as indeterminate rather than as a 0% download. The phase transitions to `downloading`, then `installing`, and finally `completed` or `failed`.

Server 必須拒絕 `confirmed != true`、target／digest 不符、network disabled、signature／hash 無效或 backup 失敗。UI 的 background check 不可直接呼叫 apply；使用者 confirmation 也不能被保存為未來版本的永久同意。
