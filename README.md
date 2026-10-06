# 食譜盒 RecipeBox 🍳

網頁版食譜 App —— 把**煮食教學影片**變成一步步的食譜，附**採購清單**與 **PDF 匯出**，
完全相容手機、平板與電腦，資料存放在**後台 SQLite 資料庫**。

| 需求 | 實現方式 |
| --- | --- |
| 1. 影片教學 → 食譜 + 詳細步驟 | 貦上 YouTube 連結即可擷取標題／縮圖；步驟可填影片時間碼，點一下 ▶ 時間碼影片即跳到該段；另有「跟住步驟做」全螢幕烹調模式 |
| 2. 食材清單 + 採購功能 | 每份食譜的食材可一鍵／逐項加入採購清單，跨食譜彙整、勾選已購買、進度條、加入自訂項目 |
| 3. 匯出 PDF | **兩種**：①「列印／另存 PDF」專屬 A4 列印版面；②「下載 PDF」以 jsPDF + html2canvas 直接產生 .pdf 檔案下載 |
| 4. 適配手機／平板／電腦 | 手機底部導覽列、平板桌機頂部導覽、卡片式格線 1→2→3→4 欄自適應，詳情頁 1→2 欄切換 |
| 5. 後台資料庫 | Node.js 內建 http 伺服器 + `node:sqlite`（檔案資料庫 `data/recipes.db`），REST API |

## 快速開始

```powershell
cd D:\workspace\recipe-app
npm run seed     # 首次：寫入 3 份附影片的示範食譜（已執行可跳過）
npm start        # 啟動伺服器（預設 http://localhost:3777）
```

啟動後打開 `http://localhost:3777` → **註冊帳號**即可使用（第一個註冊者會接管既有的示範食譜）。

- 本機：`http://localhost:3777`
- 手機／平板（同一 Wi‑Fi）：終端機會印出區網位址，例如 `http://192.168.x.x:3777`

> 環境變數可覆寫：`PORT=8080 npm start`。

## 👤 用戶系統

| 功能 | 說明 |
| --- | --- |
| 註冊／登入／登出 | Email + 密碼（至少 8 碼） |
| 密碼安全 | **scrypt 雜湊 + 隨機鹽**，不存明文 |
| 工作階段 | 隨機 token（30 天有效），存於 `sessions` 表，可隨時撤銷 |
| 資料隔離 | 每位使用者的**食譜、食材、步驟、採購清單、收藏**完全分開 |
| API 保護 | 除影片資訊／縮圖外，所有 API 都需 `Authorization: Bearer <token>` |

**部署注意**：務必放在 **HTTPS** 後面（如 Nginx/Caddy 反向代理），否則密碼會以明文傳輸。

## 🛠 管理員後台

網址：`#/admin`（右上角「🛠 後台」，或「我的」頁）。**第一位註冊的使用者自動成為管理員**；之後由管理員在後台指派。

**統計**：使用者數、管理員數、食譜數、食材數、步驟數、採購項目。

**帳號管理**：

| 動作 | 說明 |
| --- | --- |
| 👤 使用者清單 | Email、名稱、角色、食譜數、自訂清單數、註冊時間 |
| ⭐ 設為／取消管理員 | 至少保留一位管理員（不能取消自己） |
| 🔑 重設密碼 | 設定新密碼並**強制該帳號重新登入** |
| 🗑 刪除帳號 | 連同其**食譜、食材、步驟、採購清單、工作階段**一併刪除（不能刪除自己） |

需要指定某個 Email 為管理員：

```powershell
node test/set-admin.js 你的email@example.com
```

> 測試用獨立資料庫（`test/admin-test.js` 自啟伺服器），不會碰正式資料。

## 🚀 部署（發佈上線）

```bash
# 1. 上傳整個資料夾到伺服器（Node.js 22+）
# 2. 安裝（只為了 jsPDF/html2canvas 的 vendor 檔；伺服器本身零相依）
npm install

# 3. 啟動（建議用 systemd / pm2 / Docker 守護）
PORT=80 NODE_HOST=0.0.0.0 node --disable-warning=ExperimentalWarning server.js
```

**systemd 範例**（`/etc/systemd/system/recipebox.service`）：

```ini
[Unit]
Description=RecipeBox
After=network.target

[Service]
WorkingDirectory=/opt/recipe-app
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Environment=PORT=3777
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

**Nginx 反向代理 + HTTPS**（建議）：

```nginx
server {
  listen 443 ssl;
  server_name recipe.example.com;
  ssl_certificate     /etc/letsencrypt/live/recipe.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/recipe.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3777;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 40m;   # 允許上傳封面圖
  }
}
```

**備份**：只需備份 `data/recipes.db`（含所有帳號、食譜、採購清單）。

> 上線前請自行確認所在地區對爬取 YouTube 內容的法規與 YouTube 服務條款。

## 功能總覽

### 📖 食譜庫
- 搜尋（名稱／簡介／分類／標籤）、分類篩選、⭐ 收藏
- 卡片顯示封面（影片縮圖自動帶入）、總時間、步驟數、已加入清單進度

### 🎬 影片轉食譜
- 貼上 YouTube 連結（`watch`／`youtu.be`／`shorts`／`embed`）→「擷取影片資訊」**一鍵**帶入影片標題、作者、說明文字，並自動把說明解析成食材／步驟草稿
- 步驟逐條輸入，可填**影片時間碼**（如 `01:30`）；詳情頁點擊 `▶ 01:30` 影片立即跳轉
- 「▶ 跟住步驟做」：全螢幕烹調模式，大字步驟 + 上一步／下一步 + 可直接播放該段影片（鍵盤 ← → 亦可）

### 📄 沒有字幕也能擷取（內容自動建立草稿）
按下「擷取影片資訊」會自動完成上述擷取；面板內的四個按鈕可重試或改用文字稿：

| 來源 | 可行性 | 說明 |
| --- | --- | --- |
| 影片**說明文字** | ✅ 100% | 伺服器讀取影片頁面解析 `shortDescription`；很多教學影片把食譜寫在說明欄 |
| 影片**章節**（00:00 …） | ✅ | 有設章節會列出，說明中的時間碼會直接轉成「含時間碼的步驟」 |
| **字幕／自動字幕** | ❌ 取不到 | 實測 `timedtext`、`get_transcript`、`innertube player` 三個官方端點都要求 proof-of-origin 憑證；第三方字幕站（youtubetotranscript、notegpt、downsub）不是被 Cloudflare 擋就是要登入。這是 YouTube 的反爬限制，yt-dlp 也一樣卡在這裡 |
| **貼文字稿** | ✅ 萬用 | 任何來源（字幕逐字稿、食譜網站、社團貼文）貼進文字稿框，一鍵解析成步驟／食材 |

### 🥄 如何取得「煮食步驟」

**現在是全自動的。** 按「擷取影片資訊」時，App 會同時：

1. 抓影片**說明文字** → 解析食材（`蠔仔、蛋、青蔥…`）
2. 抓影片**字幕逐字稿**（含時間碼）→ 自動聚合成**煮食步驟**

> 實測 `msLskDp5pG0`（港式煎蠔餅）：**9 種食材 ＋ 23 個含時間碼的步驟**，全部自動。

#### 為什麼可以？（技術筆記）

YouTube 從 2024 起要求 **PoToken（BotGuard）**，所有舊方法都失效 —— 我實測過 `timedtext`、`get_transcript`、`innertube player`（各 client）、Invidious、Piped、kome.ai、tactiq、Jina Reader，**全部被擋**。解法是用會自行鑄 PoToken 的套件：

| 套件 | 用途 |
| --- | --- |
| [`youtube-transcript-plus`](https://www.npmjs.com/package/youtube-transcript-plus) | 主用（月下載 13 萬，持續維護） |
| [`get-youtube-transcript`](https://www.npmjs.com/package/get-youtube-transcript) | 備援（自行處理 PoToken） |

**語系自動挑選**：套件預設會抓清單裡第一個語言（常是阿拉伯文 → 亂碼）。App 會依**影片說明／標題的語系**自動挑對字幕（優先人工字幕 → 原音語系 → en → zh），並在面板提供**字幕語言選單**讓你手動覆寫。

| 影片 | 自動挑選結果 |
| --- | --- |
| World's Best Mac And Cheese（英文） | `en` ✅ |
| 港式煎蠔餅（粵語） | `zh-HK` ✅ |

#### 其他取得步驟的方式

| 路徑 | 動作量 | 說明 |
| --- | --- | --- |
| 🤖 **AI 整理** | 1 點擊 | 把逐字稿交給 AI（DeepSeek／Gemini），收斂成乾淨步驟（自動補標題、小提示） |
| 🎬 **AI 看影片** | 設定金鑰後 0 動作 | Gemini 直接「看」影片（聽旁白＋看畫面文字），適合沒有字幕的影片 |
| 📚 **字幕稿書籤小工具** | 1 點擊（免金鑰） | 備援：在 YouTube 頁面點一下書籤複製逐字稿 |
| ✋ 手動貼文字稿 | 手動 | 兜底 |

### 🤖 AI 智慧解析（選用，需自備 API Key）
規則式解析能處理乾淨的清單，但**看不「懂」**內容。AI 能真正讀懂，把散落的文字整理成乾淨食譜。設定是**全域的**：右上角 **⚙**（手機在底部「設定」）一次設定，全部頁面通用。

**兩種模式：**

| 模式 | 說明 | 適合 |
| --- | --- | --- |
| 🎬 **AI 看影片** | 把 YouTube 連結交給 **Google Gemini** 直接觀看（聽旁白＋看畫面文字），**不需要字幕檔** | 想自動取得「片中的步驟」——這就是解法 |
| 🤖 **AI 解析說明／文字稿** | 讀說明欄／你貼的文字稿，整理成食譜 | DeepSeek 等純文字模型、或已有文字時 |

**設定**（⚙）：提供者（DeepSeek／Google Gemini／自訂 OpenAI 相容）、API Key、模型、Base URL。

安全與隱私：API Key 只存這台裝置的瀏覽器（localStorage），**不寫入資料庫**。DeepSeek／Gemini 支援跨域，由**瀏覽器直接呼叫**，金鑰不離開你的裝置。**API 用量計入你自己的帳號**。

> 取得金鑰：DeepSeek → <https://platform.deepseek.com>；Google AI Studio（Gemini）→ <https://aistudio.google.com/apikey>。Gemini 有免費額度，且是目前唯一能直接看 YouTube 連結的主流選項。

解析器（`parseStepsFromText`、`parseTranscriptSteps`、`parseIngredientsFromText`）依序嘗試：**時間碼行 → 編號行 → 字幕式短行（文字稿）→ 段落**；段落會過濾標題行、hashtag、連結與器材段（Equipment／規格）。食材用啓發式量詞比對（`番茄 2 個`、`500g 蠔仔/baby oyster`、`white pepper power 白胡椒粉`、`鹽 適量`…），並只解析「看起來是食材清單」的段落，避免把器材清單當食材。  
結果是**草稿**，請核對後再儲存。完全沒有字幕、也沒有說明文字的短 reels，就只能手動輸入或貼文字稿 —— 這是資料來源的限制，不是程式能憑空產生的。

### 🛒 食材與採購清單
- 食材可分組（主料／醃料／調味…），支持數量與單位
- 份量即時換算（−／＋ 調整人份，數量跟著變）
- 勾選食材即加入清單；或按「全部加入採購清單」
- 採購頁：跨食譜彙整、按食譜分組、勾選已購買、進度條、清除已購買／清空、加入自訂項目

### 🖨 PDF 匯出（兩種）
1. **列印／另存 PDF**：套用專屬 A4 版面（標題、食材勾選清單、步驟含時間碼、備註、影片來源），開啟瀏覽器列印對話框 → 選「另存為 PDF」。中文字型由瀏覽器輸出，品質最佳。
2. **下載 PDF**：`html2canvas` 將版面繪製成圖，`jsPDF` 分頁切片後直接下載 `.pdf`（離線可用，文字為點陣）。

兩者共用同一份 `#pdf-sheet` 版面，因此內容永遠一致。

## 專案結構

```
recipe-app/
├── server.js            # 後端：內建 http + node:sqlite REST API + 靜態檔 + 影片資訊代理
├── seed.js              # 種子資料（3 份示範食譜）
├── package.json
├── data/recipes.db      # SQLite 資料庫（自動建立）
├── test/smoke.js        # 前端煙霧測試（jsdom）
└── public/
    ├── index.html       # App 外殼
    ├── css/app.css      # 響應式樣式 + A4 列印版面
    ├── js/core.js       # 工具函式、API 用戶端、影片控制
    ├── js/views.js      # 首頁／詳情／採購清單／PDF 版面
    ├── js/form.js       # 新增／編輯食譜表單
    ├── js/main.js       # 路由、事件委派、PDF 匯出
    └── vendor/          # jspdf.umd.min.js、html2canvas.min.js（離線可用）
```

## REST API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 註冊 `{email, name, password}` → 回傳 `token` |
| POST | `/api/auth/login` | 登入 `{email, password}` → 回傳 `token` |
| POST | `/api/auth/logout` | 登出（撤銷工作階段） |
| GET | `/api/auth/me` | 目前登入的使用者 |
| GET | `/api/recipes?q=&category=&fav=&tag=` | 食譜清單（含步驟／食材計數）※ |
| GET | `/api/recipes/:id` | 食譜詳情（含食材、步驟） |
| POST | `/api/recipes` | 建立食譜 |
| PUT | `/api/recipes/:id` | 更新食譜（食材、步驟一併更新） |
| PATCH | `/api/recipes/:id` | 切換收藏 `{favorite}` |
| DELETE | `/api/recipes/:id` | 刪除食譜 |
| GET | `/api/categories` | 分類與數量 |
| GET | `/api/shopping` | 採購清單 |
| POST | `/api/shopping` | 新增自訂項目 |
| POST | `/api/shopping/recipe/:id` | 整份食譜加入／移出清單 `{in_list}` |
| PATCH | `/api/shopping/:id` | 勾選／移出 `{checked}` 或 `{in_list}` |
| DELETE | `/api/shopping?clear=checked\|all` | 清除已購買／清空 |
| DELETE | `/api/shopping/:id` | 移除單項 |
| GET | `/api/video-info?url=` | YouTube oEmbed 影片標題／作者（伺服器代理） |
| GET | `/api/video-content?url=` | 影片說明文字、章節、字幕語言有無（伺服器讀取影片頁解析） |
| GET | `/api/thumb/:id` | YouTube 縮圖代理（同源，PDF 轉檔不被跨域污染） |

## 測試

```powershell
npm test          # 前端煙霧測試（jsdom）：走訪所有畫面、互動、清單、表單與文字解析
npm run test:pdf  # 以無頭 Chrome 實際執行「下載 PDF」，確認產出 .pdf 檔
npm run test:extract # CDP 實際操作「取得影片說明→建立步驟草稿→解析食材」
node test/reset-demo.js   # 測試後清理：刪除測試帳號、把示範食譜歸回未指派
```

> 測試會建立臨時帳號並**驗證資料隔離**。跑完後執行 `node test/reset-demo.js` 即可清除測試帳號；若示範食譜被測試帳號認領，它也會一併收回，讓第一個真正註冊的使用者取得。

兩者都需要伺服器在執行（`npm start`）。`npm test` 結尾會把測試期間建立的資料清乾淨。

已驗證項目：

- 三種斷點版面（手機 520px／平板 834px／桌機 1440px）截圖檢查
- 列印路徑：無頭 Chrome `--print-to-pdf` 產出 2 頁 A4（595×842pt）
- jsPDF 路徑：CDP 觸發 `downloadPdf()`，實際下載 `番茄炒蛋.pdf`（約 300KB，`%PDF-` 標頭）

## 資料表

- `recipes` — 標題、簡介、分類、影片連結、封面、份量、時間、難度、標籤、備註、收藏
- `ingredients` — 食材（分組、數量、單位、`in_list` 是否在清單、`checked` 是否已買）
- `steps` — 步驟（排序、標題、內文、`t_start` 影片秒數、小提示）

## 常見問題

- **手機打不開？** 手機與電腦需在同一網路；Windows 防火牆首次啟動會詢問，請允許 Node 通過。
- **`npm start` 說 port 3777 被佔用？** 表示上一個伺服器還在跑。用工作管理員結束該 `node` 行程，或改用別的埠：`$env:PORT=4000; npm start`。
- **影片顯示無法播放？** 部分作者關閉嵌入；仍可按「在 YouTube 開啟影片 ↗」，食譜與步驟不受影響。
- **時間碼怎麼填？** `1:30`、`01:30` 或 `1:02:03` 都可以，留空表示與影片無關。
- **資料會不見嗎？** 全部存在 `data/recipes.db`，備份這個檔即可；也可直接刪除它重跑 `npm run seed`。
