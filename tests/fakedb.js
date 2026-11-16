// 記憶體版假 Supabase（只實作同步引擎用到的 select / insert / update + eq + select），給測試共用
const clone = x => JSON.parse(JSON.stringify(x));

function makeDb() {
  const rows = new Map();
  const db = { rows, down: false, missing: false, beforeUpdate: null, afterSelect: null, updates: 0 };
  class Q {
    constructor() { this.op = 'select'; this.f = []; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    eq(c, v) { this.f.push([c, v]); return this; }
    limit() { return this; }
    insert(v) { this.op = 'insert'; this.v = v; return this; }
    update(v) { this.op = 'update'; this.v = v; return this; }
    then(res, rej) { return new Promise(r => r(this.exec())).then(res, rej); }
    exec() {
      if (db.down) throw new TypeError('Failed to fetch');
      if (db.missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.workpulse' in the schema cache" } };
      const match = () => [...rows.values()].filter(r => this.f.every(([c, v]) => r[c] === v));
      if (this.op === 'select') {
        const data = clone(match());
        if (db.afterSelect) { const f = db.afterSelect; db.afterSelect = null; f(); }
        return { data, error: null };
      }
      if (this.op === 'insert') {
        if (rows.has(this.v.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        rows.set(this.v.id, clone(this.v));
        return { data: [{ rev: this.v.rev }], error: null };
      }
      if (db.beforeUpdate) { const f = db.beforeUpdate; db.beforeUpdate = null; f(); }
      db.updates++;
      const hit = match();
      for (const r of hit) Object.assign(r, clone(this.v));
      return { data: hit.map(r => ({ rev: r.rev })), error: null };
    }
  }
  db.from = () => new Q();
  return db;
}

module.exports = { makeDb };
