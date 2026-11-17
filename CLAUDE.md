# WorkPulse（打工人儀表板）

給上班族的純前端 PWA（無建置步驟、無第三方執行期套件）：即時薪資、下班倒數、班表/請假、年終倒數、加班費/特休等工具；資料預設只存瀏覽器 localStorage，可選 Supabase 雲端同步。線上版是 GitHub Pages（`main` 分支的 `/docs`，push 後約 1 分鐘生效）。**月薪是敏感資料。**

## 怎麼跑
- 直接開 `docs/index.html` 可用（離線快取與「安裝」需要 http(s)）。本機：`cd docs && python -m http.server 8765` 再開 `http://127.0.0.1:8765/`。
- `tools/make_icon.py` 用 Pillow 畫 icon（`requirements.txt` 只有 `pillow==12.2.0`；沒有專案 `.venv`，這不是打包 exe 的專案，無 spec / build_exe.bat）。

## 怎麼測
- 全部是 Node 內建測試（無依賴，已驗證全過）：`node --test "tests/*.test.js"`（**要用引號的 glob**；單寫 `node --test tests/` 在 Node 24 會失敗）。
  - `logic.test.js` 計算、`sync.test.js` 同步合併（記憶體版假 Supabase `fakedb.js`）、`ui.smoke.test.js` 假 DOM 載入真 `app.js` 跑各分頁與請假流程。

## 新增功能時（DEVDOC 約定）
1. 計算放 `docs/logic.js`（純函式、不碰 DOM），並在 `tests/logic.test.js` 補測試。
2. 每秒更新的數字：`live()` 回傳 key，畫面用 `data-live="key"`。
3. 互動：按鈕用 `data-act` 對應 `ACT`；會存設定的輸入框用 `data-path="cfg.xxx"`（數字加 `data-num`）。
4. **改了 `docs/` 任何檔案，把 `docs/sw.js` 的 `const CACHE = 'wp-vN'` 版號 +1**（以 `sw.js` 現值為準；DEVDOC 寫的 `wp-v1` 已過時），否則使用者拿到舊快取。

## 地雷 / 刻意不做
- 薪資、假別、加班費依台灣勞基法（第 24、38 條）；**內建國定假日只有 2026、2027**（`logic.js` 的 `HOLIDAYS`），2028 起要等公告後手動補。
- 同步：與 WealthMatrix / VaultMe 共用 Supabase 專案與帳號，本專案自己一張表 `workpulse`，**RLS 必須開**（URL 與 publishable key 是公開值，資料靠 RLS 保護）。寫入用「`rev` 版本號比對」+ 三方合併，不要改成先查再 upsert（兩步之間會被搶寫）。
- 不同步的欄位：`cfg.hide`、`ui`、`poop.start`、`meeting.start/acc`；沒有 base（第一次登入）時以預設資料當 base，別用預設值蓋雲端。
- 同步功能的測試都是假資料庫，**尚未對真的 Supabase 驗證過**（DEVDOC 明載）。
- DEVDOC「已知限制」裡「沒有雲端同步」一行已過時，以「雲端同步（Supabase）」章節為準。
- 月薪屬敏感資料：不要把真實薪資/設定/備份寫進程式、測試、文件或 commit；測試用假資料。
- Service Worker 的 Supabase 套件固定 `@2.45.4`（UMD，jsdelivr 快取優先）。

## DEVDOC 索引（`DEVDOC.md`，依標題搜尋）
- 檔案｜資料（localStorage key `workpulse.v1`）｜日子的型態 `L.dayInfo`｜薪資計算｜假別 `L.LEAVE`｜累計收入｜發薪日｜雲端同步｜年終｜已知限制 / 待辦｜新增功能時
