// node tests/logic.test.js
const assert = require('node:assert/strict');
const L = require('../docs/logic.js');

const base = () => ({
  cfg: { hire: '2026-05-18', salary: 48000, start: '09:00', end: '18:00', lunchStart: '12:00', lunchMin: 60,
         workdays: [1, 2, 3, 4, 5], holidays: [], builtinHol: false, bonusMonths: 1, bonusProrate: false },
  overrides: {}, ot: {},
});
const X = S => L.mkCtx(S);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('日期工具', () => {
  assert.equal(L.ymd(new Date(2026, 10, 5)), '2026-11-05');
  assert.equal(L.parse('2026-02-30'), null);
  assert.equal(L.diffDays(new Date(2026, 4, 18), new Date(2026, 10, 16)), 182);
  assert.equal(L.ymd(L.addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
});

t('工時：扣午休', () => {
  const c = base().cfg;
  assert.equal(L.totalWork(c), 8 * 3600);
  assert.equal(L.workedAt(9 * 3600, c), 0);
  assert.equal(L.workedAt(12 * 3600, c), 3 * 3600);
  assert.equal(L.workedAt(12.5 * 3600, c), 3 * 3600);          // 午休不累計
  assert.equal(L.workedAt(18 * 3600, c), 8 * 3600);
  assert.equal(L.workedAt(23 * 3600, c), 8 * 3600);
  assert.equal(L.phase(12.5 * 3600, c), 'lunch');
  assert.equal(L.phase(8 * 3600, c), 'before');
  assert.equal(L.phase(18 * 3600, c), 'after');
});

t('班表：預設週一到五、覆寫、國定假日、到職前', () => {
  const S = base(); S.cfg.holidays = ['2026-11-18']; S.overrides['2026-11-17'] = 'annual'; S.overrides['2026-11-21'] = 'work';
  const x = X(S);
  assert.equal(L.dayInfo(new Date(2026, 10, 16), x).type, 'work');   // 週一
  assert.equal(L.dayInfo(new Date(2026, 10, 17), x).type, 'annual');
  assert.equal(L.dayInfo(new Date(2026, 10, 18), x).type, 'off');    // 假日
  assert.equal(L.dayInfo(new Date(2026, 10, 21), x).type, 'work');   // 週六補班
  assert.equal(L.dayInfo(new Date(2026, 10, 22), x).type, 'off');
  assert.equal(L.dayInfo(new Date(2026, 4, 1), x).type, 'pre');
});

t('入職天數與實際上班天數', () => {
  const S = base(); const x = X(S);
  const now = new Date(2026, 10, 16, 10, 0, 0);
  const h = L.hireInfo(now, x);
  assert.equal(h.day, 183);
  assert.equal(h.months, 5);
  assert.equal(h.days, 29);
  // 5/18(一) 起到 11/15：26 週 + 零頭；逐日算比對
  let expect = 0;
  for (let d = new Date(2026, 4, 18); d < new Date(2026, 10, 16); d = L.addDays(d, 1)) if (d.getDay() >= 1 && d.getDay() <= 5) expect++;
  assert.equal(L.workedDays(now, x), expect);
  assert.equal(L.workedDays(new Date(2026, 10, 16, 18, 0, 0), x), expect + 1);   // 下班後算今天
});

t('特休：滿半年 3 天，週年制', () => {
  assert.equal(L.leaveEntitlement(5), 0);
  assert.equal(L.leaveEntitlement(6), 3);
  assert.equal(L.leaveEntitlement(12), 7);
  assert.equal(L.leaveEntitlement(24), 10);
  assert.equal(L.leaveEntitlement(36), 14);
  assert.equal(L.leaveEntitlement(60), 15);
  assert.equal(L.leaveEntitlement(120), 16);
  assert.equal(L.leaveEntitlement(12 * 40), 30);
  const S = base(); S.overrides['2026-12-01'] = 'annual'; S.overrides['2026-06-01'] = 'annual'; // 後者在半年門檻之前，不算
  assert.equal(L.leavePeriod(new Date(2026, 10, 16), X(S)).entitled, 0);   // 還差 2 天滿半年
  const p = L.leavePeriod(new Date(2026, 10, 20), X(S));
  assert.equal(p.entitled, 3);
  assert.equal(p.used, 1);
  assert.equal(p.remaining, 2);
  assert.equal(L.ymd(p.end), '2027-05-18');
});

t('加班費', () => {
  const w = L.otPay(48000, 3, 'weekday');          // 時薪 200
  assert.equal(w.hourly, 200);
  assert.equal(w.total, Math.round(200 * 1.34 * 2 + 200 * 1.67));
  const r1 = L.otPay(48000, 3, 'rest');             // 不足 4 小時按 4 小時
  assert.equal(r1.billed, 4);
  assert.equal(r1.total, Math.round(200 * 1.34 * 2 + 200 * 1.67 * 2));
  const r2 = L.otPay(48000, 10, 'rest');            // 按 12 小時
  assert.equal(r2.total, Math.round(200 * 1.34 * 2 + 200 * 1.67 * 6 + 200 * 2.67 * 4));
  const h = L.otPay(48000, 8, 'holiday');
  assert.equal(h.total, 1600);                      // 加發一日工資
  assert.equal(L.otPay(48000, 0, 'rest').total, 0);
});

t('賺了多少（趣味版）', () => {
  const S = base(); const x = X(S);
  // 2026-11 週一~五共 21 天 → 日薪 48000/21
  const e = L.earnings(new Date(2026, 10, 16, 12, 0, 0), x);       // 週一中午：已工作 3 小時
  const dp = 48000 / 21;
  assert.ok(Math.abs(e.today - dp * 3 / 8) < 1e-6);
  assert.ok(Math.abs(L.ratePerSec(new Date(2026, 10, 16), x) - dp / 28800) < 1e-9);
  // 週六：今天不算
  assert.equal(L.earnings(new Date(2026, 10, 21, 12, 0, 0), x).today, 0);
});

t('出勤津貼：只有上班日才有；加班費基準可另填', () => {
  const S = base(); S.cfg.salary = 40000; S.cfg.allowance = 135;
  S.overrides['2026-11-18'] = 'annual';                         // 特休那天沒有津貼
  const x = X(S);
  const dp = 40000 / 21;                                        // 11 月 21 個領薪日（特休照領）
  const e = L.earnings(new Date(2026, 10, 19, 18, 0, 0), x);    // 週四下班後
  // 已完成：11/2~11/6(5) 11/9~11/13(5) 11/16、17、19 共 13 個上班日 + 1 個特休日(11/18)
  const workDays = 5 + 5 + 3, expectMonth = dp * (workDays + 1) + 135 * workDays;
  assert.ok(Math.abs(e.month - expectMonth) < 1e-6, `${e.month} vs ${expectMonth}`);
  assert.equal(L.otSalary({ salary: 40000, otBase: 0 }), 40000);
  assert.equal(L.otSalary({ salary: 40000, otBase: 46000 }), 46000);
  assert.ok(Math.abs(L.ratePerSec(new Date(2026, 10, 16), x) - (dp + 135) / 28800) < 1e-9);
});

t('內建國定假日（2026、2027）', () => {
  const S = base(); S.cfg.builtinHol = true; S.cfg.salary = 40000; S.cfg.allowance = 135;
  const x = X(S);
  // 你說的中秋連假：週五 9/25 中秋 + 週一 9/28 教師節都放假
  for (const [d, name] of [['2026-09-25', '中秋'], ['2026-09-28', '教師']]) {
    const i = L.dayInfo(L.parse(d), x);
    assert.equal(i.type, 'off'); assert.equal(i.isHol, true); assert.equal(i.name, name);
  }
  assert.equal(L.dayInfo(new Date(2026, 8, 24), x).type, 'work');   // 連假前一天要上班
  assert.equal(L.dayInfo(new Date(2026, 8, 29), x).type, 'work');   // 連假後一天要上班
  // 全部日期格式正確；兩年落在平日的假日天數
  const wk = { 2026: 0, 2027: 0 };
  for (const d of Object.keys(L.HOLIDAYS)) {
    const dt = L.parse(d); assert.ok(dt, d);
    if (dt.getDay() >= 1 && dt.getDay() <= 5) wk[dt.getFullYear()]++;
  }
  assert.deepEqual(wk, { 2026: 16, 2027: 17 });
  // 9 月：22 個平日 - 2 天假日 = 20 個上班日 → 薪水照領 40000 + 135 × 20
  const e = L.earnings(new Date(2026, 8, 30, 18, 0, 0), x);
  assert.ok(Math.abs(e.month - (40000 + 135 * 20)) < 1e-6, String(e.month));
  // 關掉內建 → 9/25 回到上班日
  S.cfg.builtinHol = false;
  assert.equal(L.dayInfo(new Date(2026, 8, 25), X(S)).type, 'work');
  // 自訂假日仍可疊加
  S.cfg.holidays = ['2026-09-24'];
  assert.equal(L.dayInfo(new Date(2026, 8, 24), X(S)).name, '假日');
});

t('到職至今累計與逐月入帳', () => {
  const S = base(); S.cfg.salary = 40000; S.cfg.allowance = 135; S.cfg.payday = 10; S.cfg.payTime = '01:00'; S.cfg.payOfPrev = true;
  S.ot['2026-10-12'] = 2;                                          // 10/12 週一加班 2 小時
  const x = X(S), now = new Date(2026, 10, 16, 15, 0, 0);
  const rep = L.monthlyReport(now, x);
  assert.equal(rep.months.length, 7);                              // 5~11 月
  assert.deepEqual(rep.months.map(r => r.paid), [true, true, true, true, true, true, false]);   // 11 月還沒結束
  for (const r of rep.months.slice(1, 6)) assert.ok(Math.abs(r.base - 40000) < 1e-6, `${r.m + 1}月 ${r.base}`);   // 整月在職＝固定薪全拿
  const wd = (y, m) => { let n = 0; for (let d = new Date(y, m, 1); d.getMonth() === m; d = L.addDays(d, 1)) if (d.getDay() >= 1 && d.getDay() <= 5) n++; return n; };
  assert.ok(Math.abs(rep.months[5].allow - 135 * wd(2026, 9)) < 1e-6);          // 10 月津貼
  assert.equal(rep.months[5].ot, Math.round(40000 / 240 * 1.34 * 2));
  const e = L.earnings(now, x);
  assert.ok(Math.abs(rep.base + rep.allow - e.total) < 1e-6);      // 與「到職至今」一致
  assert.ok(Math.abs(rep.total - (e.total + rep.ot)) < 1e-6);
  assert.ok(Math.abs(rep.paid + rep.pending - rep.total) < 1e-6);
  assert.ok(Math.abs(rep.pending - rep.months[6].total) < 1e-6);   // 沒入帳的只有 11 月
  // 入帳時間點：10 號 01:00 之前 10 月薪還沒到
  assert.equal(L.monthlyReport(new Date(2026, 10, 10, 0, 30), x).months[5].paid, false);
  assert.equal(L.monthlyReport(new Date(2026, 10, 10, 1, 30), x).months[5].paid, true);
  assert.equal(L.monthlyReport(now, L.mkCtx({ ...S, cfg: { ...S.cfg, hire: '' } })).total, 0);
});

t('各種假的薪水與津貼：喪假帶薪但沒有津貼，病假半薪，事假不給薪', () => {
  const S = base(); S.cfg.salary = 40000; S.cfg.allowance = 135;
  // 11 月 21 個領薪日。11/2~11/6 喪假(5天)、11/9 病假、11/10 事假，其餘上班到 11/13
  for (const d of ['02', '03', '04', '05', '06']) S.overrides['2026-11-' + d] = 'bereave';
  S.overrides['2026-11-09'] = 'sick'; S.overrides['2026-11-10'] = 'personal';
  const x = X(S), dp = 40000 / 21;
  const e = L.earnings(new Date(2026, 10, 13, 18, 0, 0), x);       // 週五下班後
  const base_ = dp * 5 + dp * 0.5 + 0 + dp * 3;                    // 喪假 5 全薪 + 病假半薪 + 事假 0 + 11~13 三天上班
  const allow_ = 135 * 3;                                          // 只有 3 個上班日有津貼
  assert.ok(Math.abs(e.month - (base_ + allow_)) < 1e-6, `${e.month} vs ${base_ + allow_}`);
  assert.equal(L.leavePeriod(new Date(2026, 10, 20), X(S)).used, 0);   // 喪假不佔特休
  assert.equal(L.LEAVE.bereave.name, '喪假');
});

t('颱風假：薪水可設照給或不給薪，都沒有津貼', () => {
  const mk = paid => { const S = base(); S.cfg.salary = 40000; S.cfg.allowance = 135; S.cfg.typhoonPaid = paid; S.overrides['2026-11-02'] = 'typhoon'; return X(S); };
  const at = new Date(2026, 10, 2, 18, 0, 0), dp = 40000 / 21;
  assert.ok(Math.abs(L.earnings(at, mk(true)).today - dp) < 1e-6);      // 照給：日薪全拿、沒有津貼
  assert.equal(L.earnings(at, mk(false)).today, 0);                     // 不給薪
  assert.equal(L.leaveRatio('typhoon', { typhoonPaid: false }), 0);
  assert.equal(L.leaveRatio('bereave', {}), 1);
  assert.equal(L.leaveRatio('sick', {}), 0.5);
});

t('額外休息日可帶名稱', () => {
  const r = L.parseHolidayLines('2026-12-24 公司尾牙\n2027/1/4\n壞資料\n2026-02-30 不存在');
  assert.deepEqual(r.dates, ['2026-12-24', '2027-01-04']);
  assert.deepEqual(r.names, { '2026-12-24': '公司尾牙' });
  const S = base(); S.cfg.holidays = r.dates; S.cfg.holNames = r.names;
  assert.equal(L.dayInfo(new Date(2026, 11, 24), X(S)).name, '公司尾牙');
  assert.equal(L.dayInfo(new Date(2027, 0, 4), X(S)).name, '假日');
});

t('倒數與年終', () => {
  const S = base(); const x = X(S);
  const c = L.countdown('2026-12-31', new Date(2026, 10, 16, 9, 0, 0), x);
  assert.equal(c.days, 45);
  let wd = 0;
  for (let d = new Date(2026, 10, 17); d <= new Date(2026, 11, 31); d = L.addDays(d, 1)) if (d.getDay() >= 1 && d.getDay() <= 5) wd++;
  assert.equal(c.wd, wd);
  assert.equal(L.bonusEstimate('2027-02-03', x).amount, 48000);
  S.cfg.bonusProrate = true;
  const est = L.bonusEstimate('2026-12-31', X(S));
  assert.ok(est.ratio > 0.6 && est.ratio < 0.65);
  assert.equal(L.countdown('壞日期', new Date(), x), null);
});

t('發薪日、格式化、假日解析', () => {
  assert.equal(L.ymd(L.nextPayday(new Date(2026, 10, 16), 5).date), '2026-12-05');
  assert.equal(L.ymd(L.nextPayday(new Date(2026, 10, 16), 30).date), '2026-11-30');
  assert.equal(L.nextPayday(new Date(), 0), null);
  // 每月 10 號 01:00 入帳
  const a = L.nextPayday(new Date(2026, 10, 10, 0, 30), 10, '01:00');          // 入帳前 30 分鐘
  assert.equal(L.ymd(a.date), '2026-11-10'); assert.equal(a.days, 0); assert.equal(a.at - new Date(2026, 10, 10, 0, 30), 30 * 60e3);
  assert.equal(L.ymd(L.nextPayday(new Date(2026, 10, 10, 2, 0), 10, '01:00').date), '2026-12-10');   // 已入帳，算下個月
  assert.equal(L.ymd(L.nextPayday(new Date(2026, 11, 20), 10, '01:00').date), '2027-01-10');        // 跨年
  assert.equal(L.money(1234.5, 2), '$1,234.50');
  assert.equal(L.clock(3725), '01:02:05');
  const cfg = base().cfg;
  assert.equal(L.humanWork(120, cfg), '2 分鐘');
  assert.equal(L.humanWork(5400, cfg), '1 小時 30 分');
  assert.equal(L.humanWork(28800 * 2, cfg), '2.0 個工作日');
  assert.deepEqual(L.parseHolidays('2026-12-25, 2027/1/1\n2026-12-25 壞 2027-13-01'), ['2026-12-25', '2027-01-01']);
});

console.log(`\n${n} 組測試通過`);
