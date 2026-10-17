// Binder state: entries keyed by printing + finish + condition + binder, persisted to IndexedDB, with undo.
import { allCards, putCard, delCard, kvGet, kvSet, commitChanges } from './db.js';
import { priceOf, isOldFrame } from './carddb.js';
export const DEFAULT_BINDER = 'Unsorted';
export class Binder {
  constructor() { this.map = new Map(); this.undoStack = []; this.listeners = new Set(); this.sales = []; }
  async load() {
    const migrate = [];
    for (const e of await allCards()) {
      if (e.key.split('|').length < 4) { const n = { ...e, binder: e.binder || DEFAULT_BINDER, cond: e.cond || 'NM' }; n.key = Binder.key(n.id, n.finish, n.cond, n.binder); migrate.push([e.key, n]); }
      else this.map.set(e.key, e);
    }
    for (const [old, n] of migrate) { const cur = this.map.get(n.key); const v = cur ? { ...cur, qty: cur.qty + n.qty } : n; this.map.set(n.key, v); await putCard(v); await delCard(old); }
    this.sales = (await kvGet('sales')) || []; this.emit();
  }
  on(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach(f => f()); }
  entries() { return [...this.map.values()]; }
  binders() { const s = new Set([DEFAULT_BINDER]); for (const e of this.map.values()) s.add(e.binder || DEFAULT_BINDER); return [...s].sort((a, b) => a === DEFAULT_BINDER ? -1 : b === DEFAULT_BINDER ? 1 : a.localeCompare(b)); }
  static key(id, finish, cond = 'NM', binder = DEFAULT_BINDER) { return [id, finish, cond, binder].join('|'); }
  static fromPrint(p, finish, qty = 1, o = {}) {
    const cond = o.cond || 'NM', binder = o.binder || DEFAULT_BINDER;
    return { key: Binder.key(p.id, finish, cond, binder), id: p.id, name: p.name, set: p.set, set_name: p.set_name, cn: p.cn, rarity: p.rarity, frame: p.frame, old: isOldFrame(p),
      finish, qty, cond, binder, batch: o.batch ?? null, pile: o.pile || '', price: priceOf(p, finish) ?? null, added: Date.now(), updated: Date.now() };
  }
  get(key) { return this.map.get(key); }
  // ops are recorded as inverse actions so a whole scan (several cards) can be undone at once
  // commit-first: the whole batch is written in one IndexedDB transaction before memory changes, so a failed write changes nothing
  async _apply(changes, label) { // changes: [{key, before, after}]
    await commitChanges(changes);
    for (const c of changes) c.after ? this.map.set(c.key, c.after) : this.map.delete(c.key);
    if (label) { this.undoStack.push({ label, changes }); if (this.undoStack.length > 50) this.undoStack.shift(); }
    this.emit();
  }
  async add(items, label = 'Added') { // items: [{print, finish, qty, binder, cond, batch}]
    const changes = []; const pending = new Map();
    for (const it of items) {
      const o = { binder: it.binder || DEFAULT_BINDER, cond: it.cond || 'NM', batch: it.batch ?? null };
      const key = Binder.key(it.print.id, it.finish, o.cond, o.binder); const cur = pending.get(key) || this.map.get(key);
      const after = cur ? { ...cur, qty: cur.qty + (it.qty || 1), updated: Date.now(), batch: o.batch ?? cur.batch, added: o.batch != null ? Date.now() : cur.added } : Binder.fromPrint(it.print, it.finish, it.qty || 1, o);
      if (!pending.has(key)) changes.push({ key, before: this.map.get(key) || null, after }); else changes.find(c => c.key === key).after = after;
      pending.set(key, after);
    }
    await this._apply(changes, label); return changes;
  }
  async setQty(key, qty) { const cur = this.map.get(key); if (!cur) return; await this._apply([{ key, before: cur, after: qty > 0 ? { ...cur, qty, updated: Date.now() } : null }], qty > 0 ? 'Quantity' : 'Removed'); }
  async remove(key) { const cur = this.map.get(key); if (cur) await this._apply([{ key, before: cur, after: null }], 'Removed ' + cur.name); }
  // move an entry to another printing/finish/condition/binder, merging with an existing entry; returns the new key
  async change(key, print, finish, patch = {}, label = 'Changed printing') {
    const cur = this.map.get(key); if (!cur) return;
    const p = print || { id: cur.id, name: cur.name, set: cur.set, set_name: cur.set_name, cn: cur.cn, rarity: cur.rarity, frame: cur.frame, fin: 'nfe' };
    const f = finish || cur.finish, cond = patch.cond || cur.cond || 'NM', binder = patch.binder || cur.binder || DEFAULT_BINDER;
    const nk = Binder.key(p.id, f, cond, binder);
    if (nk === key) { if (patch.pile !== undefined || patch.cost !== undefined) await this._apply([{ key, before: cur, after: { ...cur, ...patch, updated: Date.now() } }], label); return key; }
    const tgt = this.map.get(nk);
    const base = print ? Binder.fromPrint(print, f, cur.qty, { cond, binder, batch: cur.batch, pile: cur.pile }) : { ...cur, key: nk, finish: f, cond, binder, price: cur.price };
    if (!print && finish && finish !== cur.finish) base.price = cur.price; // caller re-prices
    const after = tgt ? { ...tgt, qty: tgt.qty + cur.qty, updated: Date.now() } : { ...base, ...patch, cond, binder, added: cur.added, cost: cur.cost };
    await this._apply([{ key, before: cur, after: null }, { key: nk, before: tgt || null, after }], label);
    return nk;
  }
  async undo() {
    const u = this.undoStack[this.undoStack.length - 1]; if (!u) return null;
    const inv = u.changes.slice().reverse().map(c => ({ key: c.key, before: c.after, after: c.before }));
    await this._apply(inv, null); this.undoStack.pop(); return u.label;
  }
  // record a sale: takes qty copies out of the binder and logs price and profit
  async sell(key, qty, each) {
    const cur = this.map.get(key); if (!cur) return null; qty = Math.min(qty, cur.qty);
    const rec = { at: Date.now(), name: cur.name, set: cur.set, cn: cur.cn, id: cur.id, finish: cur.finish, cond: cur.cond, qty, each, cost: cur.cost ?? null, market: cur.price, entry: { ...cur } };
    this.sales.push(rec); await kvSet('sales', this.sales);
    await this._apply([{ key, before: cur, after: cur.qty > qty ? { ...cur, qty: cur.qty - qty, updated: Date.now() } : null }], 'Sold ' + cur.name);
    return rec;
  }
  async unsell(rec) { // put the copies back and drop the sale record
    const k = rec.entry.key, cur = this.map.get(k);
    await this._apply([{ key: k, before: cur || null, after: cur ? { ...cur, qty: cur.qty + rec.qty } : { ...rec.entry, qty: rec.qty } }], null);
    this.sales = this.sales.filter(s => s !== rec); await kvSet('sales', this.sales);
  }
  salesTotals() { let rev = 0, profit = 0, n = 0; for (const s of this.sales) { rev += s.each * s.qty; profit += (s.each - (s.cost ?? 0)) * s.qty; n += s.qty; } return { rev, profit, n }; }
  async updatePrices(fn) { const ch = []; for (const e of this.map.values()) { const p = fn(e); if (p !== undefined && p !== e.price) ch.push({ key: e.key, before: e, after: { ...e, price: p, priced: Date.now() } }); } if (ch.length) await this._apply(ch, null); return ch.length; }
  totals(list = this.entries(), unit = e => e.price) { let v = 0, n = 0, o5 = 0, o5v = 0; for (const e of list) { const u = unit(e) || 0; const t = u * e.qty; v += t; n += e.qty; if (u >= 5) { o5 += e.qty; o5v += t; } } return { value: v, count: n, unique: list.length, over5: o5, over5v: o5v }; }
  ownedByName() { const m = new Map(); for (const e of this.map.values()) m.set(e.name, (m.get(e.name) || 0) + e.qty); return m; }
}

// Every read-compute-write runs one at a time, so rapid taps / a scan finishing during an import can't read stale quantities.
for (const name of ['apply', 'add', 'setQty', 'remove', 'change', 'undo', 'updatePrices', 'sell', 'unsell']) {
  const op = name === 'apply' ? Binder.prototype._apply : Binder.prototype[name];
  Binder.prototype[name] = function (...args) { const next = (this.q || Promise.resolve()).then(() => op.apply(this, args)); this.q = next.catch(() => {}); return next; };
}
