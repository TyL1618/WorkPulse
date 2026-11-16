/* WorkPulse · 雲端同步引擎（純邏輯，不碰 DOM；Node 也能跑測試）
 *
 * 架構（與 WealthMatrix / VaultMe 同一個 Supabase 專案，各自一張表；本表為 workpulse）：
 *   表 workpulse(id = 使用者 UUID, payload = JSON 字串, updated = ISO 時間, rev = 版本號整數)，RLS 只能讀寫自己的那一列。
 *
 * 防衝突三道防線：
 *   1. 寫入用「版本號比對」(compare-and-swap)：UPDATE ... WHERE rev = 我讀到的版本。
 *      兩台同時存檔時只會有一台寫得進去，另一台拿到 0 列 → 重新讀、合併、再寫。不會有「檢查完才被別台搶先」的空窗。
 *   2. 三方合併：用「上次同步的資料(base) / 這台的修改(local) / 雲端最新(remote)」逐欄位合併，
 *      只有一邊改就採用那邊；兩邊改了同一格成不同值才算衝突，這時才問使用者。
 *   3. 絕不用空資料或預設值去覆蓋雲端：沒有 base 時用「預設值」當 base，所以預設值不會蓋掉雲端的設定。
 */
(function (root) {
  'use strict';

  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  function stable(x) {
    if (x === undefined) return 'undefined';
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (isObj(x)) {
      return '{' + Object.keys(x).filter(k => x[k] !== undefined).sort()
        .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
    }
    return JSON.stringify(x);
  }
  const eq = (a, b) => stable(a) === stable(b);
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  /* ───────── 三方合併 ───────── */
  // 陣列的合併方式：有 key 的是「物件清單」（依 key 對應、可逐欄位合併）；set 是「集合」（逐元素增減）
  const SPECS = {
    'targets': { key: 'id' },
    'items': { key: 'n' },
    'poop.log': { key: 't' },
    'cfg.holidays': { set: true },
    'cfg.workdays': { set: true },
  };
  const AREA = {
    cfg: '設定', overrides: '班表', ot: '加班時數', targets: '年終日期', items: '等價換算清單',
    poop: '拉屎紀錄', meeting: '會議計數器',
  };
  /** 把衝突路徑換成使用者看得懂的區塊名稱 */
  function describeConflicts(conflicts) {
    const names = [];
    for (const c of conflicts) {
      const n = AREA[String(c).split(/[.[]/)[0]] || String(c);
      if (!names.includes(n)) names.push(n);
    }
    return names;
  }

  function mergeSet(b, l, r) {
    const B = new Set(b || []), L = new Set(l), R = new Set(r), out = [];
    for (const x of [...l, ...r.filter(v => !L.has(v))]) {
      const inB = B.has(x), inL = L.has(x), inR = R.has(x);
      if ((inL && inR) || !inB) { if (!out.includes(x)) out.push(x); }   // 兩邊都有，或任一邊新增 → 留；任一邊刪除 → 刪
    }
    return out.every(v => typeof v === 'number') ? out.sort((a, c) => a - c) : out;
  }

  function mergeKeyed(b, l, r, path, key, ctx) {
    const idx = a => new Map((a || []).map(x => [String(x[key]), x]));
    const B = idx(b), L = idx(l), R = idx(r), out = [], done = new Set();
    const decide = k => {
      const inB = B.has(k), inL = L.has(k), inR = R.has(k);
      if (inL && inR) return merge3(B.get(k), L.get(k), R.get(k), `${path}[${k}]`, ctx);
      if (inL) {                                   // 只有這台有
        if (!inB) return L.get(k);                 // 這台新增的
        if (eq(L.get(k), B.get(k))) return undefined;   // 雲端刪了、這台沒動 → 刪
        ctx.conflicts.push(`${path}[${k}]`);       // 這台改過、雲端刪了
        return ctx.prefer === 'remote' ? undefined : L.get(k);
      }
      if (inR) {                                   // 只有雲端有
        if (!inB) return R.get(k);
        if (eq(R.get(k), B.get(k))) return undefined;   // 這台刪了、雲端沒動 → 刪
        ctx.conflicts.push(`${path}[${k}]`);       // 雲端改過、這台刪了
        return ctx.prefer === 'remote' ? R.get(k) : undefined;
      }
      return undefined;
    };
    for (const x of [...(l || []), ...(r || [])]) {
      const k = String(x[key]);
      if (done.has(k)) continue;
      done.add(k);
      const v = decide(k);
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  function merge3(b, l, r, path, ctx) {
    if (eq(l, r)) return l;
    if (eq(l, b)) return r;                         // 這台沒動 → 用雲端的
    if (eq(r, b)) return l;                         // 雲端沒動 → 用這台的
    const spec = SPECS[path];
    if (Array.isArray(l) && Array.isArray(r) && spec) {
      return spec.set ? mergeSet(b, l, r) : mergeKeyed(b, l, r, path, spec.key, ctx);
    }
    if (isObj(l) && isObj(r)) {
      const bb = isObj(b) ? b : {}, out = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
        const v = merge3(bb[k], l[k], r[k], path ? path + '.' + k : k, ctx);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    ctx.conflicts.push(path || '(root)');           // 兩邊把同一格改成不同的值
    return ctx.prefer === 'remote' ? r : l;
  }
  /** prefer：發生衝突時預設採用哪一邊（'local' | 'remote'） */
  function mergeSynced(base, local, remote, opts) {
    const ctx = { conflicts: [], prefer: (opts && opts.prefer) || 'local' };
    const merged = merge3(clone(base) || {}, clone(local), clone(remote), '', ctx);
    return { merged, conflicts: ctx.conflicts };
  }

  /* ───────── 同步引擎 ───────── */
  const isNetworkError = e => !!e && (e.name === 'TypeError' || /fetch|network|failed to load/i.test(String(e.message || e)));
  const isMissingTable = e => !!e && (e.code === 'PGRST205' || e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));
  const nowIso = () => new Date().toISOString();

  /**
   * o = {
   *   client            Supabase client（只用 .from(table).select/insert/update）
   *   table             資料表名
   *   getUserId()       目前登入的使用者 id（沒登入回 null）
   *   getSnapshot()     取得「要同步的那份資料」（不含這台專屬設定）
   *   applySnapshot(s)  把雲端／合併後的資料套回本機（不可再觸發 markDirty）
   *   defaultSnapshot() 預設資料（沒有 base 時的共同祖先）
   *   getSeq()          本機每次編輯就 +1 的計數（偵測同步途中使用者又改了東西）
   *   loadMeta() / saveMeta(m)   持久化 { baseRev, base, dirty }
   *   confirmConflict(names, conflicts) → Promise<boolean>   true＝衝突時保留這台；false＝改用雲端
   *   onStatus(state, text)      state: off | idle | saving | saved | offline | error
   *   onMerged(text)             自動合併完成的提示
   * }
   */
  function createEngine(o) {
    let meta = Object.assign({ baseRev: null, base: null, dirty: false }, o.loadMeta() || {});
    let busy = false, again = false, timer = 0;
    const persist = () => o.saveMeta(meta);
    const isDirty = () => meta.dirty || !meta.base || stable(o.getSnapshot()) !== stable(meta.base);
    const status = (s, t) => o.onStatus && o.onStatus(s, t || '');

    async function fetchRow(uid) {
      const r = await o.client.from(o.table).select('rev,payload,updated').eq('id', uid).limit(1);
      if (r.error) throw r.error;
      return r.data && r.data[0] ? r.data[0] : null;
    }
    const parse = row => { try { return JSON.parse(row.payload); } catch (e) { throw new Error('雲端資料格式錯誤'); } };

    /** 把 final 套回本機；若同步途中使用者又改了東西，把那些修改疊在 final 上，不能丟 */
    function applyResult(startLocal, final, seqAtStart) {
      const cur = o.getSnapshot();
      if (o.getSeq() !== seqAtStart && stable(cur) !== stable(startLocal)) {
        o.applySnapshot(mergeSynced(startLocal, cur, final).merged);
      } else if (stable(final) !== stable(cur)) {
        o.applySnapshot(final);
      }
    }
    const settle = (rev, written) => {
      meta.baseRev = rev; meta.base = clone(written);
      meta.dirty = stable(o.getSnapshot()) !== stable(written);
      persist();
    };

    async function push() {
      const uid = o.getUserId();
      if (!uid) return;
      for (let attempt = 0; attempt < 5; attempt++) {
        const seq = o.getSeq(), local = clone(o.getSnapshot()), row = await fetchRow(uid);
        if (!row) {                                          // 雲端還沒有這個帳號的資料 → 第一次上傳
          const ins = await o.client.from(o.table).insert({ id: uid, payload: JSON.stringify(local), updated: nowIso(), rev: 1 }).select('rev');
          if (ins.error) { if (ins.error.code === '23505') continue; throw ins.error; }   // 別台剛好先建了 → 重來
          settle(1, local); return 'pushed';
        }
        const remote = parse(row);
        let toWrite = local;
        if (!meta.baseRev || row.rev > meta.baseRev) {       // 雲端在我們上次同步後被改過 → 三方合併
          const base = meta.base || o.defaultSnapshot();
          let res = mergeSynced(base, local, remote, { prefer: 'local' });
          if (res.conflicts.length) {
            const keepLocal = await o.confirmConflict(describeConflicts(res.conflicts), res.conflicts);
            if (!keepLocal) res = mergeSynced(base, local, remote, { prefer: 'remote' });
          }
          toWrite = res.merged;
        }
        if (eq(toWrite, remote)) {                           // 合併後跟雲端一樣：不用寫
          applyResult(local, toWrite, seq); settle(row.rev, toWrite); return 'uptodate';
        }
        const upd = await o.client.from(o.table)
          .update({ payload: JSON.stringify(toWrite), updated: nowIso(), rev: row.rev + 1 })
          .eq('id', uid).eq('rev', row.rev).select('rev');
        if (upd.error) throw upd.error;
        if (!upd.data || !upd.data.length) continue;         // 被別台搶先寫入 → 重新讀、合併、再寫
        const merged = !eq(toWrite, local);
        applyResult(local, toWrite, seq); settle(row.rev + 1, toWrite);
        if (merged) o.onMerged && o.onMerged('已自動合併其他裝置的修改');
        return 'pushed';
      }
      throw new Error('同步競爭太多次，請稍後再試');
    }

    async function pull() {
      const uid = o.getUserId();
      if (!uid) return;
      const row = await fetchRow(uid);
      if (!row) return isDirty() ? push() : 'empty';
      if (meta.baseRev && row.rev <= meta.baseRev) return 'uptodate';
      if (isDirty()) return push();                          // 本機有未同步的修改 → 走合併
      const remote = parse(row);
      o.applySnapshot(remote);
      settle(row.rev, remote);
      return 'pulled';
    }

    async function sync(mode) {                              // mode: 'push' | 'pull' | 'auto'
      if (!o.getUserId()) { status('off', ''); return; }
      if (busy) { again = true; return; }
      busy = true; status('saving', '同步中');
      try {
        const r = (mode === 'pull' && !isDirty()) ? await pull() : isDirty() ? await push() : await pull();
        status('saved', r === 'pulled' ? '已載入雲端最新資料' : '已同步');
      } catch (e) {
        if (isMissingTable(e)) status('error', '找不到 workpulse 資料表，請先到 Supabase 執行建表 SQL（見 README）');
        else if (isNetworkError(e)) status('offline', '離線，恢復連線後會自動同步');
        else status('error', '同步失敗：' + (e.message || e));
      } finally {
        busy = false;
        if (again) { again = false; schedule(300); }
      }
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => sync('auto'), ms); }

    return {
      /** 本機資料有變動時呼叫；只有「要同步的那份」真的變了才會排程上傳 */
      markDirty() {
        if (!o.getUserId()) return;
        if (!meta.base || stable(o.getSnapshot()) !== stable(meta.base)) { meta.dirty = true; persist(); schedule(1500); }
      },
      syncNow: () => sync('auto'),
      pullLatest: () => sync('pull'),
      flush() { clearTimeout(timer); return sync('auto'); },
      /** 登入後第一次連線：本機資料一律視為「有待合併的修改」，base 用預設值 */
      onSignedIn() { meta = { baseRev: null, base: null, dirty: true }; persist(); return sync('auto'); },
      onSignedOut() { meta = { baseRev: null, base: null, dirty: false }; persist(); status('off', ''); },
      getMeta: () => meta,
      isDirty,
    };
  }

  const api = { mergeSynced, describeConflicts, createEngine, stable, SPECS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WPSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
