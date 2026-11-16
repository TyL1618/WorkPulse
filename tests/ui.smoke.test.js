// node tests/ui.smoke.test.js
// 不開瀏覽器，用最小的假 DOM 載入真正的 docs/app.js，模擬點擊與輸入，確認每個分頁都能繪製、請假登記的流程正確。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fakeEl = () => ({ innerHTML: '', textContent: '', style: {}, dataset: {}, value: '', checked: false,
  classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], click() {} });
function boot(initial) {
  const els = {}, listeners = {}, store = { 'workpulse.v1': JSON.stringify(initial) };
  const logic = require('../docs/logic.js');
  const win = { scrollY: 0, scrollTo() {}, WPLogic: logic };
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
  const change = (p, value) => listeners.change({ target: { dataset: { path: p }, value, type: 'text', hasAttribute: () => false } });
  const saved = () => JSON.parse(store['workpulse.v1']);
  return { els, click, change, saved, view: () => els['#view'].innerHTML, toast: () => els['#toast'].textContent };
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
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

console.log(`\n${n} 組畫面冒煙測試通過`);
