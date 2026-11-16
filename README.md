# WorkPulse 打工人儀表板

一個給上班族的多合一小工具，純前端 PWA：手機、電腦都能裝成 App，離線可用，**資料只存在你自己的瀏覽器，不上傳**。

| 分頁 | 內容 |
|---|---|
| **今日** | 即時薪資（每秒跳動）、下班倒數、本月／今年／到職至今累計、入職第 N 天、**實際累積上班天數**、**在這間公司累計賺到多少（固定薪＋津貼＋加班費，含已入帳／還沒入帳與逐月明細）**、特休剩餘、年終倒數、帶薪拉屎計時、本週進度、發薪日倒數 |
| **班表** | 月曆；已上過的班自動變色，今天高亮；點日期可改成特休／喪假／病假／事假／其他帶薪假／補班／休息，並登記加班時數；下方「登記請假」可一次填一段日期；月統計與加班費估算 |
| **年終** | 多組發放日期倒數（天、約幾個上班日、幾週），預估金額，去問 HR 的 5 個問題 |
| **工具** | 等價換算（這杯手搖要工作幾分鐘）、加班費計算（勞基法第 24 條）、特休（第 38 條）、會議燒錢計數器、帶薪拉屎紀錄 |
| **設定** | 到職日、月薪、發薪日、上下班與午休、平常上班的星期、國定假日清單、隱藏金額、匯出／匯入備份 |

## 使用

線上版：<https://tyl1618.github.io/WorkPulse/>（手機用瀏覽器「加到主畫面」；電腦的 Chrome／Edge 網址列右側按「安裝」）。

直接開 `docs/index.html` 也能用（但離線快取與「安裝」需要 http(s) 網址）。本機試跑：

```bash
cd docs
python -m http.server 8765
```

再開 <http://127.0.0.1:8765/>。第一次進去先填到職日與月薪。

## 雲端同步（選用）

跟 WealthMatrix、VaultMe 用同一個 Supabase 專案與同一組帳號，各自一張表（本專案是 `workpulse`）。不登入也完全能用，資料只存在這台裝置。

**第一次設定**（只要做一次）：到 Supabase 專案的 SQL Editor 執行：

```sql
create table if not exists public.workpulse (
  id      text primary key,
  payload text not null,
  updated text,
  rev     integer not null default 1
);
alter table public.workpulse enable row level security;
create policy "workpulse own row" on public.workpulse
  for all using (auth.uid()::text = id) with check (auth.uid()::text = id);
```

然後在 App 的「設定 → 雲端同步」用同一組 Email／密碼登入。**RLS 一定要開**：連線的 URL 與 publishable key 是公開的，資料靠 RLS 保護。

防衝突：寫入用版本號比對（兩台同時存檔只有一台寫得進去，另一台自動重新合併再寫）；兩台修改不同的地方會自動合併，只有同一個地方改成不同的值才會問你。細節見 [DEVDOC.md](DEVDOC.md)。

## 重要說明

- **年終日期預設是推測值**（12 月底／春節前／元宵後），標著「推測」。問到公司真正日期後改掉即可。
- **內建 2026、2027 年的國定假日與補假**（班表用紅字標示，這兩年沒有補班日）。公司如果另有公告，到「班表」點那天改成上班或休息；2028 年起等公告後再更新。
- 即時薪資是趣味估算；加班費、特休依法定最低標準估算，實際以公司規定為準。

## 重新產生 icon

```bash
pip install -r requirements.txt
python tools/make_icon.py
```

## 測試

```bash
node tests/logic.test.js
node tests/ui.smoke.test.js
node tests/sync.test.js
```

技術細節見 [DEVDOC.md](DEVDOC.md)。
