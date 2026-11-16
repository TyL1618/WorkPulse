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
docs/sync.js          雲端同步引擎與三方合併（純邏輯；瀏覽器掛 window.WPSync）
tests/sync.test.js    用記憶體版假 Supabase（tests/fakedb.js）模擬多台裝置：合併、搶寫、離線、同步途中編輯
tests/ui.smoke.test.js  用最小的假 DOM 載入真正的 app.js，模擬點擊與輸入（每個分頁能繪製、請假登記流程）
tools/make_icon.py    Pillow 畫 icon（藍→綠漸層進度環＋線尾圓環＋指針）
```

## 資料（localStorage key `workpulse.v1`）

```
cfg        hire 'YYYY-MM-DD' · salary(固定月薪，實拿) · allowance(每日出勤津貼) · otBase(加班費基準月薪，選填，0=用 salary) · start/end 'HH:MM' · lunchStart · lunchMin · workdays [0-6]
           holidays [日期] · holNames {日期:名稱，額外休息日的自訂名稱} · typhoonPaid · payday 1-31(0=不顯示) · payTime 'HH:MM' · payOfPrev(發的是上個月薪水) · hide · bonusMonths · bonusProrate
overrides  { 'YYYY-MM-DD': 'work'|'off'|'annual'|'bereave'|'paid'|'sick'|'personal'|'typhoon' }   只存「跟預設不同」的日子
ot         { 'YYYY-MM-DD': 小時 }
targets    [{ id, label, date, guess }]   年終倒數；guess=true 代表還是我們猜的日期，使用者改過日期就變 false
poop       { start: ms|null, log: [{ t, s秒, e金額, paid }] }
items      [{ n, p }]   等價換算清單
meeting    { n, hourly, start, acc }
ui         { tab, month, lv:{type,from,to} }   lv 是「登記請假」表單的草稿
```

載入時用 `merge(DEF(), saved)` 做深度合併，所以之後新增欄位不會讓舊資料壞掉。匯入備份同樣走 merge。

## 日子的型態（`L.dayInfo`）

優先序：到職日之前（`pre`）→ 手動覆寫 → 國定假日（內建＋自訂，休息）→ 平常上班的星期。國定假日在班表用紅色與名稱標示；落在平日的假日薪水照領（不影響每日薪資的分母以外的部分）但**沒有出勤津貼**（津貼只給型態為 `work` 的日子）。
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

## 假別（`L.LEAVE`）

| type | 名稱 | 薪水 | 津貼 |
|---|---|---|---|
| annual | 特休 | 照給（並計入特休用量） | 無 |
| bereave | 喪假 | 照給 | 無 |
| paid | 其他帶薪假（婚假、公假等） | 照給 | 無 |
| sick | 病假 | 半薪（普通傷病假一年 30 日內） | 無 |
| personal | 事假 | 不給薪 | 無 |
| typhoon | 颱風假 | 依設定 `cfg.typhoonPaid`（預設照給，可改不給薪） | 無 |

`earner().parts` 用 `ratio` 乘上日薪。事假／病假的扣薪是估算（固定月薪 ÷ 當月領薪日數），公司若以月薪 ÷ 30 計算會有些許出入。班表分頁下方的「登記請假」可一次填一段日期（`ACT.lvApply`，只會填「預定要上班」的日子），並列出合併後的請假紀錄，可整段刪除。舊資料裡的 `sick` 原本標示為「請假」且當全薪，現在是「病假」半薪。

### 假日清單 vs 請假

`cfg.holidays`（設定 →「額外休息日」）只放**公司整體放假**的日子，可在日期後接名稱（`holNames`）。個人請的假、颱風假要用假別登記（班表下方「登記請假」或點日期）。優先序是「手動覆寫 ＞ 假日清單」，所以即使某天誤填在額外休息日，在日曆點那天改假別就會改成請假；班表上只有型態為 `off` 的假日才畫紅色。`lvApply` 遇到被額外休息日略過的日子會提示。

## 累計收入（今日分頁的「在這間公司累計賺到」）

`L.earner()` 把每天收入拆成 `[固定薪, 津貼]`（今天按已工作比例、未來為 0）；`L.monthlyReport()` 從到職月逐月加總，輸出每月的 base / allow / ot / work 與是否已入帳，以及全部加總與「已入帳 / 還沒入帳」。
- 已入帳＝月份已結束，且該月薪水的入帳時間點（`payMoment`：`payday`、`payTime`、`payOfPrev`）已過。
- 加班費只算「在班表登記過時數」的日子，用 `otSalary` 與 `otKind` 的法定倍率估算。
- 到職那個月不特別按比例：領薪日數的分母不看到職日，到職前的日子型態是 `pre`（不賺），所以自然按在職天數推算；該月若有假日在到職前，就等於整月。
- 這是估算，不是薪資單。

## 發薪日

`L.nextPayday(now, day, time)` 回傳下一次入帳的精確時間點（今天已過入帳時間就算下個月，月底自動縮到該月最後一天）。今日分頁的倒數是 `data-live="payLeft"`（天＋時分秒）；「預計入帳」＝入帳月份（`payOfPrev` 時為前一個月）的 `monthCounts().expect`，不含加班費。

## 雲端同步（Supabase）

**架構**：與 WealthMatrix / VaultMe 同一個 Supabase 專案（URL 與 publishable key 寫在 `app.js` 的 `SB_URL` / `SB_KEY`，是公開值）、同一組帳號；本專案自己一張表 `workpulse`（`id`＝使用者 UUID、`payload`＝JSON 字串、`updated`、`rev`＝版本號）。RLS 只允許讀寫 `auth.uid()::text = id` 的那一列，**RLS 必須維持開啟、關閉匿名註冊**。Auth session 存在獨立的 `storageKey: 'workpulse.auth'`（同網域的其他 PWA 不共用 session）。登入前完全不碰雲端。

**同步哪些資料**（`extractSynced`）：cfg（不含 `hide`）、overrides、ot、targets、poop.log、items、meeting.n/hourly。**不同步**：`cfg.hide`、`ui`、`poop.start`、`meeting.start/acc`。本機另存 `workpulse.sync.v1`＝`{ baseRev, base, dirty }`（上次同步的版本號與資料快照，三方合併的共同祖先）。

**防衝突（比 WealthMatrix 網頁版多一道）**：
1. **版本號比對才寫入**：`UPDATE … WHERE id=我 AND rev=我讀到的` ；回傳 0 列代表被別台搶先 → 重新讀取、合併、再寫（最多 5 次）。WealthMatrix 是「先查 updated 再 upsert」，兩步之間仍有空窗。
2. **三方合併**（`sync.js` 的 `mergeSynced`）：`base / local / remote` 逐格比較，只有一邊改就採用那邊；物件清單（targets 以 `id`、items 以 `n`、poop.log 以 `t`）逐筆對應並逐欄位合併；集合（holidays、workdays）逐元素增減；一邊改、一邊刪同一筆算衝突。**只有衝突才跳 `confirm`**：確定＝這些地方保留這台，取消＝改用雲端。
3. **不用預設值蓋雲端**：沒有 base（第一次登入）時以預設資料當 base，所以全新裝置不會把雲端設定洗掉。

**時機**：修改後 1.5 秒上傳（只有同步資料真的變了才排程）；切到背景立即 flush；回到前景、`online`、每 5 分鐘 → `pullLatest`（有未同步修改就走合併）。同步途中使用者又改了東西，`applyResult` 會把那些修改疊在結果上，不會丟。離線時修改留在本機、標記 dirty，恢復連線自動補送。

**狀態燈**（頂欄）：綠＝已同步、藍閃＝同步中、橘＝離線、紅＝錯誤（點一下立即同步）；未登入時隱藏。找不到 `workpulse` 表時會明確提示要執行建表 SQL。

**Service Worker**：Supabase 套件固定版本 `@2.45.4`（UMD，`window.supabase`），`cdn.jsdelivr.net` 走快取優先，離線時 App 仍能啟動；Supabase API 不經 SW。

**沒驗證到的**：自動化測試全部用記憶體版假資料庫，**還沒對真的 Supabase 跑過**（需要先建表並登入）。第一次實機同步後請確認 Supabase 的 `workpulse` 表出現一列、手機與電腦能互相看到修改。

**加密**：payload 是明文 JSON（與 WealthMatrix 網頁版相同，靠 RLS 保護）。月薪屬敏感資料，若之後想端對端加密，可比照 VaultMe 的做法。

## 年終

法律上沒有統一發放日，所以目標日期是**使用者可編輯的資料**，預設放三個推測值（`guess:true`，UI 標「推測」）。預估金額＝月薪 × 月數 ×（開啟「按比例」時 min(1, 發放日在職天數 ÷ 365.25)）。

## 已知限制 / 待辦

- **內建國定假日只有 2026、2027 兩年**（`logic.js` 的 `HOLIDAYS`，含補假與春節各天；兩年都是「只補假、不補班」）。2028 年起要等人事行政總處公告後手動補進去。資料依人事行政總處辦公日曆表整理，並用多家媒體逐日核對（2026：104 人力銀行整理頁、中央社等轉載；2027：ETtoday、數位時代、今周刊逐日表），**沒有直接讀官方 PDF**；2027 端午 6/9、中秋 9/15、教師節 9/28 是兩個來源一致、但不是官網原文。民間公司可能與政府不同，所以設定裡可關掉內建、班表可逐日改。
- 沒有通知／提醒功能（iOS PWA 對背景通知支援有限）。
- 沒有雲端同步，換裝置要用「匯出／匯入備份」。
- 資料與計算都在本機；**月薪是敏感資料**，所以預設只放 localStorage，且提供一鍵隱藏金額。
- 2026-11-16 已部署到 GitHub Pages（`main` 的 `/docs`）：https://tyl1618.github.io/WorkPulse/ 。service worker 在線上網址註冊成功、快取 `wp-v1` 建立；本機 http://127.0.0.1 在 Claude 內嵌瀏覽器無法註冊（環境限制），所以 SW 以線上版為準。**尚未在實體手機上驗證「加到主畫面」。**

## 新增功能時

1. 計算放 `logic.js` 並在 `tests/logic.test.js` 補測試。
2. 新的需要每秒更新的數字：在 `live()` 回傳 key，畫面上用 `data-live="key"`（進度條用 `data-live-w`）。
3. 新的互動：按鈕用 `data-act` 對應 `ACT` 裡的函式；會存進設定的輸入框用 `data-path="cfg.xxx"`（數字加 `data-num`）。
4. 改了 `docs/` 內任何檔案後，把 `sw.js` 的 `CACHE` 版號 +1。
