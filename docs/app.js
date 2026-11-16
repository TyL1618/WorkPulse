/* WorkPulse · 打工人儀表板（純前端 PWA，資料只存在本機 localStorage） */
(function () {
  'use strict';
  const L = window.WPLogic;
  const KEY = 'workpulse.v1';
  const WDN = ['日', '一', '二', '三', '四', '五', '六'];
  const $ = (s, e) => (e || document).querySelector(s);
  const $$ = (s, e) => [...(e || document).querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = L.pad;

  /* ───────── 狀態 ───────── */
  const DEF = () => ({
    v: 1,
    cfg: {
      hire: '', salary: 0, allowance: 0, otBase: 0, start: '09:00', end: '18:00', lunchStart: '12:00', lunchMin: 60,
      workdays: [1, 2, 3, 4, 5], holidays: [], payday: 10, payTime: '01:00', payOfPrev: true, hide: false, bonusMonths: 1, bonusProrate: false,
    },
    overrides: {}, ot: {},
    targets: [
      { id: 1, label: '樂觀：12 月底', date: '2026-12-31', guess: true },
      { id: 2, label: '預期：春節前', date: '2027-02-03', guess: true },
      { id: 3, label: '悲觀：元宵後', date: '2027-02-25', guess: true },
    ],
    poop: { start: null, log: [] },
    items: [
      { n: '手搖飲', p: 60 }, { n: '便當', p: 100 }, { n: '超商咖啡', p: 55 }, { n: '電影票', p: 330 },
      { n: '吃到飽', p: 700 }, { n: '無線耳機', p: 7500 }, { n: '新手機', p: 30000 }, { n: '日本來回機票', p: 12000 },
    ],
    meeting: { n: 5, hourly: 0, start: null, acc: 0 },
    ui: { tab: 'today', month: '' },
  });
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
  function merge(base, src) {
    for (const k of Object.keys(src || {})) {
      if (isObj(base[k]) && isObj(src[k])) merge(base[k], src[k]); else base[k] = src[k];
    }
    return base;
  }
  let S = DEF();
  try { const raw = localStorage.getItem(KEY); if (raw) S = merge(DEF(), JSON.parse(raw)); } catch (e) { /* 隱私模式等 */ }
  let saveTimer = 0;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('瀏覽器不允許儲存資料，重新整理後設定會消失'); }
  }
  const X = () => L.mkCtx(S);
  const M = (n, d) => (S.cfg.hide ? '$ •••' : L.money(n, d || 0));
  const todayStr = () => L.ymd(new Date());
  function setPath(path, v) {
    const ks = path.split('.'); let o = S;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ───────── 圖示 ───────── */
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
    today: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    bonus: svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M12 8c-2-4-6-3-5 0 .5 1.5 3 1 5 0zM12 8c2-4 6-3 5 0-.5 1.5-3 1-5 0z"/>'),
    tools: svg('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>'),
    set: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.3 6.4C3.6 8.2 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 004.2 4.2"/>'),
  };
  const TABS = [['today', '今日'], ['cal', '班表'], ['bonus', '年終'], ['tools', '工具'], ['set', '設定']];

  /* ───────── 共用計算 ───────── */
  const secOfDay = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  const todayDone = now => secOfDay(now) >= L.win(S.cfg).e;
  const curRate = () => (S.cfg.salary > 0 ? L.ratePerSec(L.startOfDay(new Date()), X()) : 0);
  function curMonth() {
    const m = /^(\d{4})-(\d{2})$/.exec(S.ui.month || '');
    const n = new Date();
    return m ? [+m[1], +m[2] - 1] : [n.getFullYear(), n.getMonth()];
  }
  function monthCounts(y, m, now) {
    const x = X(), today = L.startOfDay(now), done0 = todayDone(now);
    const o = { work: 0, done: 0, annual: 0, sick: 0, ot: 0, otPay: 0, expect: 0 };
    const last = new Date(y, m + 1, 0).getDate();
    for (let i = 1; i <= last; i++) {
      const d = new Date(y, m, i), info = L.dayInfo(d, x);
      if (info.type === 'work') { o.work++; if (d < today || (d.getTime() === today.getTime() && done0)) o.done++; }
      if (info.type === 'annual') o.annual++;
      if (info.type === 'sick') o.sick++;
      if (info.ot > 0 && info.type !== 'pre') {
        o.ot += info.ot;
        o.otPay += L.otPay(L.otSalary(S.cfg), info.ot, info.isHol ? 'holiday' : info.regular ? 'weekday' : 'rest').total;
      }
    }
    o.expect = (+S.cfg.salary || 0) + L.allowanceOf(S.cfg) * o.work;   // 本月預估實拿（不含加班費）
    return o;
  }
  function weekCounts(now) {
    const x = X(), today = L.startOfDay(now), mon = L.addDays(today, -((today.getDay() + 6) % 7)), d0 = todayDone(now);
    let total = 0, done = 0;
    for (let i = 0; i < 7; i++) {
      const d = L.addDays(mon, i);
      if (L.dayInfo(d, x).type !== 'work') continue;
      total++;
      if (d < today || (d.getTime() === today.getTime() && d0)) done++;
    }
    return { total, done, left: total - done };
  }
  const fmtDur = s => (s < 60 ? `${Math.round(s)} 秒` : `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`);
  function poopStats(filter) {
    const a = S.poop.log.filter(filter);
    return { n: a.length, s: a.reduce((t, r) => t + r.s, 0), e: a.reduce((t, r) => t + r.e, 0) };
  }

  /* ───────── 即時數值（每秒更新）───────── */
  function live(now) {
    const x = X(), cfg = S.cfg, today = L.startOfDay(now), sec = secOfDay(now);
    const info = L.dayInfo(today, x), w = L.win(cfg), ph = L.phase(sec, cfg), tw = L.totalWork(cfg);
    const e = L.earnings(now, x), o = {};
    o.date = `${now.getMonth() + 1}/${now.getDate()} 週${WDN[now.getDay()]}`;
    o.clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    o.today = M(e.today, 2); o.month = M(e.month); o.year = M(e.year); o.total = M(e.total);
    o.rate = S.cfg.salary > 0 ? `每分鐘 ${M(e.rateSec * 60, 1)} · 每小時 ${M(e.rateSec * 3600)}` : '';
    let status = '', left = '--:--:--', pct = 0;
    if (info.type === 'work') {
      pct = L.workedAt(sec, cfg) / tw * 100;
      status = { before: '還沒上班', working: '上班中 💼', lunch: '午休中 🍱', after: '已下班 🎉' }[ph];
      if (ph !== 'after') left = L.clock(w.e - sec);
    } else if (info.type === 'pre') { status = '到職前'; }
    else { status = { off: '今天休息 😴', annual: '今天特休 🏖️', sick: '今天請假 🤒' }[info.type]; pct = info.type === 'off' ? 0 : 100; }
    o.status = status; o.left = ph === 'after' || info.type !== 'work' ? '今日已無倒數' : `下班倒數 ${left}`; o.pct = Math.min(100, pct);
    // 資歷
    const hi = L.hireInfo(now, x), first = new Date(today.getFullYear(), today.getMonth(), 1);
    o.worked = x.hire ? `${L.workedDays(now, x)} 天` : '—';
    const mc = monthCounts(today.getFullYear(), today.getMonth(), now);
    o.monthWork = `${mc.done} / ${mc.work}`;
    const wk = weekCounts(now);
    o.weekLeft = `${wk.left}`; o.weekPct = wk.total ? wk.done / wk.total * 100 : 0;
    // 計時器
    if (S.poop.start) {
      const s = (Date.now() - S.poop.start) / 1000;
      o.poopTimer = L.clock(s);
      o.poopEarn = info.type === 'work' ? `+${M(curRate() * s, 2)}` : '休息日不算帶薪';
    }
    const pdl = L.nextPayday(now, S.cfg.payday, S.cfg.payTime);
    if (pdl) {
      const s = Math.max(0, Math.floor((pdl.at - now) / 1000)), dd = Math.floor(s / 86400);
      o.payLeft = dd > 0 ? `${dd} 天 ${L.clock(s % 86400)}` : L.clock(s);
    }
    const mt = S.meeting, es =mt.acc + (mt.start ? (Date.now() - mt.start) / 1000 : 0);
    const hourly = mt.hourly > 0 ? mt.hourly : curRate() * 3600;
    o.meetTime = L.clock(es);
    o.meetCost = M(mt.n * hourly / 3600 * es, 0);
    void hi; void first;
    return o;
  }
  let lastDay = todayStr();
  function tick() {
    const now = new Date();
    if (todayStr() !== lastDay) { lastDay = todayStr(); render(true); return; }
    const v = live(now);
    $$('[data-live]').forEach(el => { const k = el.dataset.live; if (k in v && el.textContent !== v[k]) el.textContent = v[k]; });
    $$('[data-live-w]').forEach(el => { el.style.width = (v[el.dataset.liveW] || 0) + '%'; });
  }

  /* ───────── 分頁：今日 ───────── */
  function viewToday() {
    const x = X(), now = new Date(), c = S.cfg;
    const setup = !x.hire || !(c.salary > 0);
    const hi = L.hireInfo(now, x), lp = L.leavePeriod(now, x);
    let h = '<div class="grid">';
    if (setup) {
      h += `<section class="card setup span2"><h2>👋 先設定兩個數字就能開始</h2>
        <div class="row"><label class="field"><span>到職日</span><input type="date" data-path="cfg.hire" value="${esc(c.hire)}"></label>
        <label class="field"><span>固定月薪（實拿，只存在這台裝置）</span><input type="number" inputmode="numeric" min="0" data-path="cfg.salary" data-num value="${c.salary || ''}" placeholder="例如 40000"></label>
        <label class="field"><span>每日出勤津貼（沒有就空白）</span><input type="number" inputmode="numeric" min="0" data-path="cfg.allowance" data-num value="${c.allowance || ''}" placeholder="例如 135"></label></div>
        <p class="hint" style="margin-top:8px">上下班時間、午休、國定假日可到「設定」調整。資料只存在這個瀏覽器，不會上傳到任何地方。</p></section>`;
    }
    h += `<section class="card span2"><h2>💰 即時薪資 <span class="tag" data-live="status"></span></h2>
      <div class="big green" data-live="today">$0.00</div>
      <div class="sub">今天已經賺到（趣味版：固定月薪 ÷ 當月領薪日，再加每日出勤津貼，按工作秒數累積）</div>
      <div class="bar"><i data-live-w="pct"></i></div>
      <div class="row sp sub" style="margin-top:8px"><span class="neon-num" data-live="left"></span><span data-live="rate"></span></div>
      <div class="kv3"><div><div class="lbl">本月已賺</div><div class="mid" data-live="month"></div></div>
      <div><div class="lbl">今年已賺</div><div class="mid" data-live="year"></div></div>
      <div><div class="lbl">到職至今</div><div class="mid" data-live="total"></div></div></div></section>`;

    // 資歷
    let leaveTxt = '—', leaveSub = '';
    if (lp) {
      if (lp.entitled === 0) { leaveTxt = '未滿半年'; leaveSub = `${L.ymd(lp.next.date)} 起有 ${lp.next.days} 天`; }
      else { leaveTxt = `剩 ${lp.remaining} 天`; leaveSub = `本期共 ${lp.entitled} 天，已排 ${lp.used} 天`; }
    }
    h += `<section class="card"><h2>🗓️ 資歷</h2>
      <div class="big blue">${hi ? `第 ${hi.day}<small>天</small>` : '—'}</div>
      <div class="sub">${hi ? `已滿 ${hi.months} 個月 ${hi.days} 天` : '設定到職日後顯示'}</div>
      <div class="kv2"><div><div class="lbl">實際上班天數</div><div class="mid" data-live="worked"></div></div>
      <div><div class="lbl">本月上班（已上/全部）</div><div class="mid" data-live="monthWork"></div></div>
      <div><div class="lbl">特休</div><div class="mid">${esc(leaveTxt)}</div><div class="sub">${esc(leaveSub)}</div></div>
      <div><div class="lbl">這週還要上班</div><div class="mid"><span data-live="weekLeft"></span> 天</div></div></div></section>`;

    // 年終迷你卡
    const near = nearestTarget(now);
    h += `<section class="card"><h2>🎁 年終倒數 <span class="tag"><a href="#" data-act="tab" data-v="bonus" style="color:var(--blue);text-decoration:none">全部 ›</a></span></h2>`;
    if (near) {
      h += `<div class="big gold">${near.cd.days === 0 ? '就是今天！' : `${near.cd.days}<small>天</small>`}</div>
        <div class="sub">${esc(near.t.label)} · ${near.t.date}${near.t.guess ? ' <span class="pill">推測</span>' : ''}</div>
        <div class="kv2"><div><div class="lbl">約剩上班日</div><div class="mid">${near.cd.wd} 天</div></div>
        <div><div class="lbl">約剩週數</div><div class="mid">${(near.cd.days / 7).toFixed(1)} 週</div></div></div>`;
    } else h += '<p class="hint">目前沒有未到的目標日期，到「年終」分頁新增。</p>';
    h += '</section>';

    // 帶薪拉屎
    const pt = poopStats(r => L.ymd(new Date(r.t)) === todayStr());
    const running = !!S.poop.start;
    h += `<section class="card"><h2>💩 帶薪拉屎</h2>
      ${running ? `<div class="big gold neon-num" data-live="poopTimer">00:00:00</div><div class="sub" data-live="poopEarn"></div>` :
        `<div class="mid">今天 ${pt.n} 次 · ${fmtDur(pt.s)}</div><div class="sub">累計帶薪 ${M(pt.e, 2)}</div>`}
      <button class="btn poop-btn ${running ? 'run' : 'primary'}" data-act="poopToggle" style="margin-top:12px">${running ? '🧻 結束（按下去算錢）' : '🚽 開始'}</button></section>`;

    // 週 / 發薪日
    const pd = L.nextPayday(now, c.payday, c.payTime);
    let payNote = '';
    if (pd && c.salary > 0) {
      const pm = new Date(pd.date.getFullYear(), pd.date.getMonth() - (c.payOfPrev ? 1 : 0), 1);
      const mc = monthCounts(pm.getFullYear(), pm.getMonth(), now);
      payNote = `<div class="sub" style="margin-top:10px">預計入帳 <b>${pm.getMonth() + 1} 月薪資 ${M(mc.expect)}</b>（固定月薪＋${mc.work} 天津貼，不含加班費；以薪資單為準）</div>`;
    }
    h += `<section class="card"><h2>📆 這週與發薪日</h2>
      <div class="row sp"><div><div class="lbl">本週進度</div><div class="sub">還剩 <b class="neon-num" data-live="weekLeft"></b> 個上班日</div></div>
      ${pd ? `<div style="text-align:right"><div class="lbl">距離入帳（${pd.date.getMonth() + 1}/${pd.date.getDate()} ${esc(c.payTime)}）</div><div class="mid neon-num" data-live="payLeft"></div></div>` : ''}</div>
      <div class="bar"><i data-live-w="weekPct"></i></div>${payNote}
      ${pd ? '' : '<p class="hint" style="margin-top:10px">到「設定」填發薪日（每月幾號），這裡就會出現倒數。</p>'}</section>`;
    return h + '</div>';
  }
  function nearestTarget(now) {
    const x = X();
    let best = null;
    for (const t of S.targets) {
      const cd = L.countdown(t.date, now, x);
      if (cd && cd.days >= 0 && (!best || cd.days < best.cd.days)) best = { t, cd };
    }
    return best;
  }

  /* ───────── 分頁：班表 ───────── */
  function viewCal() {
    const now = new Date(), x = X(), [y, m] = curMonth(), today = L.startOfDay(now), d0 = todayDone(now);
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0).getDate(), mc = monthCounts(y, m, now);
    let cells = WDN.map(w => `<div class="wd">${w}</div>`).join('');
    for (let i = 0; i < first.getDay(); i++) cells += '<div class="day blank"></div>';
    for (let i = 1; i <= last; i++) {
      const d = new Date(y, m, i), info = L.dayInfo(d, x), isToday = d.getTime() === today.getTime();
      const done = info.type === 'work' && (d < today || (isToday && d0));
      let t = '';
      if (info.type === 'work') t = done ? '✓' : '';
      else if (info.type === 'annual') t = '特休';
      else if (info.type === 'sick') t = '請假';
      else if (info.isHol) t = '假日';
      cells += `<button class="day ${info.type}${done ? ' done' : ''}${isToday ? ' today' : ''}${info.isHol ? ' hol' : ''}" data-act="day" data-ds="${info.ds}">
        ${info.ot > 0 ? `<span class="ot">+${info.ot}h</span>` : ''}<span class="n">${i}</span><span class="t">${t}</span></button>`;
    }
    const nowM = now.getFullYear() * 12 + now.getMonth() === y * 12 + m;
    return `<div class="card">
      <div class="cal-head"><button class="btn sm" data-act="monthPrev">‹</button>
        <h3>${y} 年 ${m + 1} 月</h3>
        <div class="row" style="gap:6px">${nowM ? '' : '<button class="btn sm" data-act="monthNow">回本月</button>'}<button class="btn sm" data-act="monthNext">›</button></div></div>
      <div class="cal">${cells}</div>
      <div class="legend">
        <span class="pill"><i style="background:linear-gradient(135deg,#5ab0e8,#3ecf8e)"></i>已上班</span>
        <span class="pill blue"><i style="border:1.5px solid #5ab0e8"></i>待上班</span>
        <span class="pill gold"><i style="background:#d9b56a"></i>特休</span>
        <span class="pill pink"><i style="background:#f26d7d"></i>請假</span>
        <span class="pill">點日期可修改・補班、請假、加班時數</span></div></div>
      <div class="card" style="margin-top:14px"><h2>📊 ${m + 1} 月統計</h2>
        <div class="kv3"><div><div class="lbl">上班日</div><div class="mid">${mc.work} 天</div></div>
        <div><div class="lbl">已上 / 剩餘</div><div class="mid">${mc.done} / ${mc.work - mc.done}</div></div>
        <div><div class="lbl">特休 / 請假</div><div class="mid">${mc.annual} / ${mc.sick}</div></div></div>
        <div class="kv2"><div><div class="lbl">加班時數</div><div class="mid">${mc.ot} 小時</div></div>
        <div><div class="lbl">加班費估算</div><div class="mid">${S.cfg.salary > 0 ? M(mc.otPay) : '—'}</div></div></div>
        <div class="kv2"><div><div class="lbl">本月預估實拿（固定＋津貼，不含加班費）</div><div class="mid">${S.cfg.salary > 0 ? M(mc.expect) : '—'}</div></div>
        <div><div class="lbl">津貼（${L.allowanceOf(S.cfg) > 0 ? M(L.allowanceOf(S.cfg)) + ' × ' + mc.work + ' 天' : '未設定'}）</div><div class="mid">${S.cfg.salary > 0 ? M(L.allowanceOf(S.cfg) * mc.work) : '—'}</div></div></div>
        <div class="row" style="margin-top:12px"><button class="btn sm danger" data-act="clearMonth">清除本月手動修改</button></div>
        ${x.hire ? '' : '<p class="warn">還沒設定到職日，到職前的日子不會變灰。</p>'}</div>`;
  }
  let sheetDs = null;
  function openSheet(ds) {
    sheetDs = ds;
    const d = L.parse(ds), x = X(), info = L.dayInfo(d, x), name = `${d.getMonth() + 1} 月 ${d.getDate()} 日（週${WDN[d.getDay()]}）`;
    let body;
    if (info.type === 'pre') body = '<p class="hint">這天在到職日之前。</p>';
    else {
      const types = [['work', '上班'], ['off', '休息'], ['annual', '特休'], ['sick', '請假']];
      body = `<div class="seg">${types.map(([k, n]) => `<button class="${info.type === k ? 'on' : ''}" data-act="setType" data-t="${k}">${n}</button>`).join('')}</div>
        <div class="row" style="margin-top:14px"><label class="field"><span>加班時數（小時）</span><input type="number" min="0" max="12" step="0.5" inputmode="decimal" data-ot="${ds}" value="${info.ot || ''}" placeholder="0"></label></div>
        <p class="hint" style="margin-top:8px">${info.isHol ? '這天在國定假日清單裡。' : info.regular ? '預設上班日。' : '預設休息日。'}${info.ov ? '（目前是手動修改過的）' : ''}</p>`;
    }
    $('#sheet-root').innerHTML = `<div class="sheet-bg" data-act="closeSheet"><div class="sheet"><h3>${name}</h3>${body}
      <div class="row" style="margin-top:14px">${info.ov ? '<button class="btn" data-act="resetDay">恢復預設</button>' : ''}<button class="btn primary" style="margin-left:auto" data-act="closeSheet">完成</button></div></div></div>`;
  }
  function closeSheet() { sheetDs = null; $('#sheet-root').innerHTML = ''; }
  function setDayType(t) {
    const d = L.parse(sheetDs), info = L.dayInfo(d, X());
    const def = info.regular ? 'work' : 'off';
    if (t === def) delete S.overrides[sheetDs]; else S.overrides[sheetDs] = t;
    save(); render(true); openSheet(sheetDs);
  }

  /* ───────── 分頁：年終 ───────── */
  function viewBonus() {
    const now = new Date(), x = X(), c = S.cfg;
    let h = '<div class="grid">';
    for (const t of S.targets) {
      const cd = L.countdown(t.date, now, x), est = L.bonusEstimate(t.date, x);
      let pct = 0;
      if (cd && cd.days >= 0) {
        const start = x.hire || new Date(now.getFullYear(), 0, 1), tot = L.diffDays(start, cd.date);
        pct = tot > 0 ? Math.min(100, Math.max(0, L.diffDays(start, L.startOfDay(now)) / tot * 100)) : 0;
      } else if (cd) pct = 100;
      h += `<section class="card"><div class="row sp" style="margin-bottom:8px">
          <input type="text" data-tid="${t.id}" data-field="label" value="${esc(t.label)}" style="font-weight:700;max-width:70%">
          <button class="x" data-act="delTarget" data-id="${t.id}" aria-label="刪除">✕</button></div>
        <div class="row" style="margin-bottom:10px"><input type="date" data-tid="${t.id}" data-field="date" value="${esc(t.date)}" style="max-width:190px">${t.guess ? '<span class="pill gold">推測日期，請改成公司公告</span>' : '<span class="pill green">已確認</span>'}</div>
        ${!cd ? '<p class="warn">日期格式不正確</p>' : `
          <div class="big gold">${cd.days < 0 ? '已過了' : cd.days === 0 ? '就是今天！' : `${cd.days}<small>天</small>`}</div>
          <div class="sub">${cd.days > 0 ? `約 ${cd.wd} 個上班日 · ${(cd.days / 7).toFixed(1)} 週 · ${(cd.days / 30.44).toFixed(1)} 個月` : ' '}</div>
          <div class="bar"><i style="width:${pct}%"></i></div>`}
        <div class="sub" style="margin-top:8px">${est ? `預估 <b style="color:var(--green)">${M(est.amount)}</b>（月薪 × ${c.bonusMonths} 個月${c.bonusProrate ? ` × 在職比例 ${Math.round(est.ratio * 100)}%` : ''}）` : '設定月薪與到職日後會顯示預估'}</div>
        </section>`;
    }
    h += `<section class="card span2"><div class="row"><button class="btn primary" data-act="addTarget">＋ 新增日期</button><span class="hint">問到真正發放日後，把對應的那一列改掉即可。</span></div></section>
      <section class="card"><h2>🧮 年終預估設定</h2><div class="row">
        <label class="field"><span>年終月數</span><input type="number" step="0.5" min="0" inputmode="decimal" data-path="cfg.bonusMonths" data-num value="${c.bonusMonths}"></label>
        <label class="chk"><input type="checkbox" data-path="cfg.bonusProrate" ${c.bonusProrate ? 'checked' : ''}>年資未滿一年，按在職比例發</label></div>
        <p class="hint" style="margin-top:10px">年終獎金在法律上沒有統一規定，一切看契約、員工手冊或公司慣例；這裡只是依你填的月數估算，<b>不代表一定會有</b>。</p></section>
      <section class="card"><h2>❓ 去問 HR 的 5 個問題</h2><ol class="hint" style="padding-left:20px;display:flex;flex-direction:column;gap:6px">
        <li>年終大概哪一天發？每年固定，還是看公司營運與春節？</li>
        <li>要在發放日當天仍在職才領得到嗎？</li>
        <li>年資未滿一年（我到職約 ${L.hireInfo(now, x) ? L.hireInfo(now, x).months : 'N'} 個月）怎麼算？全額、按比例，還是沒有？</li>
        <li>金額怎麼算？幾個月？跟考績或績效有關嗎？</li>
        <li>這個規定寫在契約或員工手冊，還是每年由公司決定？</li></ol></section></div>`;
    return h;
  }

  /* ───────── 分頁：工具 ───────── */
  function viewTools() {
    const now = new Date(), x = X(), c = S.cfg, rate = curRate(), lp = L.leavePeriod(now, x);
    const noSal = '<p class="warn">先到「設定」填月薪，這個工具才算得出來。</p>';
    let h = '<div class="grid">';

    // 等價換算
    h += `<details class="card" open><summary><h2>⚖️ 等價換算：這個要工作多久？</h2></summary>
      ${rate > 0 ? `<div class="kv3" style="margin-top:0"><div><div class="lbl">每分鐘</div><div class="mid">${M(rate * 60, 1)}</div></div>
        <div><div class="lbl">每小時</div><div class="mid">${M(rate * 3600)}</div></div><div><div class="lbl">每工作日</div><div class="mid">${M(rate * L.totalWork(c))}</div></div></div>` : noSal}
      <div class="row" style="margin:14px 0 6px"><label class="field"><span>任意金額</span><input type="number" min="0" inputmode="numeric" id="eq-price" placeholder="例如 1200"></label>
        <div class="field"><span>要工作</span><div class="mid" id="eq-out">—</div></div></div>
      <div class="list">${S.items.map((it, i) => `<div class="eq-row"><div class="grow"><b>${esc(it.n)}</b> <span class="hint">${L.money(it.p)}</span></div>
        <div class="r mid" style="font-size:15px;color:var(--green)">${rate > 0 ? L.humanWork(it.p / rate, c) : '—'}</div><button class="x" data-act="delItem" data-i="${i}" aria-label="刪除">✕</button></div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><input type="text" id="item-n" placeholder="名稱" style="flex:1"><input type="number" id="item-p" placeholder="價格" min="0" inputmode="numeric" style="max-width:110px"><button class="btn sm" data-act="addItem">加入</button></div></details>`;

    // 加班費
    h += `<details class="card" open><summary><h2>⏰ 加班費計算（勞基法第 24 條）</h2></summary>
      ${c.salary > 0 ? '' : noSal}
      <div class="row"><label class="field"><span>加班日類型</span><select id="ot-kind"><option value="weekday">平日延長工時</option><option value="rest">休息日（週六等）</option><option value="holiday">國定假日</option></select></label>
      <label class="field"><span>加班時數</span><input type="number" id="ot-hours" min="0" max="12" step="0.5" inputmode="decimal" value="2"></label></div>
      <div id="ot-out" style="margin-top:12px"></div>
      <p class="hint" style="margin-top:10px">時薪＝月薪 ÷ 30 ÷ 8。這是依法定最低標準的估算；公司另有更優制度、或選擇補休時，以公司規定為準。例假日（一週固定休的那天）原則上不能要求出勤，不在這裡計算。</p></details>`;

    // 特休
    h += `<details class="card" open><summary><h2>🏖️ 特休（勞基法第 38 條，週年制）</h2></summary>`;
    if (!lp) h += '<p class="hint">先設定到職日。</p>';
    else {
      h += lp.entitled === 0
        ? `<div class="mid">還沒滿半年</div><div class="sub">${L.ymd(lp.next.date)} 起可休 ${lp.next.days} 天</div>`
        : `<div class="big blue">${lp.remaining}<small>天可休（本期共 ${lp.entitled} 天，已排 ${lp.used} 天）</small></div>
           <div class="sub">本期 ${L.ymd(lp.start)} ～ ${L.ymd(L.addDays(lp.end, -1))}，下一期 ${L.ymd(lp.end)} 起 ${L.leaveEntitlement(L.fullMonths(x.hire, lp.end))} 天</div>`;
      h += '<p class="hint" style="margin-top:10px">已排的特休天數來自「班表」裡標成特休的日子。法定是最低標準，公司可能用曆年制或給更多，請以公司規定為準；沒休完的特休，期末通常要折算成工資。</p>';
    }
    h += '</details>';

    // 會議燒錢
    const mt = S.meeting;
    h += `<details class="card"><summary><h2>🔥 會議燒錢計數器</h2></summary>
      <div class="meet-grid"><label class="field"><span>與會人數</span><input type="number" min="1" id="meet-n" value="${mt.n}"></label>
        <label class="field"><span>平均時薪（0＝用你的）</span><input type="number" min="0" id="meet-h" value="${mt.hourly || ''}" placeholder="預設用你的時薪"></label></div>
      <div class="big gold" data-live="meetCost" style="margin-top:14px">$0</div>
      <div class="sub">已經燒掉 · 會議時間 <span class="neon-num" data-live="meetTime">00:00:00</span></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="meetToggle">${mt.start ? '⏸ 暫停' : '▶ 開始'}</button><button class="btn" data-act="meetReset">歸零</button></div></details>`;

    // 拉屎紀錄
    const stM = poopStats(r => L.ymd(new Date(r.t)).slice(0, 7) === todayStr().slice(0, 7));
    const stA = poopStats(() => true);
    const longest = S.poop.log.reduce((a, r) => Math.max(a, r.s), 0);
    h += `<details class="card"><summary><h2>💩 帶薪拉屎紀錄</h2></summary>
      <div class="kv3" style="margin-top:0"><div><div class="lbl">本月</div><div class="mid">${stM.n} 次</div><div class="sub">${M(stM.e, 2)}</div></div>
        <div><div class="lbl">累計</div><div class="mid">${stA.n} 次</div><div class="sub">${M(stA.e, 2)}</div></div>
        <div><div class="lbl">最久一次</div><div class="mid">${fmtDur(longest)}</div><div class="sub">平均 ${stA.n ? fmtDur(stA.s / stA.n) : '—'}</div></div></div>
      <div class="list" style="margin-top:10px">${S.poop.log.slice(0, 8).map((r, i) => { const d = new Date(r.t); return `<div><div class="grow">${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}</div><div class="r">${fmtDur(r.s)}</div><div class="r" style="color:${r.paid ? 'var(--green)' : 'var(--muted)'}">${r.paid ? '+' + M(r.e, 2) : '不帶薪'}</div><button class="x" data-act="delPoop" data-i="${i}" aria-label="刪除">✕</button></div>`; }).join('') || '<p class="hint">還沒有紀錄。到「今日」按開始。</p>'}</div></details>`;
    return h + '</div>';
  }
  function updateEq() {
    const out = $('#eq-out'); if (!out) return;
    const p = parseFloat($('#eq-price').value) || 0, r = curRate();
    out.textContent = r > 0 && p > 0 ? L.humanWork(p / r, S.cfg) : '—';
  }
  function updateOT() {
    const out = $('#ot-out'); if (!out) return;
    const kind = $('#ot-kind').value, hrs = parseFloat($('#ot-hours').value) || 0;
    const r = L.otPay(L.otSalary(S.cfg), hrs, kind);
    if (!(S.cfg.salary > 0)) { out.innerHTML = ''; return; }
    out.innerHTML = `<div class="row sp"><div><div class="lbl">這天加班費</div><div class="big green">${M(r.total)}</div></div><div style="text-align:right"><div class="lbl">時薪</div><div class="mid">${M(r.hourly, 1)}</div></div></div>
      <div class="list" style="margin-top:8px">${r.rows.map(w => `<div><div class="grow">${w.label}</div><div class="r">${w.h} 小時 × ${w.mult}</div><div class="r">${M(w.v)}</div></div>`).join('')}</div>
      ${r.warn ? `<p class="warn">${esc(r.warn)}</p>` : ''}`;
  }

  /* ───────── 分頁：設定 ───────── */
  function viewSet() {
    const c = S.cfg;
    return `<div class="grid">
      <section class="card"><h2>👤 基本資料</h2><div class="stack">
        <label class="field"><span>到職日</span><input type="date" data-path="cfg.hire" value="${esc(c.hire)}"></label>
        <label class="field"><span>固定月薪（實拿，不含出勤津貼；只存在這台裝置）</span><input type="number" min="0" inputmode="numeric" data-path="cfg.salary" data-num value="${c.salary || ''}"></label>
        <label class="field"><span>每日出勤津貼（午餐＋交通等，上班才有；特休、請假、假日沒有）</span><input type="number" min="0" inputmode="numeric" data-path="cfg.allowance" data-num value="${c.allowance || ''}" placeholder="例如 135"></label>
        <label class="field"><span>加班費計算用的月薪（選填：薪資單的「應領」，未扣勞健保；空白＝用上面的固定月薪）</span><input type="number" min="0" inputmode="numeric" data-path="cfg.otBase" data-num value="${c.otBase || ''}" placeholder="不確定就留空"></label>
        <div class="row"><label class="field"><span>發薪日（每月幾號，0＝不顯示）</span><input type="number" min="0" max="31" inputmode="numeric" data-path="cfg.payday" data-num value="${c.payday || ''}" placeholder="例如 10"></label>
        <label class="field"><span>入帳時間</span><input type="time" data-path="cfg.payTime" value="${c.payTime}"></label></div>
        <label class="chk"><input type="checkbox" data-path="cfg.payOfPrev" ${c.payOfPrev ? 'checked' : ''}>發的是「上個月」的薪水（例如 12/10 領 11 月薪）</label></div></section>
      <section class="card"><h2>🕘 上下班時間</h2><div class="stack"><div class="row">
        <label class="field"><span>上班</span><input type="time" data-path="cfg.start" value="${c.start}"></label>
        <label class="field"><span>下班</span><input type="time" data-path="cfg.end" value="${c.end}"></label></div><div class="row">
        <label class="field"><span>午休開始</span><input type="time" data-path="cfg.lunchStart" value="${c.lunchStart}"></label>
        <label class="field"><span>午休分鐘</span><input type="number" min="0" max="240" data-path="cfg.lunchMin" data-num value="${c.lunchMin}"></label></div>
        <div><div class="lbl" style="margin-bottom:6px">平常上班的星期</div><div class="chips">${WDN.map((n, i) => `<label class="chk"><input type="checkbox" data-wd="${i}" ${c.workdays.includes(i) ? 'checked' : ''}>${n}</label>`).join('')}</div></div></div></section>
      <section class="card span2"><h2>🎌 國定假日 / 補班</h2>
        <textarea id="holidays" placeholder="2026-12-25&#10;2027-01-01">${esc(c.holidays.join('\n'))}</textarea>
        <p class="hint" style="margin-top:8px">每行一個日期（YYYY-MM-DD）。這裡的日期會當成休息日，並影響倒數的「上班日」數與每日薪資。請對照人事行政總處公告的行事曆填寫；補班日就直接到「班表」把那天點成上班。目前已填 <b>${c.holidays.length}</b> 天。</p></section>
      <section class="card"><h2>🔒 隱私</h2><label class="chk"><input type="checkbox" data-path="cfg.hide" ${c.hide ? 'checked' : ''}>隱藏所有金額（也可按右上角眼睛）</label>
        <p class="hint" style="margin-top:10px">所有資料只存在這個瀏覽器的 localStorage，沒有帳號、不上傳。換裝置或清除瀏覽資料前，請先匯出備份。</p></section>
      <section class="card"><h2>💾 備份</h2><div class="row"><button class="btn" data-act="export">匯出備份</button><button class="btn" data-act="import">匯入備份</button><button class="btn danger" data-act="reset">全部重設</button></div></section>
      <section class="card span2"><h2>ℹ️ 說明</h2><p class="hint">
        <b>即時薪資</b>是趣味估算：日薪＝月薪 ÷ 當月領薪日數（上班＋特休＋請假），再按已工作秒數（扣午休）累積。<b>加班費、特休</b>依勞基法第 24、38 條的最低標準估算，實際以公司規定與主管機關為準。<br>
        <b>安裝成 App</b>：手機用瀏覽器「加到主畫面」；電腦的 Chrome / Edge 網址列右側有「安裝」按鈕，會變成獨立視窗，離線也能用。</p></section></div>`;
  }

  /* ───────── 繪製與事件 ───────── */
  const VIEWS = { today: viewToday, cal: viewCal, bonus: viewBonus, tools: viewTools, set: viewSet };
  function render(keepScroll) {
    const y = window.scrollY;
    $('#view').innerHTML = VIEWS[S.ui.tab]();
    $('#tabbar').innerHTML = TABS.map(([k, n]) => `<button class="${S.ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${ICON[k]}<span>${n}</span></button>`).join('');
    const eye = $('#eyeBtn'); eye.innerHTML = S.cfg.hide ? ICON.eyeOff : ICON.eye; eye.classList.toggle('on', !!S.cfg.hide);
    if (S.ui.tab === 'tools') { updateOT(); }
    tick();
    if (keepScroll) window.scrollTo(0, y);
  }

  const ACT = {
    tab(b, e) { e.preventDefault(); S.ui.tab = b.dataset.v; save(); render(); window.scrollTo(0, 0); },
    toggleHide() { S.cfg.hide = !S.cfg.hide; save(); render(true); },
    monthPrev() { shiftMonth(-1); }, monthNext() { shiftMonth(1); }, monthNow() { S.ui.month = ''; save(); render(true); },
    day(b) { openSheet(b.dataset.ds); },
    closeSheet(b, e) { if (e.target === b || b.tagName === 'BUTTON') closeSheet(); },
    setType(b) { setDayType(b.dataset.t); },
    resetDay() { delete S.overrides[sheetDs]; save(); render(true); openSheet(sheetDs); },
    clearMonth() {
      const [y, m] = curMonth(), p = `${y}-${pad(m + 1)}-`;
      if (!confirm(`清除 ${m + 1} 月所有手動修改（特休、請假、補班、加班時數）？`)) return;
      for (const k of Object.keys(S.overrides)) if (k.startsWith(p)) delete S.overrides[k];
      for (const k of Object.keys(S.ot)) if (k.startsWith(p)) delete S.ot[k];
      save(); render(true);
    },
    addTarget() { S.targets.push({ id: Date.now(), label: '新日期', date: '', guess: true }); save(); render(true); },
    delTarget(b) { S.targets = S.targets.filter(t => String(t.id) !== b.dataset.id); save(); render(true); },
    poopToggle() {
      if (!S.poop.start) { S.poop.start = Date.now(); save(); render(true); return; }
      const sec = (Date.now() - S.poop.start) / 1000, paid = L.dayInfo(L.startOfDay(new Date()), X()).type === 'work';
      const earned = paid ? curRate() * sec : 0;
      S.poop.log.unshift({ t: S.poop.start, s: sec, e: earned, paid });
      S.poop.log = S.poop.log.slice(0, 500); S.poop.start = null; save(); render(true);
      toast(paid ? `這次 ${fmtDur(sec)}，帶薪 ${M(earned, 2)} 🎉` : `這次 ${fmtDur(sec)}，但今天不是上班日，沒有薪水…`);
    },
    delPoop(b) { S.poop.log.splice(+b.dataset.i, 1); save(); render(true); },
    meetToggle() {
      const mt = S.meeting;
      if (mt.start) { mt.acc += (Date.now() - mt.start) / 1000; mt.start = null; } else mt.start = Date.now();
      save(); render(true);
    },
    meetReset() { S.meeting.acc = 0; S.meeting.start = null; save(); render(true); },
    addItem() {
      const n = $('#item-n').value.trim(), p = parseFloat($('#item-p').value);
      if (!n || !(p > 0)) { toast('請填名稱與價格'); return; }
      S.items.push({ n, p }); save(); render(true);
    },
    delItem(b) { S.items.splice(+b.dataset.i, 1); save(); render(true); },
    export() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
      a.download = `workpulse-backup-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    import() { $('#importFile').click(); },
    reset() {
      if (!confirm('確定要清掉所有資料（到職日、月薪、班表、紀錄）嗎？無法復原。')) return;
      S = DEF(); save(); render(); toast('已重設');
    },
  };
  function shiftMonth(n) {
    const [y, m] = curMonth(), d = new Date(y, m + n, 1);
    S.ui.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; save(); render(true);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const f = ACT[b.dataset.act];
    if (f) f(b, e);
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'importFile') {
      const file = el.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (!isObj(d) || !isObj(d.cfg)) throw new Error('格式不對');
          S = merge(DEF(), d); save(); render(); toast('已匯入備份');
        } catch (err) { toast('匯入失敗：不是 WorkPulse 的備份檔'); }
        el.value = '';
      };
      r.readAsText(file);
    } else if (el.dataset.path) {
      let v = el.value;
      if (el.type === 'checkbox') v = el.checked; else if (el.hasAttribute('data-num')) v = parseFloat(v) || 0;
      setPath(el.dataset.path, v); save(); render(true);
    } else if (el.dataset.wd !== undefined) {
      const set = new Set(S.cfg.workdays); el.checked ? set.add(+el.dataset.wd) : set.delete(+el.dataset.wd);
      S.cfg.workdays = [...set].sort(); save(); render(true);
    } else if (el.id === 'holidays') {
      S.cfg.holidays = L.parseHolidays(el.value); save(); render(true); toast(`已記錄 ${S.cfg.holidays.length} 個假日`);
    } else if (el.dataset.tid) {
      const t = S.targets.find(q => String(q.id) === el.dataset.tid); if (!t) return;
      t[el.dataset.field] = el.value; if (el.dataset.field === 'date') t.guess = false;
      save(); render(true);
    } else if (el.dataset.ot !== undefined) {
      const v = parseFloat(el.value) || 0;
      if (v > 0) S.ot[el.dataset.ot] = Math.min(12, v); else delete S.ot[el.dataset.ot];
      save(); render(true); openSheet(el.dataset.ot);
    } else if (el.id === 'meet-n') { S.meeting.n = Math.max(1, parseInt(el.value, 10) || 1); save(); render(true); }
    else if (el.id === 'meet-h') { S.meeting.hourly = Math.max(0, parseFloat(el.value) || 0); save(); render(true); }
  });
  document.addEventListener('input', e => {
    const id = e.target.id;
    if (id === 'eq-price') updateEq(); else if (id === 'ot-hours' || id === 'ot-kind') updateOT();
  });

  render();
  setInterval(tick, 1000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 離線功能不可用而已 */ });
  }
  void saveTimer;
})();
