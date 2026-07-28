# GitHub Support and Issue Intake

> 決策：使用與程式碼相同的公開 GitHub repository，啟用 Issues 與繁中 Issue Form
> 狀態：In implementation；repository 與表單已建立，通知及 end-to-end 驗收待完成
> 最後更新：2026-07-29

## 1. 使用者體驗

一般使用者不需要懂 Git，只需要免費 GitHub 帳號：

1. 從 App 的「問題回報」或使用教學開啟 Issues 頁。
2. 選擇「問題回報」。
3. 依表單填寫錯誤代碼、版本與發生步驟。
4. 送出後在 GitHub 或 Email 接收 Developer 回覆。

Repository 公開後，Issue 內容也會公開。表單必須在上方提醒：不要貼 Token、Webhook、`.env`、完整資料庫、移機檔、完整 log、private source URL 或個人資料。

## 2. Repository owner 設定

1. 公開 repository：[yedongsian/beyblade-tracker](https://github.com/yedongsian/beyblade-tracker)。
2. 到 `Settings → General → Features` 啟用 Issues，且不要限制為 Collaborators only。
3. 建立 `.github/ISSUE_TEMPLATE/bug_report.yml` 繁中 Issue Form。
4. 建立 `.github/ISSUE_TEMPLATE/config.yml`，建議關閉 blank issue，減少缺少資訊的回報。
5. 建立 labels：`bug`、`needs-triage`、`installer`、`launcher`、`update`、`source`、`notification`、`data-safety`。
6. Repository 右上 `Watch → Custom → Issues`。
7. GitHub `Settings → Notifications` 啟用 `On GitHub` 與 `Email`，確認接收信箱已驗證。
8. 用另一個一般帳號完成一次 end-to-end 測試：建立 Issue、owner 收到通知、回覆、使用者收到回覆、關閉。

GitHub 官方文件：

- [建立 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)
- [設定 Issue templates／forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
- [設定 repository notifications](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)
- [Repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)

## 3. Issue Form 欄位規格

| 欄位 | 類型 | 必填 | 說明 |
|---|---|---:|---|
| 問題類型 | Dropdown | 是 | 安裝、啟動、更新、來源、通知、資料／移機、其他。 |
| 錯誤代碼 | Input | 否 | 格式 `BT-XXX-NNN`；現行版本無代碼時填「未顯示」。 |
| App version | Input | 是 | 從設定或錯誤對話框複製。 |
| Windows version | Dropdown／Input | 是 | Windows 10／11 與可用的 build。 |
| 發生步驟 | Textarea | 是 | 依順序描述點了什麼。 |
| 預期結果 | Textarea | 是 | 原本預期發生什麼。 |
| 實際結果 | Textarea | 是 | 實際畫面；不得貼 secrets。 |
| 是否可重現 | Dropdown | 是 | 每次、有時、只發生一次。 |
| 診斷資料 | Textarea／attachment guidance | 否 | 只接受 App 匯出的低敏感度 diagnostics。 |
| Privacy confirmation | Checkbox | 是 | 確認未上傳敏感資料，理解 Issue 為公開。 |

Form 自動加上 `bug`、`needs-triage` labels。Title 可要求使用者以 `[問題類型] 簡短描述` 填寫；不要求使用者判斷 priority 或 severity。

## 4. Maintainer triage

1. 一個工作日內確認收到，先檢查是否涉及 data loss、secret exposure 或 unauthorized network。
2. 將使用者錯誤代碼對應到 [Error Code Catalog](ERROR_CODES.md)。
3. 缺資料時只索取 App version、Windows version、support reference 與安全 diagnostics。
4. 可重現 Bug 建立／連結正式 `BT-*` Ticket；security／privacy 問題不要在 public Issue 要求更多敏感資料。
5. 修正後在 Issue 說明 affected version、fixed version、workaround、verification；發布後關閉。

## 5. 通知行為

只建立 repository 並啟用 Issues，不保證每次都寄 Email。Owner 必須 watch Issues，並在個人 notification settings 啟用 Email。完成後：

- 新 Issue 與後續留言會出現在 GitHub notifications inbox。
- Email 是否寄送取決於 owner 的 verified email 與 watching notification delivery 設定。
- 使用者建立 Issue 後會自動訂閱該 conversation；使用者是否收到 Email同樣取決於其個人通知設定。

## 6. 發布前必填

- Public repository URL：<https://github.com/yedongsian/beyblade-tracker>
- Issues URL：<https://github.com/yedongsian/beyblade-tracker/issues>
- Release URL：<https://github.com/yedongsian/beyblade-tracker/releases>
- Repository owner／triage owner：`yedongsian`（待確認日常 triage owner 是否相同）
- Verified notification email：只記錄「已驗證」，不要把私人 Email 寫入 repository。
