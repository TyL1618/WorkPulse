/* WorkPulse · 純計算邏輯（不碰 DOM，Node 也能跑測試）
 * 日期一律用「本機時間」；字串日期格式 YYYY-MM-DD。 */
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diffDays = (a, b) =>
    Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
                Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  function addMonths(d, n) {
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
  }
  const hm = s => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    return m ? +m[1] * 3600 + +m[2] * 60 : 0;
  };
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

  /* ───────── 上下班時間 ───────── */
  function win(cfg) {
    const s = hm(cfg.start), e = Math.max(hm(cfg.end), s + 60);
    const ls = clamp(hm(cfg.lunchStart), s, e);
    const le = clamp(ls + (+cfg.lunchMin || 0) * 60, s, e);
    return { s, e, ls, le };
  }
  function totalWork(cfg) {
    const w = win(cfg);
    return Math.max(1, (w.e - w.s) - (w.le - w.ls));
  }
  /** 當天第 sec 秒（0~86400）時，已經工作了幾秒（扣午休） */
  function workedAt(sec, cfg) {
    const w = win(cfg);
    return (clamp(sec, w.s, w.e) - w.s) - (clamp(sec, w.ls, w.le) - w.ls);
  }
  function phase(sec, cfg) {
    const w = win(cfg);
    if (sec < w.s) return 'before';
    if (sec >= w.e) return 'after';
    if (w.le > w.ls && sec >= w.ls && sec < w.le) return 'lunch';
    return 'working';
  }

  /* ───────── 班表 ───────── */
  /* 內建國定假日（含補假與春節各天；2026、2027 兩年）。
   * 依行政院人事行政總處「政府行政機關辦公日曆表」整理，並用多家媒體逐日核對：
   *   115 年（2026）全年「只補假、不補班」，沒有補班日；
   *   116 年（2027）同樣沒有補班日。
   * 民間公司可能與政府不同（例如不補假），所以設定裡可以關掉，個別日子也能在班表手動改回上班。
   * 2028 年起要等公告後再補進來。 */
  const HOLIDAYS = {
    // 2026
    '2026-01-01': '元旦',
    '2026-02-14': '春節', '2026-02-15': '小年夜', '2026-02-16': '除夕', '2026-02-17': '初一',
    '2026-02-18': '初二', '2026-02-19': '初三', '2026-02-20': '補假', '2026-02-21': '春節', '2026-02-22': '春節',
    '2026-02-27': '補假', '2026-02-28': '和平',
    '2026-04-03': '補假', '2026-04-04': '兒童', '2026-04-05': '清明', '2026-04-06': '補假',
    '2026-05-01': '勞動', '2026-06-19': '端午', '2026-09-25': '中秋', '2026-09-28': '教師',
    '2026-10-09': '補假', '2026-10-10': '國慶', '2026-10-25': '光復', '2026-10-26': '補假', '2026-12-25': '行憲',
    // 2027
    '2027-01-01': '元旦',
    '2027-02-04': '小年夜', '2027-02-05': '除夕', '2027-02-06': '初一', '2027-02-07': '初二', '2027-02-08': '初三',
    '2027-02-09': '補假', '2027-02-10': '補假',
    '2027-02-28': '和平', '2027-03-01': '補假',
    '2027-04-04': '兒童', '2027-04-05': '清明', '2027-04-06': '補假',
    '2027-04-30': '補假', '2027-05-01': '勞動', '2027-06-09': '端午', '2027-09-15': '中秋', '2027-09-28': '教師',
    '2027-10-10': '國慶', '2027-10-11': '補假', '2027-10-25': '光復', '2027-12-24': '補假', '2027-12-25': '行憲',
    '2027-12-31': '補假',
  };
  function mkCtx(S) {
    const names = {};
    if (S.cfg.builtinHol !== false) Object.assign(names, HOLIDAYS);
    for (const d of S.cfg.holidays || []) if (!names[d]) names[d] = '假日';
    return { S, cfg: S.cfg, hol: new Set(Object.keys(names)), holName: names, hire: parse(S.cfg.hire) };
  }
  /** 各種假：薪水比例（ratio）與名稱。出勤津貼一律只有「上班」才有，所以假日／請假都沒有。
   *  特休、喪假、其他帶薪假：薪水照給；病假：半薪（普通傷病假一年 30 日內）；事假：不給薪。
   *  事假／病假的扣薪用「固定月薪 ÷ 當月領薪日數」估算，與公司以 30 日計的算法可能有些許出入。 */
  const LEAVE = {
    annual: { name: '特休', ratio: 1 }, bereave: { name: '喪假', ratio: 1 }, paid: { name: '其他帶薪假', ratio: 1 },
    sick: { name: '病假', ratio: 0.5 }, personal: { name: '事假', ratio: 0 },
  };
  /** type: work 上班 / off 休息 / LEAVE 裡的各種假 / pre 到職前 */
  function dayInfo(d, X, ignoreHire) {
    const ds = ymd(d);
    if (!ignoreHire && X.hire && d < X.hire) return { ds, type: 'pre', regular: false, isHol: false, ov: false, ot: 0 };
    const ov = X.S.overrides[ds] || null;
    const isHol = X.hol.has(ds);
    const regular = (X.cfg.workdays || []).includes(d.getDay()) && !isHol;
    return { ds, type: ov || (regular ? 'work' : 'off'), regular, isHol, name: X.holName[ds] || '', ov: !!ov, ot: +X.S.ot[ds] || 0 };
  }
  function countType(from, to, X, types) {
    let n = 0;
    for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
      if (types.includes(dayInfo(d, X).type)) n++;
    }
    return n;
  }
  function monthPayDays(y, m, X) {
    const last = new Date(y, m + 1, 0).getDate();
    let n = 0;
    for (let i = 1; i <= last; i++) if (dayInfo(new Date(y, m, i), X, true).type !== 'off') n++;
    return n;
  }
  const dailyPay = (y, m, X) => (+X.cfg.salary || 0) / Math.max(1, monthPayDays(y, m, X));
  const allowanceOf = cfg => Math.max(0, +cfg.allowance || 0);
  /** 上班那天每秒賺多少（底薪日薪＋出勤津貼，都攤在工作秒數上） */
  const ratePerSec = (d, X) => (dailyPay(d.getFullYear(), d.getMonth(), X) + allowanceOf(X.cfg)) / totalWork(X.cfg);
  /** 加班費時薪的基準月薪：有填「應領」就用它，否則用月薪（實拿） */
  const otSalary = cfg => (+cfg.otBase > 0 ? +cfg.otBase : +cfg.salary || 0);

  /* ───────── 賺了多少（趣味版：固定月薪 ÷ 當月領薪日 ＋ 每日津貼）───────── */
  /** 每天的收入拆成 [固定薪, 津貼]；今天按已工作比例累積，未來是 0 */
  function earner(now, X) {
    const today = startOfDay(now);
    const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const frac = workedAt(sec, X.cfg) / totalWork(X.cfg);
    const cache = {};
    const dpay = d => {
      const k = d.getFullYear() * 12 + d.getMonth();
      return cache[k] !== undefined ? cache[k] : (cache[k] = dailyPay(d.getFullYear(), d.getMonth(), X));
    };
    const parts = d => {
      const t = dayInfo(d, X).type;
      if (t === 'off' || t === 'pre') return [0, 0];
      const al = t === 'work' ? allowanceOf(X.cfg) : 0;          // 出勤津貼只有「上班」那天才有
      const r = t === 'work' ? 1 : (LEAVE[t] ? LEAVE[t].ratio : 1);   // 各種假的薪水比例
      if (d.getTime() === today.getTime()) return t === 'work' ? [dpay(d) * frac, al * frac] : [dpay(d) * r, 0];
      return d < today ? [dpay(d) * r, al] : [0, 0];
    };
    return { today, parts, done: sec >= win(X.cfg).e };
  }
  function earnings(now, X) {
    const er = earner(now, X), today = er.today;
    const dayEarn = d => { const p = er.parts(d); return p[0] + p[1]; };
    const sum = from => {
      let s = 0;
      for (let d = startOfDay(from); d <= today; d = addDays(d, 1)) s += dayEarn(d);
      return s;
    };
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const yearStart = new Date(today.getFullYear(), 0, 1);
    return {
      today: dayEarn(today),
      month: sum(monthStart),
      year: sum(yearStart),
      total: X.hire ? sum(X.hire) : 0,
      rateSec: ratePerSec(today, X),
    };
  }
  /** 加班費的日類型：假日清單 → holiday；預設上班日 → weekday；其餘 → rest */
  const otKind = info => (info.isHol ? 'holiday' : info.regular ? 'weekday' : 'rest');
  /** 入帳時間點：每月 payday 號 payTime；payOfPrev 表示這天發的是「上個月」的薪水 */
  function payMoment(y, m, cfg) {
    const day = Math.floor(+cfg.payday || 0);
    if (day < 1 || day > 31) return null;
    const tm = cfg.payOfPrev ? m + 1 : m;
    const d = new Date(y, tm, Math.min(day, new Date(y, tm + 1, 0).getDate()));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, hm(cfg.payTime || '00:00'));
  }
  /** 到職至今逐月明細與累計。paid＝這個月的薪水已經過了入帳時間（月份也已結束） */
  function monthlyReport(now, X) {
    if (!X.hire) return { months: [], base: 0, allow: 0, ot: 0, total: 0, paid: 0, pending: 0 };
    const er = earner(now, X), today = er.today, months = [];
    let y = X.hire.getFullYear(), m = X.hire.getMonth();
    const endKey = today.getFullYear() * 12 + today.getMonth();
    while (y * 12 + m <= endKey) {
      const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
      const r = { y, m, base: 0, allow: 0, ot: 0, work: 0 };
      for (let d = first; d <= last && d <= today; d = addDays(d, 1)) {
        const p = er.parts(d), info = dayInfo(d, X);
        r.base += p[0]; r.allow += p[1];
        if (info.type === 'work' && (d < today || er.done)) r.work++;
        if (info.ot > 0 && info.type !== 'pre') r.ot += otPay(otSalary(X.cfg), info.ot, otKind(info)).total;
      }
      r.total = r.base + r.allow + r.ot;
      r.ended = last < today;
      r.payAt = payMoment(y, m, X.cfg);
      r.paid = !!(r.ended && r.payAt && r.payAt <= now);
      months.push(r);
      m++; if (m > 11) { m = 0; y++; }
    }
    const sum = f => months.reduce((t, r) => t + f(r), 0);
    const total = sum(r => r.total), paid = sum(r => (r.paid ? r.total : 0));
    return { months, base: sum(r => r.base), allow: sum(r => r.allow), ot: sum(r => r.ot), total, paid, pending: total - paid };
  }

  /* ───────── 資歷 ───────── */
  function fullMonths(hire, now) {
    let m = (now.getFullYear() - hire.getFullYear()) * 12 + now.getMonth() - hire.getMonth();
    if (now.getDate() < hire.getDate() && now.getDate() !== new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) m--;
    return Math.max(0, m);
  }
  function hireInfo(now, X) {
    if (!X.hire) return null;
    const today = startOfDay(now);
    const months = fullMonths(X.hire, today);
    const days = Math.max(0, diffDays(addMonths(X.hire, months), today));
    return { day: diffDays(X.hire, today) + 1, months, days };
  }
  /** 實際累積上班天數：到職日起、已經上完的「上班」日（今天要過了下班時間才算） */
  function workedDays(now, X) {
    if (!X.hire) return 0;
    const today = startOfDay(now);
    const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const todayDone = sec >= win(X.cfg).e;
    const to = todayDone ? today : addDays(today, -1);
    return to < X.hire ? 0 : countType(X.hire, to, X, ['work']);
  }

  /* ───────── 特休（勞基法第 38 條，週年制）───────── */
  function leaveEntitlement(totalMonths) {
    if (totalMonths < 6) return 0;
    if (totalMonths < 12) return 3;
    const y = Math.floor(totalMonths / 12);
    if (y < 2) return 7;
    if (y < 3) return 10;
    if (y < 5) return 14;
    if (y < 10) return 15;
    return Math.min(30, 15 + (y - 9));
  }
  function leavePeriod(now, X) {
    if (!X.hire) return null;
    const today = startOfDay(now);
    const m = fullMonths(X.hire, today);
    let start = null, end, entitled = leaveEntitlement(m);
    if (m < 6) { end = addMonths(X.hire, 6); }
    else if (m < 12) { start = addMonths(X.hire, 6); end = addMonths(X.hire, 12); }
    else { const y = Math.floor(m / 12); start = addMonths(X.hire, 12 * y); end = addMonths(X.hire, 12 * (y + 1)); }
    let used = 0;
    if (start) {
      for (const ds of Object.keys(X.S.overrides)) {
        if (X.S.overrides[ds] !== 'annual') continue;
        const d = parse(ds);
        if (d && d >= start && d < end) used++;
      }
    }
    const nextY = Math.max(1, Math.floor(m / 12) + 1);
    return {
      entitled, used, remaining: Math.max(0, entitled - used), start, end,
      next: m < 6 ? { date: addMonths(X.hire, 6), days: 3 }
                  : { date: addMonths(X.hire, 12 * nextY), days: leaveEntitlement(12 * nextY) },
    };
  }

  /* ───────── 加班費（勞基法第 24 條，月薪 ÷ 30 ÷ 8 為時薪）───────── */
  function otPay(salary, hours, kind) {
    const hr = (+salary || 0) / 240;
    hours = Math.max(0, +hours || 0);
    const rows = [];
    let total = 0, billed = hours, warn = '';
    const add = (label, h, mult) => {
      if (h <= 0) return;
      const v = hr * mult * h;
      rows.push({ label, h, mult, v });
      total += v;
    };
    if (kind === 'weekday') {
      add('前 2 小時', Math.min(hours, 2), 1.34);
      add('第 3–4 小時', clamp(hours - 2, 0, 2), 1.67);
      if (hours > 4) warn = '平日延長工時每日上限 4 小時（總工時 12 小時），超過的部分不在計算內。';
    } else if (kind === 'rest') {
      billed = hours <= 0 ? 0 : hours <= 4 ? 4 : hours <= 8 ? 8 : 12;
      add('前 2 小時', Math.min(billed, 2), 1.34);
      add('第 3–8 小時', clamp(billed - 2, 0, 6), 1.67);
      add('第 9–12 小時', clamp(billed - 8, 0, 4), 2.67);
      if (hours > 12) warn = '休息日工時上限 12 小時，超過的部分不在計算內。';
      if (hours > 0 && billed !== hours) warn = (warn ? warn + ' ' : '') + `休息日工時以 4/8/12 小時為單位計算，這次按 ${billed} 小時計。`;
    } else if (kind === 'holiday') {
      if (hours > 0) add('國定假日加發一日工資', 8, 1);
      add('超過 8 小時：前 2 小時', clamp(hours - 8, 0, 2), 1.34);
      add('超過 8 小時：再 2 小時', clamp(hours - 10, 0, 2), 1.67);
      if (hours > 12) warn = '單日工時上限 12 小時，超過的部分不在計算內。';
    }
    return { hourly: hr, rows, total: Math.round(total), billed, warn };
  }

  /* ───────── 倒數 / 年終 ───────── */
  function countdown(targetStr, now, X) {
    const t = parse(targetStr);
    if (!t) return null;
    const today = startOfDay(now);
    const days = diffDays(today, t);
    let wd = 0;
    for (let d = addDays(today, 1); d <= t; d = addDays(d, 1)) if (dayInfo(d, X).type === 'work') wd++;
    return { days, wd, weeks: days / 7, date: t };
  }
  /** 年終預估：salary × 月數 ×（按比例時 min(1, 發放日在職月數 ÷ 12)） */
  function bonusEstimate(targetStr, X) {
    const t = parse(targetStr);
    const sal = +X.cfg.salary || 0, mo = +X.cfg.bonusMonths || 0;
    if (!t || !sal) return null;
    let ratio = 1;
    if (X.cfg.bonusProrate && X.hire) ratio = clamp(diffDays(X.hire, t) / 365.25, 0, 1);
    return { ratio, amount: Math.round(sal * mo * ratio) };
  }
  /** 下一次入帳：每月 day 號 time（HH:MM）；今天已過入帳時間就算下個月。at 是精確時間點。 */
  function nextPayday(now, day, time) {
    day = Math.floor(+day || 0);
    if (day < 1 || day > 31) return null;
    const sec = hm(time || '00:00'), today = startOfDay(now);
    const mk = (y, m) => {
      const d = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, sec);
    };
    let at = mk(today.getFullYear(), today.getMonth());
    if (at <= now) at = mk(today.getFullYear(), today.getMonth() + 1);
    const date = startOfDay(at);
    return { date, at, days: diffDays(today, date) };
  }

  /* ───────── 格式化 ───────── */
  function money(n, dec) {
    dec = dec || 0;
    return '$' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`;
  }
  /** 「工作 N 時間」的口語寫法 */
  function humanWork(sec, cfg) {
    sec = Math.max(0, sec);
    if (sec < 60) return `${Math.max(1, Math.round(sec))} 秒`;
    if (sec < 3600) return `${Math.round(sec / 60)} 分鐘`;
    const day = totalWork(cfg);
    if (sec < day) { const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return m === 60 ? `${h + 1} 小時` : `${h} 小時 ${m} 分`; }
    const dd = sec / day;
    return dd < 10 ? `${dd.toFixed(1)} 個工作日` : `${Math.round(dd)} 個工作日`;
  }
  function parseHolidays(text) {
    const out = new Set();
    for (const m of String(text || '').matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g)) {
      const s = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
      if (parse(s)) out.add(s);
    }
    return [...out].sort();
  }

  const api = {
    pad, ymd, parse, startOfDay, addDays, diffDays, addMonths, hm, win, totalWork, workedAt, phase,
    HOLIDAYS, LEAVE, mkCtx, dayInfo, countType, monthPayDays, dailyPay, allowanceOf, ratePerSec, otSalary, earner, earnings, otKind, payMoment, monthlyReport, fullMonths, hireInfo,
    workedDays, leaveEntitlement, leavePeriod, otPay, countdown, bonusEstimate, nextPayday,
    money, clock, humanWork, parseHolidays,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WPLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
