// node tests/sync.test.js
// 用記憶體版假 Supabase 模擬多台裝置，驗證三方合併與「版本號比對才寫入」的防衝突行為。
const assert = require('node:assert/strict');
global.setTimeout = () => 0;          // 引擎的延遲排程在測試裡不要自己跑，改由測試手動 syncNow
global.clearTimeout = () => {};
const S = require('../docs/sync.js');

const clone = x => JSON.parse(JSON.stringify(x));
const DEF = () => ({
  v: 1,
  cfg: { salary: 0, allowance: 0, start: '09:00', workdays: [1, 2, 3, 4, 5], holidays: [], holNames: {}, payday: 10 },
  overrides: {}, ot: {},
  targets: [{ id: 1, label: '樂觀', date: '2026-12-31', guess: true }, { id: 2, label: '預期', date: '2027-02-03', guess: true }],
  poop: { log: [] }, items: [{ n: '手搖飲', p: 60 }, { n: '便當', p: 100 }], meeting: { n: 5, hourly: 0 },
});

const { makeDb } = require('./fakedb.js');

function device(db, name, uid = 'u1') {
  const d = { name, state: DEF(), seq: 0, meta: null, asked: [], answer: true, status: ['', ''], merged: [], uid };
  d.eng = S.createEngine({
    client: db, table: 'workpulse', getUserId: () => d.uid,
    getSnapshot: () => d.state, applySnapshot: s => { d.state = clone(s); }, defaultSnapshot: DEF, getSeq: () => d.seq,
    loadMeta: () => d.meta, saveMeta: m => { d.meta = clone(m); },
    confirmConflict: async names => { d.asked.push(names); return d.answer; },
    onStatus: (s, t) => { d.status = [s, t]; }, onMerged: t => d.merged.push(t),
  });
  d.edit = fn => { fn(d.state); d.seq++; d.eng.markDirty(); };
  d.cloud = () => JSON.parse(db.rows.get(uid).payload);
  return d;
}

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

(async () => {
  await t('三方合併：不同格的修改兩邊都保留', () => {
    const base = DEF(), local = DEF(), remote = DEF();
    local.overrides['2026-10-01'] = 'bereave'; local.cfg.salary = 40000;
    remote.overrides['2026-10-23'] = 'typhoon'; remote.cfg.allowance = 135;
    const r = S.mergeSynced(base, local, remote);
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.merged.overrides['2026-10-01'], 'bereave'); assert.equal(r.merged.overrides['2026-10-23'], 'typhoon');
    assert.equal(r.merged.cfg.salary, 40000); assert.equal(r.merged.cfg.allowance, 135);
  });

  await t('三方合併：同一格改成不同值才算衝突，可選擇偏向哪邊', () => {
    const base = DEF(), local = DEF(), remote = DEF();
    local.overrides['2026-10-01'] = 'bereave'; remote.overrides['2026-10-01'] = 'sick';
    const a = S.mergeSynced(base, local, remote, { prefer: 'local' });
    assert.deepEqual(a.conflicts, ['overrides.2026-10-01']); assert.equal(a.merged.overrides['2026-10-01'], 'bereave');
    assert.equal(S.mergeSynced(base, local, remote, { prefer: 'remote' }).merged.overrides['2026-10-01'], 'sick');
    assert.deepEqual(S.describeConflicts(a.conflicts), ['班表']);
  });

  await t('三方合併：刪除與新增（物件清單、集合）', () => {
    const base = DEF(), local = DEF(), remote = DEF();
    base.overrides['d1'] = 'annual'; local.overrides['d1'] = 'annual'; remote.overrides['d1'] = 'annual';
    delete local.overrides['d1'];                                   // 這台刪除，雲端沒動 → 刪
    local.targets.push({ id: 9, label: '新', date: '2027-03-01', guess: false });       // 這台新增
    remote.targets[0].date = '2026-12-25';                          // 雲端改了既有那筆
    local.cfg.holidays = ['2026-12-24']; remote.cfg.holidays = ['2027-01-04'];          // 各加一個假日
    remote.items = remote.items.filter(i => i.n !== '便當');         // 雲端刪了一個項目
    const r = S.mergeSynced(base, local, remote);
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.merged.overrides.d1, undefined);
    assert.deepEqual(r.merged.targets.map(x => x.id).sort(), [1, 2, 9]);
    assert.equal(r.merged.targets.find(x => x.id === 1).date, '2026-12-25');
    assert.deepEqual(r.merged.cfg.holidays.sort(), ['2026-12-24', '2027-01-04']);
    assert.deepEqual(r.merged.items.map(i => i.n), ['手搖飲']);
    // 一邊改了、一邊刪了 → 衝突
    const b2 = DEF(), l2 = DEF(), r2 = DEF();
    l2.targets[0].label = '改名'; r2.targets = r2.targets.filter(x => x.id !== 1);
    assert.deepEqual(S.mergeSynced(b2, l2, r2).conflicts, ['targets[1]']);
  });

  await t('第一台裝置：雲端沒資料 → 上傳，版本號 1', async () => {
    const db = makeDb(), A = device(db, 'A');
    A.state.cfg.salary = 40000; A.state.overrides['2026-10-01'] = 'bereave'; A.seq++;
    await A.eng.onSignedIn();
    assert.equal(db.rows.get('u1').rev, 1);
    assert.equal(A.cloud().cfg.salary, 40000);
    assert.equal(A.status[0], 'saved'); assert.equal(A.eng.isDirty(), false);
  });

  await t('第二台裝置第一次登入：載入雲端資料，不會被預設值蓋掉', async () => {
    const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
    A.state.cfg.salary = 40000; A.state.cfg.allowance = 135; A.seq++;
    await A.eng.onSignedIn();
    const before = JSON.stringify(db.rows.get('u1'));
    await B.eng.onSignedIn();                                       // B 是全新裝置（全是預設值）
    assert.equal(B.state.cfg.salary, 40000); assert.equal(B.state.cfg.allowance, 135);
    assert.deepEqual(B.asked, []);                                  // 沒有衝突、沒有詢問
    assert.equal(JSON.stringify(db.rows.get('u1')), before);        // 雲端一個字都沒被動
  });

  await t('兩台都有本機資料第一次連線：衝突才詢問，可選保留本機或雲端', async () => {
    for (const keepLocal of [true, false]) {
      const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
      A.state.cfg.salary = 40000; A.seq++; await A.eng.onSignedIn();
      B.state.cfg.salary = 38000; B.state.cfg.allowance = 135; B.seq++; B.answer = keepLocal;
      await B.eng.onSignedIn();
      assert.deepEqual(B.asked, [['設定']]);
      assert.equal(B.state.cfg.salary, keepLocal ? 38000 : 40000);
      assert.equal(B.state.cfg.allowance, 135);                     // 沒衝突的欄位一定保留
      assert.equal(B.cloud().cfg.salary, keepLocal ? 38000 : 40000);
    }
  });

  await t('兩台各改不同格：先後存檔，兩邊的修改都在', async () => {
    const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
    await A.eng.onSignedIn(); await B.eng.onSignedIn();
    A.edit(s => { s.overrides['2026-10-01'] = 'bereave'; });
    B.edit(s => { s.overrides['2026-10-23'] = 'typhoon'; s.ot['2026-10-12'] = 2; });
    await A.eng.syncNow(); await B.eng.syncNow();                   // B 發現雲端被 A 改過 → 合併
    assert.deepEqual(B.state.overrides, { '2026-10-01': 'bereave', '2026-10-23': 'typhoon' });
    assert.equal(B.cloud().ot['2026-10-12'], 2);
    assert.match(B.merged[0], /自動合併/);
    await A.eng.pullLatest();                                       // A 回到前景 → 拉到合併後的版本
    assert.deepEqual(A.state.overrides, B.state.overrides); assert.equal(A.state.ot['2026-10-12'], 2);
    assert.equal(db.rows.get('u1').rev, 3);
  });

  await t('搶寫：B 在「檢查完、寫入前」被 A 搶先 → 寫入被擋下、自動重試合併，沒有任何修改遺失', async () => {
    const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
    await A.eng.onSignedIn(); await B.eng.onSignedIn();
    B.edit(s => { s.overrides['2026-11-02'] = 'sick'; });
    A.edit(s => { s.overrides['2026-11-03'] = 'personal'; });
    db.beforeUpdate = () => {                                       // B 的 UPDATE 送出前，A 先把自己的修改寫進去
      db.beforeUpdate = null;
      const row = db.rows.get('u1');
      row.payload = JSON.stringify(A.state); row.rev += 1;
    };
    await B.eng.syncNow();
    assert.deepEqual(B.cloud().overrides, { '2026-11-02': 'sick', '2026-11-03': 'personal' });
    assert.deepEqual(B.state.overrides, B.cloud().overrides);
    assert.equal(db.rows.get('u1').rev, 3);                         // A 的寫入(2) + B 重試成功(3)
  });

  await t('刪除會傳播：A 刪掉一筆、B 沒動過 → B 拉下來也被刪', async () => {
    const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
    A.state.overrides['2026-10-01'] = 'annual'; A.seq++;
    await A.eng.onSignedIn(); await B.eng.onSignedIn();
    assert.equal(B.state.overrides['2026-10-01'], 'annual');
    A.edit(s => { delete s.overrides['2026-10-01']; }); await A.eng.syncNow();
    await B.eng.pullLatest();
    assert.deepEqual(B.state.overrides, {});
  });

  await t('清單合併：一台改既有年終日期、另一台新增日期 → 都保留', async () => {
    const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
    await A.eng.onSignedIn(); await B.eng.onSignedIn();
    A.edit(s => { const x = s.targets.find(q => q.id === 2); x.date = '2027-02-04'; x.guess = false; });
    B.edit(s => { s.targets.push({ id: 7, label: '公司公告', date: '2027-01-20', guess: false }); });
    await A.eng.syncNow(); await B.eng.syncNow();
    const ids = B.state.targets.map(x => x.id).sort();
    assert.deepEqual(ids, [1, 2, 7]);
    assert.equal(B.state.targets.find(x => x.id === 2).date, '2027-02-04');
  });

  await t('同步途中使用者又改了東西：不會被覆蓋掉', async () => {
    const db = makeDb(), A = device(db, 'A'), B = device(db, 'B');
    await A.eng.onSignedIn(); await B.eng.onSignedIn();
    A.edit(s => { s.cfg.salary = 41000; }); await A.eng.syncNow();
    B.edit(s => { s.overrides['2026-11-02'] = 'sick'; });
    db.afterSelect = () => B.edit(s => { s.overrides['2026-11-03'] = 'personal'; });   // B 的 SELECT 回來後、寫入前，使用者又標了一天
    await B.eng.syncNow();
    assert.equal(B.state.cfg.salary, 41000);                         // A 的修改進來了
    assert.equal(B.state.overrides['2026-11-02'], 'sick');
    assert.equal(B.state.overrides['2026-11-03'], 'personal');       // 同步途中的修改還在
    await B.eng.syncNow();                                           // 之後的同步把它送上去
    assert.equal(B.cloud().overrides['2026-11-03'], 'personal');
    assert.equal(B.cloud().cfg.salary, 41000);
  });

  await t('離線：保留未同步的修改，恢復連線後自動補上', async () => {
    const db = makeDb(), A = device(db, 'A');
    await A.eng.onSignedIn();
    db.down = true;
    A.edit(s => { s.overrides['2026-11-02'] = 'sick'; });
    await A.eng.syncNow();
    assert.equal(A.status[0], 'offline'); assert.equal(A.eng.isDirty(), true);
    assert.equal(A.state.overrides['2026-11-02'], 'sick');
    db.down = false;
    await A.eng.syncNow();
    assert.equal(A.status[0], 'saved'); assert.equal(A.cloud().overrides['2026-11-02'], 'sick');
  });

  await t('資料表不存在：顯示明確錯誤，本機資料不受影響', async () => {
    const db = makeDb(), A = device(db, 'A');
    db.missing = true;
    A.state.cfg.salary = 40000; A.seq++;
    await A.eng.onSignedIn();
    assert.equal(A.status[0], 'error'); assert.match(A.status[1], /workpulse 資料表/);
    assert.equal(A.state.cfg.salary, 40000);
  });

  await t('沒登入：什麼都不做；登出後狀態清空', async () => {
    const db = makeDb(), A = device(db, 'A');
    A.uid = null; A.edit(s => { s.cfg.salary = 1; }); await A.eng.syncNow();
    assert.equal(db.rows.size, 0); assert.equal(A.status[0], 'off');
    A.uid = 'u1'; await A.eng.onSignedIn(); A.eng.onSignedOut();
    assert.equal(A.eng.getMeta().base, null);
  });

  await t('不同帳號的資料互不干擾（每人一列）', async () => {
    const db = makeDb(), A = device(db, 'A', 'u1'), C = device(db, 'C', 'u2');
    A.state.cfg.salary = 40000; A.seq++; await A.eng.onSignedIn();
    C.state.cfg.salary = 55000; C.seq++; await C.eng.onSignedIn();
    assert.equal(JSON.parse(db.rows.get('u1').payload).cfg.salary, 40000);
    assert.equal(JSON.parse(db.rows.get('u2').payload).cfg.salary, 55000);
  });

  console.log(`\n${n} 組同步測試通過`);
})().catch(e => { console.error(e); process.exit(1); });
