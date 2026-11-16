// node tests/ui.smoke.test.js
// 不開瀏覽器，用最小的假 DOM 載入真正的 docs/app.js，模擬點擊與輸入，確認每個分頁都能繪製、請假登記的流程正確。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fakeEl = () => ({ innerHTML: '', textContent: '', style: {}, dataset: {}, value: '', checked: false,
  classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], click() {} });
function boot(initial, opts = {}) {
  const els = {}, listeners = {}, store = { 'workpulse.v1': JSON.stringify(initial) };
  const logic = require('../docs/logic.js');
  const win = { scrollY: 0, scrollTo() {}, addEventListener() {}, WPLogic: logic, WPSync: require('../docs/sync.js'), supabase: opts.supabase };
  const ctx = {
    window: win, console, Date, Math, JSON, Object, Array, Set, Number, String, parseInt, parseFloat, isNaN,
    document: { querySelector: s => els[s] || (els[s] = fakeEl()), querySelectorAll: () => [], createElement: fakeEl,
      addEventListener: (t, f) => { listeners[t] = f; }, scripts: [] },
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    navigator: {}, location: { protocol: 'file:' }, confirm: () => true, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: function () {}, FileReader: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8'), ctx, { filename: 'app.js' });
  const click = (act, data = {}) => {
    const b = { dataset: { act, ...data }, tagName: 'BUTTON' };
    listeners.click({ target: { closest: () => b }, preventDefault() {} });
  };
  const change = (p, value, attrs = []) => listeners.change({ target: { dataset: { path: p }, value, type: 'text', hasAttribute: a => attrs.includes(a) } });
  const changeId = (id, value) => listeners.change({ target: { id, dataset: {}, value, type: 'text', hasAttribute: () => false } });
  const saved = () => JSON.parse(store['workpulse.v1']);
  const later = () => new Promise(r => setImmediate(r));
  return { els, click, change, changeId, saved, later, store, view: () => els['#view'].innerHTML, toast: () => els['#toast'].textContent };
}

const { makeDb } = require('./fakedb.js');
/** 假的 supabase-js：auth 只認 me@example.com / pw123，資料表用記憶體版 */
function fakeSupabase(db, uid = 'u-me') {
  let session = null;
  const client = {
    from: t => db.from(t),
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async ({ email, password }) => {
        if (email === 'me@example.com' && password === 'pw123') { session = { user: { id: uid, email } }; return { data: { user: session.user }, error: null }; }
        return { data: null, error: { message: 'Invalid login credentials' } };
      },
      signOut: async () => { session = null; return {}; },
      onAuthStateChange() {},
    },
  };
  return { createClient: () => client };
}

let n = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const cfg = { hire: '2026-05-04', salary: 40000, allowance: 135 };

t('五個分頁都能繪製（沒有丟例外）', () => {
  const a = boot({ cfg });
  for (const tab of ['today', 'cal', 'bonus', 'tools', 'set']) {
    a.click('tab', { v: tab });
    assert.ok(a.view().length > 500, tab + ' 內容太短');
  }
  const b = boot({});                                   // 全新使用者（沒有任何資料）
  for (const tab of ['today', 'cal', 'bonus', 'tools', 'set']) { b.click('tab', { v: tab }); assert.ok(b.view().length > 200); }
});

t('登記喪假 6 天：週末與假日自動略過、可刪除、津貼少 810', () => {
  const noLeave = require('../docs/logic.js').monthlyReport(new Date(2026, 10, 16, 15), require('../docs/logic.js').mkCtx({ cfg: { ...cfg, builtinHol: true, workdays: [1, 2, 3, 4, 5], holidays: [], payday: 10, payTime: '01:00', payOfPrev: true }, overrides: {}, ot: {} }));
  const a = boot({ cfg, ui: { tab: 'cal', month: '2026-10' } });
  a.change('ui.lv.type', 'bereave'); a.change('ui.lv.from', '2026-10-12'); a.change('ui.lv.to', '2026-10-19');
  a.click('lvApply');
  assert.match(a.toast(), /已登記 6 天喪假/);
  const ov = a.saved().overrides;
  assert.deepEqual(Object.keys(ov).sort(), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19']);
  assert.ok(Object.values(ov).every(v => v === 'bereave'));
  assert.match(a.view(), /喪假 6 天/);                   // 請假紀錄摘要
  assert.match(a.view(), /10\/12–10\/19/);               // 週末被跨過，合併成一段
  // 與沒請假相比：10 月津貼少 6 × 135 = 810，但固定薪水不變
  const L = require('../docs/logic.js');
  const withLeave = L.monthlyReport(new Date(2026, 10, 16, 15), L.mkCtx({ cfg: { ...cfg, builtinHol: true, workdays: [1, 2, 3, 4, 5], holidays: [], payday: 10, payTime: '01:00', payOfPrev: true }, overrides: ov, ot: {} }));
  const oct = i => i.months.find(r => r.m === 9);
  assert.ok(Math.abs((oct(noLeave).allow - oct(withLeave).allow) - 810) < 1e-6);
  assert.ok(Math.abs(oct(noLeave).base - oct(withLeave).base) < 1e-6);
  a.click('lvDel', { first: '2026-10-12', last: '2026-10-19', t: 'bereave' });
  assert.deepEqual(a.saved().overrides, {});
});

t('登記請假的防呆', () => {
  const a = boot({ cfg, ui: { tab: 'cal' } });
  a.click('lvApply'); assert.match(a.toast(), /請選好起訖日期/);
  a.change('ui.lv.from', '2026-10-17'); a.change('ui.lv.to', '2026-10-18');       // 只有週末
  a.click('lvApply'); assert.match(a.toast(), /沒有「預定要上班」/);
  a.change('ui.lv.from', '2026-10-20'); a.change('ui.lv.to', '2026-10-19');       // 顛倒
  a.click('lvApply'); assert.match(a.toast(), /不能早於/);
  assert.deepEqual(a.saved().overrides || {}, {});
});

t('額外休息日裡的日子可以改成喪假／颱風假：請假類型優先，不再顯示成「假日」', () => {
  // 重現實際情況：10/1(喪假)、10/23(颱風假) 先被填進「額外休息日」
  const a = boot({ cfg: { ...cfg, holidays: ['2026-10-01', '2026-10-23'] }, ui: { tab: 'cal', month: '2026-10' } });
  const cell = ds => (a.view().match(new RegExp('<button class="day ([^"]*)" data-act="day" data-ds="' + ds + '">[\\s\\S]*?</button>')) || [])[0] || '';
  assert.match(cell('2026-10-01'), /class="day off hol/);     // 目前被當成假日
  assert.match(cell('2026-10-01'), /假日/);
  a.click('day', { ds: '2026-10-01' }); a.click('setType', { t: 'bereave' });
  a.click('day', { ds: '2026-10-23' }); a.click('setType', { t: 'typhoon' });
  assert.match(cell('2026-10-01'), /class="day bereave/); assert.doesNotMatch(cell('2026-10-01'), /hol/); assert.match(cell('2026-10-01'), /喪假/);
  assert.match(cell('2026-10-23'), /class="day typhoon/); assert.match(cell('2026-10-23'), /颱風假/);
  assert.equal(a.saved().overrides['2026-10-01'], 'bereave');
  assert.equal(a.saved().overrides['2026-10-23'], 'typhoon');
  assert.match(a.view(), /喪假 1、颱風假 1|颱風假 1、喪假 1/);   // 月統計分開計算
});

t('登記請假遇到「額外休息日」會提示，不會默默略過', () => {
  const a = boot({ cfg: { ...cfg, holidays: ['2026-10-01'] }, ui: { tab: 'cal' } });
  a.change('ui.lv.type', 'bereave'); a.change('ui.lv.from', '2026-10-01'); a.click('lvApply');
  assert.match(a.toast(), /額外休息日/);
  assert.deepEqual(a.saved().overrides || {}, {});
});

t('額外休息日可取名字；颱風假薪水可設照給／不給薪', () => {
  const a = boot({ cfg, ui: { tab: 'set' } });
  a.changeId('holidays', '2026-12-24 公司尾牙\n2027/1/4');
  assert.deepEqual(a.saved().cfg.holidays, ['2026-12-24', '2027-01-04']);
  assert.deepEqual(a.saved().cfg.holNames, { '2026-12-24': '公司尾牙' });
  assert.match(a.view(), /2026-12-24 公司尾牙/);
  a.change('cfg.typhoonPaid', 'false', ['data-bool']);
  assert.equal(a.saved().cfg.typhoonPaid, false);
});

t('病假、事假、特休各自記錄；特休會計入特休用量', () => {
  const a = boot({ cfg, ui: { tab: 'cal', month: '2026-11' } });
  a.change('ui.lv.type', 'annual'); a.change('ui.lv.from', '2026-11-18'); a.click('lvApply');
  a.change('ui.lv.type', 'sick'); a.change('ui.lv.from', '2026-11-19'); a.click('lvApply');
  a.change('ui.lv.type', 'personal'); a.change('ui.lv.from', '2026-11-20'); a.click('lvApply');
  assert.deepEqual(a.saved().overrides, { '2026-11-18': 'annual', '2026-11-19': 'sick', '2026-11-20': 'personal' });
  assert.match(a.view(), /特休 1 天、病假 1 天、事假 1 天|特休 1、病假 1、事假 1|病假 1、事假 1/);
  a.click('tab', { v: 'tools' });
  assert.match(a.view(), /特休（勞基法/);
});

t('雲端卡片：沒登入時顯示登入表單與建表 SQL；雲端元件載不到也不影響使用', () => {
  const a = boot({ cfg, ui: { tab: 'set' } });                       // 沒有 supabase
  assert.match(a.view(), /雲端同步/); assert.match(a.view(), /cloud-email/); assert.match(a.view(), /create table if not exists public\.workpulse/);
  assert.match(a.view(), /alter table public\.workpulse enable row level security/);   // RLS 一定要開
});

t('登入：上傳的資料不含這台專屬設定（隱藏金額、分頁、計時器）；密碼錯誤有提示', async () => {
  const db = makeDb(), a = boot({ cfg: { ...cfg, hide: true }, ui: { tab: 'set' }, poop: { start: 123456, log: [] } }, { supabase: fakeSupabase(db) });
  await a.later();
  a.els['#cloud-email'] = Object.assign(fakeEl(), { value: 'me@example.com' }); a.els['#cloud-pass'] = Object.assign(fakeEl(), { value: 'wrong' });
  a.click('cloudLogin'); await a.later(); await a.later();
  assert.match(a.els['#cloud-err'].textContent, /帳號或密碼錯誤/);
  assert.equal(db.rows.size, 0);                                      // 沒登入就沒有任何東西上傳
  a.els['#cloud-pass'].value = 'pw123';
  a.click('cloudLogin'); for (let i = 0; i < 6; i++) await a.later();
  const row = db.rows.get('u-me'); assert.ok(row, '登入後應該已上傳');
  const cloud = JSON.parse(row.payload);
  assert.equal(cloud.cfg.salary, 40000); assert.equal(cloud.cfg.hire, '2026-05-04');
  assert.equal('hide' in cloud.cfg, false); assert.equal('ui' in cloud, false); assert.equal('start' in (cloud.poop || {}), false);
  assert.match(a.view(), /已登入/); assert.match(a.view(), /me@example\.com/);
});

t('兩台裝置：A 登記喪假 → 同步 → B 拉到；隱藏金額各自獨立', async () => {
  const db = makeDb(), sup = fakeSupabase(db);
  const A = boot({ cfg, ui: { tab: 'set' } }, { supabase: sup }), B = boot({ cfg: { hire: '', salary: 0 }, ui: { tab: 'cal', month: '2026-10' } }, { supabase: sup });
  for (const d of [A, B]) {
    await d.later();
    d.els['#cloud-email'] = Object.assign(fakeEl(), { value: 'me@example.com' }); d.els['#cloud-pass'] = Object.assign(fakeEl(), { value: 'pw123' });
  }
  A.click('cloudLogin'); for (let i = 0; i < 6; i++) await A.later();
  A.click('toggleHide');                                              // A 隱藏金額
  A.click('tab', { v: 'cal' }); A.click('day', { ds: '2026-10-01' }); A.click('setType', { t: 'bereave' });
  A.click('cloudSync'); for (let i = 0; i < 6; i++) await A.later();
  assert.equal(JSON.parse(db.rows.get('u-me').payload).overrides['2026-10-01'], 'bereave');
  B.click('tab', { v: 'set' }); B.click('cloudLogin'); for (let i = 0; i < 8; i++) await B.later();
  assert.equal(B.saved().cfg.salary, 40000);                          // B 原本是空的，登入後載入雲端資料
  assert.equal(B.saved().overrides['2026-10-01'], 'bereave');
  assert.equal(B.saved().cfg.hide, false);                            // A 的隱藏金額不會跑到 B
  assert.equal(A.saved().cfg.hide, true);
});

t('登出：資料保留在本機，不再同步', async () => {
  const db = makeDb(), a = boot({ cfg, ui: { tab: 'set' } }, { supabase: fakeSupabase(db) });
  await a.later();
  a.els['#cloud-email'] = Object.assign(fakeEl(), { value: 'me@example.com' }); a.els['#cloud-pass'] = Object.assign(fakeEl(), { value: 'pw123' });
  a.click('cloudLogin'); for (let i = 0; i < 6; i++) await a.later();
  a.click('cloudLogout'); for (let i = 0; i < 4; i++) await a.later();
  assert.equal(a.saved().cfg.salary, 40000); assert.match(a.view(), /cloud-email/);
  const rev = db.rows.get('u-me').rev;
  a.click('tab', { v: 'cal' }); a.click('day', { ds: '2026-10-01' }); a.click('setType', { t: 'sick' });
  a.click('cloudSync'); await a.later();
  assert.equal(db.rows.get('u-me').rev, rev);                         // 登出後的修改不會上傳
});

(async () => {
  for (const [name, fn] of queue) { await fn(); n++; console.log('ok  ' + name); }
  console.log(`\n${n} 組畫面冒煙測試通過`);
})().catch(e => { console.error(e); process.exit(1); });
