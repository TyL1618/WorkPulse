# WorkPulse 技術文件

純前端 PWA，無建置步驟、無第三方執行期套件。線上版：https://tyl1618.github.io/WorkPulse/ （GitHub Pages，來源 `main` 分支的 `/docs`，push 後約 1 分鐘生效）。也可把 `docs/` 丟到任何靜態主機。

## 檔案

```
docs/
├── index.html        外殼：頂欄、<main id=view>、底部導覽、面板容器
├── app.css           樣式（配色與 WealthMatrix / PocketDeck 同一套 token）
├── logic.js          純計算（不碰 DOM；瀏覽器掛 window.WPLogic，Node 用 require）
├── app.js            狀態、畫面、事件
├── sw.js             Service Worker：網路優先，離線退回快取（cache 名 wp-v1，改檔案請升版號）
├── manifest.json     start_url/scope 都是相對路徑 "./"，所以放在任何子路徑都能裝
└── icon-*.png / apple-touch-icon.png / favicon.ico   由 tools/make_icon.py 產生
tests/logic.test.js   node 直接跑，涵蓋 logic.js 的計算
tools/make_icon.py    Pillow 畫 icon（藍→綠漸層進度環＋線尾圓環＋指針）
```

## 資料（localStorage key `workpulse.v1`）

```
cfg        hire 'YYYY-MM-DD' · salary(固定月薪，實拿) · allowance(每日出勤津貼) · otBase(加班費基準月薪，選填，0=用 salary) · start/end 'HH:MM' · lunchStart · lunchMin · workdays [0-6]
           holidays [日期] · payday 1-31(0=不顯示) · hide · bonusMonths · bonusProrate
overrides  { 'YYYY-MM-DD': 'work'|'off'|'annual'|'sick' }   只存「跟預設不同」的日子
ot         { 'YYYY-MM-DD': 小時 }
targets    [{ id, label, date, guess }]   年終倒數；guess=true 代表還是我們猜的日期，使用者改過日期就變 false
poop       { start: ms|null, log: [{ t, s秒, e金額, paid }] }
items      [{ n, p }]   等價換算清單
meeting    { n, hourly, start, acc }
ui         { tab, month }
```

載入時用 `merge(DEF(), saved)` 做深度合併，所以之後新增欄位不會讓舊資料壞掉。匯入備份同樣走 merge。

## 日子的型態（`L.dayInfo`）

優先序：到職日之前（`pre`）→ 手動覆寫 → 國定假日（休息）→ 平常上班的星期。
`regular` 表示「依預設是上班日」，覆寫值與預設相同時會被刪除，所以 `overrides` 永遠只留例外。
加班費的類型由日子決定：在假日清單 → `holiday`；預設上班日 → `weekday`；其餘 → `rest`。

## 薪資計算

- **趣味版（即時跳動、累計）**：日薪＝固定月薪 ÷ 當月「領薪日數」（非 `off` 的日子，不看到職日）；**出勤津貼（allowance）只在型態為 `work` 的那天加上**，特休、請假、假日沒有。每秒＝(日薪＋津貼) ÷ 工作秒數（扣午休）。今天用 `workedAt` 算已工作比例。特休、請假視為領全額固定月薪。班表分頁的「本月預估實拿」＝salary ＋ allowance × 本月上班日數（不含加班費）。
- **加班費（法定）**：時薪＝`otSalary(cfg)` ÷ 240；`otSalary` 在有填 `otBase`（應領，未扣勞健保）時用它，否則退回 `salary`。實拿比應領低，所以不填 `otBase` 會低估。津貼是否算進時薪基準有爭議，預設不算。
  - 平日：前 2 小時 ×1.34、再 2 小時 ×1.67（單日上限 4 小時）。
  - 休息日：不足 4 小時按 4、4–8 按 8、8–12 按 12；前 2 小時 ×1.34、第 3–8 小時 ×1.67、第 9–12 小時 ×2.67。
  - 國定假日：加發一日工資（8 小時 ×1），超過 8 小時再依 1.34／1.67。
  - 例假日不計算（原則上不能要求出勤）。
- **特休**：勞基法第 38 條週年制最低標準（滿 6 個月 3 天、1 年 7、2 年 10、3–4 年 14、5–9 年 15、10 年起每年 +1 至 30）。已排天數來自 `overrides` 裡落在「本期」的 `annual`。公司若用曆年制或給更多，這裡不會知道。

## 年終

法律上沒有統一發放日，所以目標日期是**使用者可編輯的資料**，預設放三個推測值（`guess:true`，UI 標「推測」）。預估金額＝月薪 × 月數 ×（開啟「按比例」時 min(1, 發放日在職天數 ÷ 365.25)）。

## 已知限制 / 待辦

- **國定假日清單預設是空的**（沒有把官方行事曆寫死，怕寫錯）。要改成內建每年清單，需對照人事行政總處公告。
- 沒有通知／提醒功能（iOS PWA 對背景通知支援有限）。
- 沒有雲端同步，換裝置要用「匯出／匯入備份」。
- 資料與計算都在本機；**月薪是敏感資料**，所以預設只放 localStorage，且提供一鍵隱藏金額。
- 2026-11-16 已部署到 GitHub Pages（`main` 的 `/docs`）：https://tyl1618.github.io/WorkPulse/ 。service worker 在線上網址註冊成功、快取 `wp-v1` 建立；本機 http://127.0.0.1 在 Claude 內嵌瀏覽器無法註冊（環境限制），所以 SW 以線上版為準。**尚未在實體手機上驗證「加到主畫面」。**

## 新增功能時

1. 計算放 `logic.js` 並在 `tests/logic.test.js` 補測試。
2. 新的需要每秒更新的數字：在 `live()` 回傳 key，畫面上用 `data-live="key"`（進度條用 `data-live-w`）。
3. 新的互動：按鈕用 `data-act` 對應 `ACT` 裡的函式；會存進設定的輸入框用 `data-path="cfg.xxx"`（數字加 `data-num`）。
4. 改了 `docs/` 內任何檔案後，把 `sw.js` 的 `CACHE` 版號 +1。
