// The template is a GitHub Issue *Form* (.github/ISSUE_TEMPLATE/bug_report.yml), which has no
// free-form body: every field is addressed by its own `id`, so a `body=` parameter binds to
// nothing and is silently discarded. Observed on the live form - the old
// `/issues/new/choose?title=&body=` link filled the title and left 錯誤代碼 and App 版本 empty,
// which are the two fields BT-UX-002 exists to prefill.
//
// The picker does carry its query string through to the template, so linking straight at the
// template is for directness rather than necessity: it drops a click and makes the parameter
// contract visible at the call site.
const ISSUE_FORM_TEMPLATE = 'bug_report.yml';
const ISSUE_FORM_URL = 'https://github.com/yedongsian/beyblade-tracker/issues/new';

const definitions = [
  ['BT-INS-001', '安裝無法完成', '安裝器無法寫入使用者安裝目錄。', ['關閉舊安裝器後再試一次', '確認磁碟空間與防毒軟體設定']],
  ['BT-INS-002', '安裝檔不完整', '安裝後的版本資料不完整。', ['重新下載正式安裝器並重新安裝']],
  ['BT-INS-003', '安裝器無法驗證', '安裝器簽章無法驗證。', ['停止安裝', '只從正式 GitHub Release 重新下載']],
  ['BT-LCH-001', '找不到目前版本', 'Beyblade Tracker 找不到目前安裝版本。', ['重新安裝相同或更新版本']],
  ['BT-LCH-002', '找不到執行環境', 'Beyblade Tracker 找不到內建執行環境。', ['重新安裝', '檢查防毒軟體是否隔離檔案']],
  ['BT-LCH-003', '背景服務啟動失敗', 'Beyblade Tracker 無法完成背景服務啟動。', ['查看服務狀態', '稍後再試一次']],
  ['BT-LCH-004', '等待服務逾時', 'Beyblade Tracker 等待服務回應逾時。', ['等候一分鐘後再試', '確認連接埠未被其他程式占用']],
  ['BT-LCH-005', '無法開啟管理頁', '背景服務已啟動，但無法開啟本機管理頁。', ['稍後再試一次', '查看服務狀態']],
  ['BT-LCH-999', '發生未預期的錯誤', 'Beyblade Tracker 發生未預期的內部錯誤。', ['稍後再試一次', '複製錯誤資訊後回報']],
  ['BT-UPD-001', '尚未設定更新來源', '正式更新來源尚未設定。', ['到正式 GitHub Releases 手動下載']],
  ['BT-UPD-002', '無法取得更新資訊', '無法取得更新資訊。', ['確認網路與 network switch 後再試']],
  ['BT-UPD-003', '更新無法驗證', '更新資訊或發行者簽章無法驗證。', ['停止更新並保留目前版本']],
  ['BT-UPD-004', '更新檔案不符', '更新安裝器的 SHA-256 不符。', ['刪除本次下載並停止更新']],
  ['BT-UPD-005', '更新安裝失敗', '已驗證的更新安裝器無法完成安裝。', ['重新啟動 Windows 後再試']],
  ['BT-UPD-006', '更新後檢查失敗', '更新後的健康檢查失敗。', ['選擇 rollback', '保留更新前 backup']],
  ['BT-UPD-007', 'Rollback 失敗', '無法完成 rollback。', ['停止 Tracker 後回報']],
  ['BT-UPD-008', '更新未生效', '更新已安裝，但服務仍在執行舊版。', ['從開始功能表重新啟動 Tracker', '若版本仍未改變請回報']],
  ['BT-DAT-001', '資料庫完整性失敗', '資料庫完整性檢查失敗。', ['停止服務', '保留資料庫與備份後回報']],
  ['BT-DAT-002', '資料庫版本不相容', '資料庫版本比目前程式支援的版本新。', ['安裝相同或更新版本']],
  ['BT-DAT-003', '備份或還原失敗', '備份或還原驗證失敗。', ['不要覆蓋現有資料庫', '改用另一份已驗證備份']],
  ['BT-DAT-004', '移機檔無法驗證', '移機檔的內容驗證失敗。', ['重新匯出移機檔']],
  ['BT-DAT-005', '服務仍在執行', '還原或匯入前必須先停止背景服務。', ['先停止背景追蹤再試']],
  ['BT-NET-001', '外部網路已暫停', '外部網路已由使用者暫停。', ['確認原因後在來源管理恢復']],
  ['BT-NET-002', '外部網路被鎖定', '外部網路已被維護者設定鎖定。', ['聯絡維護者']],
  ['BT-BRS-001', '找不到支援的 Chrome', '找不到支援的 Google Chrome。', ['安裝官方 Chrome']],
  ['BT-BRS-002', '瀏覽器受到限制', '頁面受到 CAPTCHA、Queue-it 或登入限制。', ['停止重試並等待']],
  ['BT-SRC-001', '來源持續失敗', '單一來源連續失敗。', ['到來源管理執行一次測試']],
  ['BT-SRC-002', '來源無法辨識商品', '來源頁可讀，但無法辨識商品。', ['停用來源後回報頁面類型']],
  ['BT-SRC-003', '仍在冷卻中', '這個來源剛剛才手動檢查過。', ['稍候片刻再按一次「立即重新檢查」', '排程仍會依原本的週期自動檢查']],
  ['BT-SRC-004', '找不到這間商店', '要探索的商店已不存在。', ['重新整理來源管理頁', '若該商店已被刪除，請重新加入']],
  ['BT-SRC-005', '探索已在執行中', '這間商店已有一個探索工作正在進行。', ['等待目前的探索完成後再試', '探索需要數分鐘，期間不必重複按']],
  ['BT-SRC-006', '沒有可用的探索網址', '這間商店沒有設定可供探索的網址。', ['到來源管理加入一個分類頁或商品頁']],
  ['BT-SRC-007', '探索網址超出商店範圍', '探索網址不在這間商店的網域內。', ['改用同一個網域下的網址']],
  ['BT-NTF-001', 'Telegram 設定失敗', 'Telegram 設定或測試失敗。', ['確認 Bot、Chat ID 與網路設定']],
  ['BT-NTF-002', 'Discord Webhook 無法使用', 'Discord Webhook 被拒絕或已失效。', ['重新建立 Webhook，且不要公開完整網址']],
];

export const ERROR_REGISTRY = Object.freeze(Object.fromEntries(definitions.map(([code, title, message, recovery]) => [
  code, Object.freeze({ code, title, message, recovery }),
])));

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_REGISTRY));

/**
 * The code is what the user sees; the message is what the log and a diagnostics export keep. Passing
 * both means a guard can stay descriptive internally without that sentence becoming the public
 * contract - which is the mistake D-8 was made of.
 */
export function trackerError(code, message = code) {
  const error = new Error(message);
  error.code = ERROR_REGISTRY[code] ? code : 'BT-LCH-999';
  return error;
}

export function errorCodeFor(error) {
  if (ERROR_REGISTRY[error?.code]) return error.code;
  const message = String(error?.message || '');
  if (/NETWORK_ENABLED=0/i.test(message)) return 'BT-NET-002';
  if (/外部網路已暫停|network.*paused/i.test(message)) return 'BT-NET-001';
  if (/更新.*簽章|manifest.*signature/i.test(message)) return 'BT-UPD-003';
  if (/SHA-256/i.test(message)) return 'BT-UPD-004';
  if (/更新.*來源尚未設定/i.test(message)) return 'BT-UPD-001';
  if (/更新.*取得|update.*fetch/i.test(message)) return 'BT-UPD-002';
  return 'BT-LCH-999';
}

export function errorEnvelope(error, { appVersion = 'unknown', supportRef, timestamp = new Date().toISOString() } = {}) {
  const code = errorCodeFor(error);
  const definition = ERROR_REGISTRY[code];
  return {
    code,
    title: definition.title,
    message: definition.message,
    recovery: definition.recovery,
    appVersion,
    timestamp,
    supportRef: String(supportRef || 'unavailable').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unavailable',
  };
}

/**
 * Only `error_code` and `app_version` are prefilled: they are the two the user cannot be expected
 * to retype accurately, and they are the two field ids the form actually exposes. The support
 * reference has no field of its own and is left to the copy action rather than forced into an
 * unrelated one. Nothing user- or system-derived beyond these is sent, so the URL cannot leak a
 * path, token or stack the way a free-form body could.
 */
export function issueReportUrl({ code, appVersion }) {
  const query = new URLSearchParams({
    template: ISSUE_FORM_TEMPLATE,
    title: `[問題回報] ${code}`,
    error_code: code,
    app_version: appVersion,
  });
  return `${ISSUE_FORM_URL}?${query}`;
}
