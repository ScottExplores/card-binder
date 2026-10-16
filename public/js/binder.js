// Binder state: entries keyed by printing+finish, persisted to IndexedDB, with undo.
import { allCards, putCard, delCard } from './db.js';
import { priceOf, isOldFrame } from './carddb.js';
export class Binder {
  constructor() { this.map = new Map(); this.undoStack = []; this.listeners = new Set(); }
  async load() { for (const e of await allCards()) this.map.set(e.key, e); this.emit(); }
  on(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach(f => f()); }
  entries() { return [...this.map.values()]; }
  static key(id, finish) { return id + '|' + finish; }
  static fromPrint(p, finish, qty = 1) {
    return { key: Binder.key(p.id, finish), id: p.id, name: p.name, set: p.set, set_name: p.set_name, cn: p.cn, rarity: p.rarity, frame: p.frame, old: isOldFrame(p),
      finish, qty, price: priceOf(p, finish) ?? null, added: Date.now(), updated: Date.now() };
  }
  get(key) { return this.map.get(key); }
  // ops are recorded as inverse actions so a whole scan (several cards) can be undone at once
  async apply(changes, label) { // changes: [{key, before, after}]
    for (const c of changes) { if (c.after) { this.map.set(c.key, c.after); await putCard(c.after); } else { this.map.delete(c.key); await delCard(c.key); } }
    if (label) { this.undoStack.push({ label, changes }); if (this.undoStack.length > 50) this.undoStack.shift(); }
    this.emit();
  }
  async add(items, label = 'Added') { // items: [{print, finish, qty}]
    const changes = []; const pending = new Map();
    for (const it of items) {
      const key = Binder.key(it.print.id, it.finish); const cur = pending.get(key) || this.map.get(key);
      const after = cur ? { ...cur, qty: cur.qty + (it.qty || 1), updated: Date.now() } : Binder.fromPrint(it.print, it.finish, it.qty || 1);
      if (!pending.has(key)) changes.push({ key, before: this.map.get(key) || null, after }); else changes.find(c => c.key === key).after = after;
      pending.set(key, after);
    }
    await this.apply(changes, label); return changes;
  }
  async setQty(key, qty) { const cur = this.map.get(key); if (!cur) return; await this.apply([{ key, before: cur, after: qty > 0 ? { ...cur, qty, updated: Date.now() } : null }], qty > 0 ? 'Quantity' : 'Removed'); }
  async remove(key) { const cur = this.map.get(key); if (cur) await this.apply([{ key, before: cur, after: null }], 'Removed ' + cur.name); }
  // move one copy (or all) to another printing/finish, merging with an existing entry
  async change(key, print, finish) {
    const cur = this.map.get(key); if (!cur) return; const nk = Binder.key(print.id, finish); if (nk === key) return;
    const tgt = this.map.get(nk);
    const after = tgt ? { ...tgt, qty: tgt.qty + cur.qty, updated: Date.now() } : { ...Binder.fromPrint(print, finish, cur.qty), added: cur.added };
    await this.apply([{ key, before: cur, after: null }, { key: nk, before: tgt || null, after }], 'Changed printing');
    return nk;
  }
  async undo() {
    const u = this.undoStack.pop(); if (!u) return null;
    const inv = u.changes.slice().reverse().map(c => ({ key: c.key, before: c.after, after: c.before }));
    await this.apply(inv, null); return u.label;
  }
  async updatePrices(fn) { const ch = []; for (const e of this.map.values()) { const p = fn(e); if (p !== undefined && p !== e.price) ch.push({ key: e.key, before: e, after: { ...e, price: p, priced: Date.now() } }); } if (ch.length) await this.apply(ch, null); return ch.length; }
  totals(list = this.entries()) { let v = 0, n = 0, o5 = 0, o5v = 0; for (const e of list) { const t = (e.price || 0) * e.qty; v += t; n += e.qty; if ((e.price || 0) > 5) { o5 += e.qty; o5v += t; } } return { value: v, count: n, unique: list.length, over5: o5, over5v: o5v }; }
}
