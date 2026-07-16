# Beyblade 商品追蹤器 (Beyblade Tracker)

一個可在單台 Windows 電腦長時間運行的獨立專案，定期擷取多個商店的戰鬥陀螺商品資訊，
把同一商品在不同商店的刊登合併，偵測「新品出現」與「變成可購買」事件，
彙整後透過可替換的通知管道推播。

第一版聚焦於**可靠的資料管線與可測試架構**：不宣稱覆蓋全網，不繞過 CAPTCHA、登入、
付費牆或網站存取限制，也不自動購買。

## 特色

- **純 Node.js**；`cheerio` 負責 HTML 解析，`playwright-core` 只用於無法以一般 HTTP
  讀取的公開頁面。資料庫使用 Node 內建的 `node:sqlite`，測試使用 `node:test`。
- **Product / Offer 分離**：同一商品在多商店的刊登合併成一個 `Product`、多個 `Offer`。
- **統一 Connector 介面**，單一來源失敗不會中斷其他來源。
- **完全離線的 Fixture Connector**，可重現 新品 → 缺貨 → 補貨 流程。
- **通用 JSON-LD / HTML Connector**，可由設定檔加入公開商品頁（含 CSS selector 備援）。
- 以**條碼、SKU／型號**合併商品，不確定時不強行合併。
- 事件只在**狀態轉換**時建立，重複掃描不會重複通知；具備冷卻時間避免洗版。
- 通知先進入**彙整佇列**，同商品多商店結果合併成一則摘要。
- **Console 通知器**永遠可用；**Telegram / Discord** 為可選，未設定憑證時安靜跳過、不崩潰。
- **可操作的 Local Web App**：首次導覽、網址預覽、來源新增、連線測試與安全停用。
- **受控站內探索**：遵守 robots、同網域與資源預算，優先 Sitemap／公開搜尋，再有限追蹤相關連結。
- **Review Queue**：候選商品先顯示信心與列入原因，人工核准後才建立 Product／Offer 和持續監控。
- `/health` 健康檢查端點。
- 所有網路要求具備 timeout、User-Agent、網域限速、有限重試與指數退避。
- 日誌會遮蔽疑似密鑰；資料庫不保存 Token／Webhook。

## 需求

- Node.js 22 以上（已在 Node.js 25 測試）。無需 Python 或 Docker。
- Windows / macOS / Linux 皆可（開發環境為 Windows 11 + PowerShell）。

## 安裝

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` 全部為選填，未設定外部通知時仍可正常運作。請保留目前的
`config\sources.json`，它已設定三個實際商店；`config\sources.example.json` 僅供參考，
不要覆蓋正式設定。

## Windows 快速控制（建議）

直接雙擊專案根目錄的檔案：

- `start_tracker.cmd`：在背景同時啟動定時抓取與 Web 管理頁；已啟動時不會重複執行。
- `restart_tracker.cmd`：等待目前抓取安全結束，停止後重新啟動。
- `stop_tracker.cmd`：只關閉本專案，不會關閉電腦上其他 Node.js 程式。
- `status_tracker.cmd`：顯示是否運行、PID、最後掃描與下次掃描時間。

啟動後開啟 <http://127.0.0.1:8787>。背景日誌位於 `logs\tracker.log`，PID 與服務狀態
位於 `runtime\tracker.pid`、`runtime\tracker-status.json`。`runtime\` 與 `logs\` 不屬於可移交資料。
命令列也可使用：

```powershell
npm run start:tracker
npm run restart:tracker
npm run stop:tracker
npm run status:tracker
```

目前 `config\sources.json` 已啟用 Yodobashi、しまむら與 HobbyLink Japan 三個 UX-20
商品頁。Yodobashi 與 HLJ 使用 HTTP/JSON-LD；しまむら會啟動移到螢幕外的 Chrome 視窗
讀取公開頁面，不使用登入資料，也不處理 CAPTCHA。

## 使用

```powershell
npm run crawl:once   # 執行一次所有啟用來源
npm run worker       # 持續排程 + 通知（Ctrl+C 安全關閉）
npm run dev          # 開發模式（每 30 秒一輪）
npm run web          # 啟動 Local Web App http://127.0.0.1:8787
npm run health       # 健康檢查煙霧測試
npm run config:check # 以繁中錯誤訊息檢查環境與來源設定
npm run db:backup    # 立即建立一致性 SQLite 備份
npm test             # 執行完整自動化測試
```

上列 `worker` 與 `web` 適合除錯；日常運行請優先使用 `start_tracker.cmd`，避免同時啟動
多份排程器。

只跑單一來源：

```powershell
node bin\crawl-once.js --source demo-fixture
```

用環境變數推進 fixture 影格，重現整個流程（0=初始/現貨、1=缺貨→補貨）：

```powershell
$env:FIXTURE_FRAME = "0"; npm run crawl:once
$env:FIXTURE_FRAME = "1"; npm run crawl:once   # 觀察 back_in_stock / out_of_stock 事件
Remove-Item Env:\FIXTURE_FRAME
```

## Web 管理頁

啟動 `npm run web` 後：

- `/` 總覽（各項統計與健康狀態）
- `/products` 商品清單
- `/offers` 目前可購買刊登（現貨優先、依價格排序）
- `/events` 最近事件
- `/review` 探索候選的核准、排除、稍後處理與批次操作
- `/sources` 貼網址預覽、加入商店、連線測試、啟用／停用與來源健康
- `/health` JSON 健康檢查端點（回傳 `ok` 或 `degraded`）

首次開啟會引導選擇語言、通知方式、掃描頻率與資料保存。加入網址時會先顯示標準網址、
registrable domain、既有商店警告、單頁候選商品及請求預算；只有按下「確認加入」才會寫入
正式來源。相同商店只新增 `SeedUrl`，不建立重複 `Site`。停用來源會保留商品、事件及歷史。

任意網址預覽只允許公開 HTTP(S)，會攔截本機／內網位址、重新導向及超大下載。若貼入首頁或
分類頁，確認後會建立探索入口：預設每站最多 100 頁、深度 2、5 分鐘、50 MB，請求至少間隔
1 秒。探索會先讀 robots 與 Sitemap，再檢查公開搜尋、分類／分頁及高相關連結；不跨 Site，
網站拒絕或 Recipe 失效時停止。候選必須在 `/review` 核准後才進入商品監控。

來源管理的「探索安全預算與 Recipe」可調整頁數、深度、時間、流量、24 小時預設探索間隔及
網址包含／排除詞。失效 Recipe 會暫停自動探索，避免對網站盲目重試；調整設定後可手動再試。

## 設定來源 (`config/sources.json`)

```jsonc
{
  "sources": [
    {
      "key": "demo-fixture",          // 穩定識別碼
      "name": "Demo Fixture Store",
      "connector": "fixture",          // fixture | jsonld | browser
      "enabled": true,
      "checkIntervalSeconds": 3600,
      "config": { "file": "fixtures/beyblade-x.json" }
    },
    {
      "key": "example-jsonld",
      "name": "Example JSON-LD Store",
      "connector": "jsonld",
      "enabled": false,
      "url": "https://store.example",
      "config": {
        "pages": ["https://store.example/products/beyblade-x-bx-38"],
        "selectors": {                 // JSON-LD 缺失時的備援
          "title": "h1.product-title",
          "price": ".price",
          "availabilityText": ".availability",
          "buyButton": "button.add-to-cart",
          "image": "img.product-image"
        }
      }
    }
  ]
}
```

> 加入公開商品頁前，請遵守各網站的服務條款與 robots 規範，並保持合理的抓取頻率。
> 本工具不會登入、不會繞過任何存取限制。

## 外部通知（可選）

在 `.env` 設定後才會對外傳送；未設定時 Console 照常、外部通知自動跳過：

```
TELEGRAM_BOT_TOKEN=123456:abcdef...
TELEGRAM_CHAT_ID=123456789
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Token／Webhook 只存在於 `.env`，**不會**寫入資料庫或日誌。

## 在 Windows 登入後自動啟動（選用）

**方法 A：登入後自動啟動（最簡單）**

1. 按 `Win+R`，輸入 `shell:startup`。
2. 把專案內既有的 `start_tracker.cmd` 捷徑放進該資料夾。

**方法 B：工作排程器（Task Scheduler）**

1. 開啟「工作排程器」→「建立基本工作」。
2. 觸發條件選「當電腦啟動時」或「登入時」。
3. 動作選「啟動程式」：
   - 程式：`C:\Windows\System32\cmd.exe`
   - 引數：`/c start_tracker.cmd`
   - 開始位置：`C:\Users\yedon\OneDrive\桌面\Beyblade`
4. 可勾選「不論使用者是否登入」。

快速啟動會同時管理抓取排程與 Web 管理頁，不需建立第二個工作。

## 資料庫備份與還原

資料庫預設在 `data\tracker.db`，新版程式 schema version 為 4。程式啟動正式 DB 前會先檢查
`backups\`；預設每 24 小時建立一次交易一致的 `auto-*.db`，保留 30 天且最多 30 份。
即使 SQLite 正使用 WAL，備份仍會包含已提交的 WAL 資料。

立即備份不需要停止服務：

```powershell
npm run db:backup
```

還原前必須先停止服務；命令會先做完整性檢查、保留還原前 DB，再以 migration runner 升級
較舊的有效備份。省略 `--from` 時使用 `backups\` 中最新的 `.db`：

```powershell
npm run stop:tracker
npm run db:restore -- --from backups\manual-YYYYMMDD-HHMMSSZ.db
```

還原至另一個測試資料夾可使用：

```powershell
npm run db:restore -- --from backups\manual-YYYYMMDD-HHMMSSZ.db --to C:\test\data\tracker.db
```

可用 `.env` 的 `BACKUP_INTERVAL_HOURS`、`BACKUP_RETENTION_DAYS`、
`BACKUP_RETENTION_COUNT` 調整週期；`AUTO_BACKUP=0` 可停用自動備份。

## 專案結構

```
bin/            CLI 進入點：service, crawl-once, worker, web, health-check, web-smoke
scripts/        背景服務 start/restart/stop/status 控制
src/
  config.js     設定與來源載入
  app.js        流程串接（同步來源 → 擷取 → 通知 → 保存期限）
  db/           版本化 migrations 與 node:sqlite 封裝
  maintenance/  一致性備份、保留週期與安全還原
  connectors/   base、fixture、jsonld、browser 與 HTML/JSON-LD 解析
  core/         normalize、classify、store、events、pipeline、per-source schedule
                discovery、Crawl Frontier、Recipe 與 Review Queue
  notify/       console/telegram/discord 通知器與彙整佇列
  web/          可操作 Local Web App、來源管理 API 與 /health
  util/         logger（會遮蔽密鑰）、env
fixtures/       離線資料集與 HTML 樣本
config/         sources.example.json
test/           node:test 自動化測試
data/           可移交的正式 SQLite 資料
backups/        自動與手動備份
runtime/        PID、服務狀態與 debug HTML（不移交）
logs/           執行日誌（不移交）
archive/demo/   已歸檔的歷史 Demo 資料
```

## 狀態與事件

狀態：`discovered`、`coming_soon`、`preorder`、`in_stock`、`out_of_stock`、`unknown`。

事件：`product_discovered`、`coming_soon`、`preorder_open`、`became_available`、
`back_in_stock`、`out_of_stock`、`price_change`。

`preorder` 是否視為可購買由 `PREORDER_PURCHASABLE` 控制。

## 測試

`npm test` 涵蓋：文字/網址/價格/型號正規化、JSON-LD 與 CSS 解析、可購買判定與排除規則、
商品合併、狀態轉換、去重與冷卻、來源隔離、密鑰不落地、通知彙整、migration、崩潰復原、
設定 validation、Connector 契約、robots／Sitemap／Crawl Frontier、Review Queue，以及跨資料夾
備份還原。目前為 73 項 Node 測試；Web smoke test 涵蓋 8 條管理路由。

## 明確不包含於第一版

自動購買、登入商店、繞過反自動化措施、宣稱搜尋所有商店、多使用者、
雲端部署、手機 App，以及以 AI 進行商品合併（本版使用可解釋的條碼／型號／規則）。
