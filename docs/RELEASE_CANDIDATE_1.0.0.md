# Windows Release Candidate 1.0.0 重建紀錄

重建日期：2026-08-02（UTC+08:00）
重建原因：先前的 `dist` 產物早於 `main` 合併，內容已過期，不得用於實機驗收。

## 1. 來源版本

| 項目 | 值 |
| --- | --- |
| Git commit | `2eca4c9ec818f1413307b3f6db1ac37a5be66167` |
| Commit 主旨 | Merge pull request #1 from yedongsian/codex/bt-upd-001 |
| 建置分支 | `codex/bt-api-001`（與 `main` 同一個 commit） |
| 工作區狀態 | clean（無未追蹤或未提交的變更） |
| Node | v25.7.0 |
| npm | 11.10.1 |
| Inno Setup | 7.0.2 (32-bit)，`%LOCALAPPDATA%\Programs\Inno Setup 7\ISCC.exe` |

舊 `dist` 的 `schemaVersion` 為 10，本次重建為 13，直接證實舊產物確實過期。

## 2. 建置前置閘門

依 `RELEASE_GUIDE.md` 第 1 步執行，全部通過：

| 閘門 | 結果 |
| --- | --- |
| `npm test` | 219 pass / 0 fail / 0 skipped，13.1s |
| `npm run config:check` | exit 0，3 個來源設定有效 |
| `node bin/web-smoke.js` | exit 0，16/16 路由符合預期（含 `/nope -> 404`） |

建置開始前已確認 port 8787 無監聽者、無 Beyblade Tracker 服務程序。

## 3. 產物與雜湊

| 項目 | 值 |
| --- | --- |
| 版本 | 1.0.0 |
| schemaVersion | 13 |
| Installer | `dist\windows\installer\BeybladeTracker-1.0.0-Setup.exe` |
| SHA-256 | `7794f66f018bbb285fa4a537e74e1237c3028d0665360c5ce513231c7c74eca1` |
| 大小 | 27,476,541 bytes |
| 建置時間 | 2026-08-02T02:38:59.713Z |
| Payload | `dist\windows\BeybladeTracker-1.0.0`（含 91 MB Node v25.7.0 runtime，x64） |
| Browser 策略 | `system-chrome` |

`release-manifest.json` 內的 SHA-256 已用獨立的 `Get-FileHash` 重新計算比對，兩者一致。

### Manifest 狀態

build 當下為 `publishReady=false`、`signature=null`、`installerUrl=null`，因為本機未設定 `RELEASE_BASE_URL` 與 `RELEASE_SIGNING_KEY_FILE`。之後已補上 Ed25519 簽章驗證流程，詳見第 8 節；但**仍未取得 Authenticode 憑證與正式 HTTPS 發佈站**。依 `RELEASE_GUIDE.md`，此產物只能視為**可安裝的 release candidate**，不得宣稱已啟用公開自動更新。

## 4. 封裝 E2E 測試結果

三個模式各跑一次，皆使用重建後的 installer，全部 exit 0：

| 測試 | 指令 | 結果 |
| --- | --- | --- |
| Normal packaged | `npm run test:release:windows` | PASS — 安裝、封裝服務健康、解除安裝、服務停止、使用者資料保留 |
| Stop failure | `npm run test:release:windows:stopfail` | PASS — 注入 stop 失敗後，解除安裝於 7s 內非零退出、無 UI 彈窗、保留執行中的安裝 |
| Missing launcher | `npm run test:release:windows:missing-launcher` | PASS — 缺少 launcher 時 1s 內 fail closed、無 UI、保留安裝與仍在服務 8787 的程序 |

各次 run id：

- normal：`d342e8fc6efb49228cd82c65190743cd`（service PID 26096）
- stop failure：`f5403daf437345239bfdb5deceb09918`（service PID 24252）
- missing launcher：`2beb7130090047b092f53254ebe20692`（service PID 36736）

## 5. 清理確認

三次 E2E 結束後檢查：

| 項目 | 結果 |
| --- | --- |
| Port 8787 | FREE，無 listener 也無連線 |
| 程序 | 無任何 command line 含本次三個 run id 的殘留程序；無 Beyblade Tracker 程序 |
| 暫存目錄 | 本次三個 run id 的 `-install` 與 `-user` 目錄皆已移除 |

**既有殘留（非本次造成）**：`%TEMP%` 原有 11 個 2026-07-29～07-30 的 `BeybladeTracker-E2E-*` 目錄，來自先前工作階段清理未完成的執行；本次重建前後數量與名稱完全相同，未新增也未移除。已於 2026-08-02 經確認無程序占用後全數清除，`%TEMP%` 目前無任何 `BeybladeTracker-E2E-*` 殘留。

## 6. Installer log 摘要

E2E 腳本會在收尾時刪除自己的 user root（連同 `installer.log`），因此另外執行一次隔離的安裝／解除安裝循環，把 log 寫到被刪除的目錄之外來取得。該次循環同樣通過（安裝 exit 0、健康狀態 `ok`、解除安裝 exit 0、服務停止、程式目錄移除、使用者資料保留），且自身目錄與程序皆已清理。

完整 log 保存在 `logs/release-rc-1.0.0/`（該路徑受 `.gitignore` 排除，不會進版控）。

### installer.log

- 7,345 行、656,705 bytes
- Setup 版本 Inno Setup 7.0.2 (32-bit)；Windows 10.0.26100 x64
- 安裝模式：per-user（`Administrative install mode: No`，root key `HKEY_CURRENT_USER`）
- 版本目錄並存結構正確：檔案落在 `versions\1.0.0\`
- 含 `src\db\migrations\013_operation_page_failure_count.sql`，與 schemaVersion 13 相符
- 建立 uninstall key `{9C86A9F9-41C7-49AB-B2DE-CDAAFB1EA41E}_is1`
- `Installation process succeeded.` / `Need to restart Windows? No`
- 收尾 Run entry 以 `wscript.exe launcher.vbs restart noninteractive` 啟動服務——非互動模式，無視窗
- **無任何真實錯誤**：全文比對 exception/failed/abort/denied/rolling back 後，剩餘命中只是檔名本身含 "error"（如 `parse5\...\error-codes.js`、`undici\lib\core\errors.js`），非錯誤事件

### uninstaller.log

- 1,652 行、334,373 bytes
- 10:45:05.689 → 10:45:48.439 之間有約 43 秒空窗，即解除安裝前的服務停止步驟
- 資料保留提示在 `/SUPPRESSMSGBOXES` 下 `Defaulting to Yes`，即保留使用者資料——這正是 DB 得以保存的原因
- 6 次 `Failed to delete directory (145). Will retry later.`：145 = 目錄非空，屬 Inno Setup 正常重試行為，最終已成功刪除
- `Uninstallation process succeeded.` / `Removed all? Yes` / `Need to restart Windows? No`

## 7. 結論

Release candidate 1.0.0 已從合併後的 `main` 重建完成，前置閘門、三項封裝 E2E 與清理檢查全部通過，版本、雜湊與 log 摘要已記錄。**符合進入 Windows 實機驗收的條件**，但仍受第 3 節與第 8 節的簽章限制：實機驗收只能涵蓋安裝／執行／解除安裝，無法涵蓋真正的線上更新與 SmartScreen 體驗。

## 8. 簽章現況（2026-08-02）

本專案有**兩層互相獨立**的簽章，缺一不可，兩者用途不同：

| 層級 | 保護對象 | 現況 |
| --- | --- | --- |
| Ed25519 manifest 簽章 | 更新描述與下載內容完整性 | **管線已驗證可用**（見下） |
| Windows Authenticode | `Setup.exe` 本身、SmartScreen 信任 | **尚未取得憑證**，屬採購／法務工作 |

### 8.1 Ed25519 manifest 簽章

金鑰已產生並存放在版控之外：

| 檔案 | 路徑 |
| --- | --- |
| 私鑰（PKCS#8） | `C:\Users\yedon\.beyblade-release\manifest-signing-key.pem` |
| 公鑰（SPKI） | `C:\Users\yedon\.beyblade-release\manifest-public-key.pem` |

公鑰內容（即 `UPDATE_PUBLIC_KEY`）：

```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWgLNbIODFU0bjcVDY8et0xfRR+l18uUnqDGyHIDWX7s=
-----END PUBLIC KEY-----
```

因為當時尚無 HTTPS 發佈站，簽章以保留網域 `https://placeholder.invalid/beyblade-tracker`（RFC 2606 `.invalid`）作為 base URL，**純粹用來驗證簽章／驗章管線可用**。驗證結果：

- 簽章與 `validateUpdateManifest()` 用戶端驗章：PASS
- 負向控制：換一把公鑰 → 被拒（`BT-UPD-003`）
- 竄改控制：改動已簽章的 `sha256` 欄位 → 被拒（`BT-UPD-003`）
- 另已實測 Node 內建 `.env` 載入器可承載雙引號多行 PEM，`UPDATE_PUBLIC_KEY` 可直接用 `.env` 傳遞

補簽時**刻意不重跑 build**：重建會產生新的 installer 與新的 SHA-256，使本文件第 3、4 節已驗證的雜湊與 E2E 結果失效。補簽前已比對 installer 位元組雜湊未變。

> **警告**：`dist\windows\release-manifest.json` 目前是 `publishReady=true`，但 `installerUrl` 指向不存在的 `.invalid` 網域。**此 manifest 絕不可公開發佈**。取得真正的 HTTPS 發佈站後，設定 `RELEASE_BASE_URL` 與 `RELEASE_SIGNING_KEY_FILE` 重跑 `npm run release:windows`，並以新產物重新執行第 4 節的三項 E2E 與第 3 節的雜湊記錄。

### 8.2 Authenticode（尚未完成）

需要組織持有的程式碼簽章憑證，無法在本機自行產生；自簽憑證不會被 SmartScreen 信任，沒有實質意義。取得憑證後的步驟見 `RELEASE_GUIDE.md`。此為公開發佈閘門，不是 Phase 7 的程式缺口。
