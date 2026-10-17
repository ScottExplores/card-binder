// Decks tab: build/check a deck for a format. Commander: pick the commander first, then sweep the deck on video.
// Alerts name the exact card: banned, not legal, outside color identity, duplicate (singleton), wrong count.
import { db, img, priceOf, defaultFinish, isOldFrame } from './carddb.js';
import { info, FORMATS, FORMAT_LABEL, isBasic } from './meta.js';
import { checkDeck, mainType } from './deckcheck.js';
import { kvGet, kvSet } from './db.js';
import { $, $$, esc, money, short, toast, openSheet, closeSheet, alertBuzz, copyOrSave, stamp, download } from './ui.js';
import { openPicker, printsFor, nameSearch, bestArt } from './picker.js';
import { exportMoxfield, exportArchidekt, exportGoldfish } from './csv.js';
let ctx; export const D = { decks: [], cur: null };
export async function initDecks(c) { ctx = c; D.decks = (await kvGet('decks')) || []; render(); }
const save = () => kvSet('decks', D.decks);
export const getDeck = id => D.decks.find(d => d.id === id);
const pr = id => db().byId.get(id);
const ICON = { banned: '⛔', notlegal: '⛔', restricted: '①', color: '◐', singleton: '×2', size: '#', cmdcount: '♛', cmdpair: '♛', badcmd: '♛', companion: '♛', unknown: '?' };
export function check(d) { return checkDeck({ format: d.format, commanders: d.commanders.map(c => c.name), cards: d.cards.map(c => ({ name: c.name, qty: c.qty })) }, info); }
export function usedInDecks() { const m = new Map(); for (const d of D.decks) { for (const c of d.cards) m.set(c.name, (m.get(c.name) || 0) + c.qty); for (const c of d.commanders) m.set(c.name, (m.get(c.name) || 0) + 1); } return m; }
export function newDeck(format = 'commander', name) { const d = { id: Math.random().toString(36).slice(2), name: name || `${FORMAT_LABEL[format]} deck ${D.decks.length + 1}`, format, commanders: [], cards: [], updated: Date.now() }; D.decks.unshift(d); save(); return d; }
// add scanned cards; alerts for anything new that breaks the rules
export function addToDeck(d, items, { quiet = false } = {}) {
  const before = new Set(check(d).issues.map(i => i.kind + i.name));
  for (const it of items) {
    const p = it.print; const ex = d.cards.find(c => c.id === p.id && c.finish === it.finish);
    if (ex) { ex.qty += it.qty || 1; if (it.conf === 'low') ex.conf = 'low'; } else d.cards.push({ id: p.id, name: p.name, finish: it.finish || defaultFinish(p), qty: it.qty || 1, conf: it.conf || 'high', thumb: it.thumb || '' });
  }
  d.updated = Date.now(); save();
  const r = check(d); const fresh = r.issues.filter(i => i.name && !before.has(i.kind + i.name));
  if (!quiet && fresh.length) { alertBuzz('warn'); toast('⚠ ' + fresh[0].msg + (fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''), null, 4500); }
  if (D.cur === d.id) render();
  return { r, fresh };
}
export function setCommander(d, p, replace = true) {
  if (replace) d.commanders = [{ id: p.id, name: p.name }]; else if (!d.commanders.some(c => c.name === p.name)) d.commanders.push({ id: p.id, name: p.name });
  d.cards = d.cards.filter(c => c.name !== p.name || (c.qty -= 1) > 0); d.updated = Date.now(); save(); render();
  const i = info(p.name); if (i && !i.cmdr) { alertBuzz('warn'); toast(`⚠ ${short(p.name)} can’t be a commander`, null, 4000); } else toast(`Commander: ${short(p.name)} · colors ${i?.ci || 'colorless'}`);
}
// ---------- rendering
export function render() {
  const root = $('#decks-body'); if (!root) return;
  const d = D.cur && getDeck(D.cur);
  if (!d) {
    root.innerHTML = `<div class="dk-head"><h2>Decks</h2></div>
      <button class="btn big primary" id="dk-new">+ Check a deck</button>
      <div class="sub small" style="margin:8px 4px 14px">Pick a format, then record a video while you deal the deck one card at a time. Commander: pick your commander first.</div>
      ${D.decks.map(x => { const r = check(x); const c = x.commanders[0] && pr(x.commanders[0].id); return `<div class="li dk-li" data-id="${x.id}">${c ? `<img src="${img(c, 'small')}" alt="">` : '<div class="dk-ph">▤</div>'}<div class="t"><div class="n">${esc(x.name)}</div><div class="s">${FORMAT_LABEL[x.format]} · ${r.total}${r.exact ? '/' + r.target : ''} cards</div></div><div class="dk-st ${r.ok ? 'ok' : 'warn'}">${r.ok ? '✓ Legal' : `⚠ ${r.issues.length}`}</div></div>`; }).join('') || '<div class="empty">No decks yet.</div>'}`;
    root.querySelector('#dk-new').onclick = newDeckSheet;
    root.querySelectorAll('.dk-li').forEach(el => el.onclick = () => { D.cur = el.dataset.id; render(); root.scrollTop = 0; });
    return;
  }
  const r = check(d); const isCmd = d.format === 'commander'; const unsure = d.cards.filter(c => c.conf === 'low');
  const val = d.cards.reduce((s, c) => s + (priceOf(pr(c.id) || {}, c.finish) || 0) * c.qty, 0) + d.commanders.reduce((s, c) => s + (priceOf(pr(c.id) || {}) || 0), 0);
  const bad = new Map(); r.issues.forEach(i => i.name && bad.set(i.name, i));
  const groups = {}; for (const c of d.cards) { const t = mainType(info(c.name)?.type || ''); (groups[t] ||= []).push(c); }
  const order = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other'];
  const s = r.stats; const cmax = Math.max(1, ...s.curve);
  const countTxt = r.exact ? (r.total === r.target ? `${r.total} / ${r.target} ✓` : `${r.total} / ${r.target}`) : `${r.total} cards${r.total < r.target ? ` · need ${r.target}` : ''}`;
  const countSub = r.exact ? (r.total < r.target ? `${r.target - r.total} short` : r.total > r.target ? `${r.total - r.target} over` : 'Exactly right') : '';
  root.innerHTML = `<div class="dk-head"><button class="btn ghost small" id="dk-back">‹ Decks</button><input class="dk-name" id="dk-name" value="${esc(d.name)}" aria-label="Deck name"></div>
    <div class="row gap"><select id="dk-fmt" class="sel">${FORMATS.map(f => `<option value="${f}" ${f === d.format ? 'selected' : ''}>${FORMAT_LABEL[f]}</option>`).join('')}</select><div class="sub small">${money(val)}</div></div>
    ${isCmd ? `<div class="dk-cmd">${d.commanders.map(c => `<button class="dk-cmdc" data-id="${c.id}"><img src="${img(pr(c.id) || c, 'normal')}" alt=""><span>♛ ${esc(short(c.name))}</span></button>`).join('')}
      <button class="dk-cmdc add" id="dk-cmd-pick">${d.commanders.length ? '+ Partner' : '♛ Pick commander'}</button></div>
      ${r.ci != null && d.commanders.length ? `<div class="sub small">Color identity: ${pips(r.ci || 'C')}</div>` : ''}` : ''}
    <div class="dk-count ${r.exact ? (r.total === r.target ? 'ok' : 'warn') : r.total >= r.target ? 'ok' : 'warn'}"><b>${countTxt}</b><span>${countSub}</span></div>
    <div class="dk-acts"><button class="btn primary" id="dk-rec">● Record deck</button><label class="btn">Upload video<input type="file" accept="video/*" id="dk-vid" hidden></label><button class="btn" id="dk-scan">Scan cards</button><button class="btn" id="dk-add">+ Type / paste</button></div>
    ${r.issues.length ? `<h3 class="h">Alerts (${r.issues.length})</h3><div class="alerts">${r.issues.map(i => `<button class="alert-it" data-n="${esc(i.name || '')}" data-k="${i.kind}"><span class="ai">${ICON[i.kind] || '!'}</span><span>${esc(i.msg)}</span></button>`).join('')}</div>` : `<div class="dk-legal">✓ Legal in ${FORMAT_LABEL[d.format]}</div>`}
    ${unsure.length ? `<button class="btn big unsure" id="dk-unsure">Check ${unsure.length} unsure card${unsure.length > 1 ? 's' : ''}</button>` : ''}
    ${d.cards.length ? `<h3 class="h">Mana curve <span class="sub small">avg ${s.avgMV.toFixed(2)} · ${s.lands} lands · ${s.spells} spells</span></h3>
    <div class="curve">${s.curve.map((n, i) => `<div class="cb"><i style="height:${(n / cmax * 100).toFixed(0)}%"></i><b>${n || ''}</b><span>${i === 7 ? '7+' : i}</span></div>`).join('')}</div>
    <div class="pipsrow">${Object.entries(s.pips).filter(([, n]) => n).map(([c, n]) => `<span class="pip p${c}">${c}</span>${n}`).join(' ')}</div>` : ''}
    ${order.filter(t => groups[t]).map(t => `<h3 class="h">${t} (${groups[t].reduce((a, c) => a + c.qty, 0)})</h3>${groups[t].sort((a, b) => a.name.localeCompare(b.name)).map(c => { const p = pr(c.id) || c; const i = bad.get(c.name); return `<div class="li dk-card ${i ? 'bad' : ''} ${c.conf === 'low' ? 'uns' : ''}" data-id="${c.id}" data-f="${c.finish}"><img src="${img(p, 'small')}" loading="lazy" alt=""><div class="t"><div class="n">${c.qty > 1 ? c.qty + '× ' : ''}${esc(short(c.name))}${c.finish !== 'nonfoil' ? '<span class="tag foil">' + c.finish + '</span>' : ''}${c.conf === 'low' ? '<span class="tag uns">check</span>' : ''}</div><div class="s">${i ? '⚠ ' + esc(i.msg) : esc(p.set?.toUpperCase() + ' #' + p.cn)}</div></div><div class="p">${money(priceOf(p, c.finish))}</div></div>`; }).join('')}`).join('')}
    <div class="btn-row" style="margin:18px 0 8px"><button class="btn" id="dk-exp">Export deck…</button><button class="btn" id="dk-tob">Add to binder</button></div>
    <button class="btn ghost warnc" id="dk-del" style="width:100%">Delete deck</button>`;
  root.querySelector('#dk-back').onclick = () => { D.cur = null; ctx.setDest?.(null); render(); };
  root.querySelector('#dk-name').onchange = e => { d.name = e.target.value.trim() || d.name; save(); };
  root.querySelector('#dk-fmt').onchange = e => { d.format = e.target.value; save(); render(); };
  root.querySelector('#dk-cmd-pick')?.addEventListener('click', () => pickCommander(d, !d.commanders.length));
  root.querySelectorAll('.dk-cmdc[data-id]').forEach(b => b.onclick = () => cmdSheet(d, b.dataset.id));
  root.querySelector('#dk-rec').onclick = () => { if (isCmd && !d.commanders.length) return pickCommander(d, true, () => ctx.recordDeck(d)); ctx.recordDeck(d); };
  root.querySelector('#dk-vid').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) ctx.deckVideo(d, f); };
  root.querySelector('#dk-scan').onclick = () => ctx.scanInto(d);
  root.querySelector('#dk-add').onclick = () => addSheet(d);
  root.querySelector('#dk-unsure')?.addEventListener('click', () => fixCard(d, unsure[0], true));
  root.querySelectorAll('.alert-it').forEach(b => b.onclick = () => { const n = b.dataset.n; if (b.dataset.k === 'cmdcount' && !d.commanders.length) return pickCommander(d, true); if (b.dataset.k === 'size') return; const c = d.cards.find(x => x.name === n); if (c) fixCard(d, c); else if (d.commanders.some(x => x.name === n)) cmdSheet(d, d.commanders.find(x => x.name === n).id); });
  root.querySelectorAll('.dk-card').forEach(el => el.onclick = () => fixCard(d, d.cards.find(c => c.id === el.dataset.id && c.finish === el.dataset.f)));
  root.querySelector('#dk-exp').onclick = () => exportSheet(d);
  root.querySelector('#dk-tob').onclick = () => ctx.deckToBinder(d);
  root.querySelector('#dk-del').onclick = () => { if (!confirm(`Delete “${d.name}”?`)) return; D.decks = D.decks.filter(x => x !== d); D.cur = null; save(); ctx.setDest?.(null); render(); };
}
const pips = ci => ci.split('').map(c => `<span class="pip p${c}">${c}</span>`).join('');
function newDeckSheet() {
  openSheet(`<h2>Check a deck</h2><div class="sub small">Which format?</div><div class="fmt-grid">${FORMATS.map(f => `<button class="btn ${f === 'commander' ? 'primary' : ''}" data-f="${f}">${FORMAT_LABEL[f]}${f === 'commander' ? ' <small>100 cards</small>' : ''}</button>`).join('')}</div>`, root => {
    root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const d = newDeck(b.dataset.f); D.cur = d.id; closeSheet(); render(); if (d.format === 'commander') setTimeout(() => pickCommander(d, true), 50); });
  });
}
export function pickCommander(d, replace = true, then) {
  openPicker({ title: 'Pick your commander', onPick: async ({ print }) => { setCommander(d, print, replace); }, onClose: null,
    extra: (el, { close }) => { el.innerHTML = `<button class="btn" id="cm-scan" style="width:100%">Or scan your commander</button>`; el.querySelector('#cm-scan').onclick = () => { close(); ctx.scanInto(d, { commander: true }); }; } });
  if (then) { const iv = setInterval(() => { if ($('#sheet').hidden) { clearInterval(iv); if (d.commanders.length) then(); } }, 300); }
}
function cmdSheet(d, id) {
  const c = d.commanders.find(x => x.id === id); if (!c) return;
  openPicker({ name: c.name, selId: c.id, onPick: async ({ print }) => { const k = d.commanders.indexOf(c); d.commanders[k] = { id: print.id, name: print.name }; save(); render(); },
    extra: (el, { close }) => { el.innerHTML = `<div class="btn-row"><button class="btn ghost warnc" id="cm-rm">Remove commander</button></div>`; el.querySelector('#cm-rm').onclick = () => { d.commanders = d.commanders.filter(x => x !== c); save(); close(); render(); }; } });
}
export function fixCard(d, c, walkUnsure = false) {
  if (!c) return;
  const next = () => { const u = d.cards.find(x => x.conf === 'low'); if (walkUnsure && u) fixCard(d, u, true); };
  openPicker({ name: c.name, selId: c.id, finish: c.finish, thumb: c.thumb, preferIds: c.alts || [],
    onPick: async ({ print, finish }) => { const was = c.conf; c.id = print.id; c.name = print.name; c.finish = finish; c.conf = 'high'; d.updated = Date.now(); save(); render(); if (was === 'low' && walkUnsure) setTimeout(next, 0); },
    extra: (el, { close, redraw }) => {
      el.innerHTML = `<div class="row gap" style="margin:8px 0"><div class="qty sm"><button id="fq-m">−</button><span>${c.qty}</span><button id="fq-p">+</button></div>
        ${c.conf === 'low' ? '<button class="btn small primary" id="fq-ok">Looks right</button>' : ''}<button class="btn small ghost warnc" id="fq-rm">Remove</button>${d.format === 'commander' ? '<button class="btn small ghost" id="fq-cm">Make commander</button>' : ''}</div>`;
      el.querySelector('#fq-m').onclick = () => { c.qty = Math.max(1, c.qty - 1); save(); render(); redraw(); };
      el.querySelector('#fq-p').onclick = () => { c.qty++; save(); render(); redraw(); };
      el.querySelector('#fq-ok')?.addEventListener('click', () => { c.conf = 'high'; save(); render(); close(); setTimeout(next, 0); });
      el.querySelector('#fq-rm').onclick = () => { d.cards = d.cards.filter(x => x !== c); save(); render(); close(); toast('Removed ' + short(c.name), () => { d.cards.push(c); save(); render(); }); };
      el.querySelector('#fq-cm')?.addEventListener('click', () => { close(); setCommander(d, pr(c.id), true); });
    } });
}
// type a name, or paste a list ("1 Sol Ring", "4x Island (M21) 272")
function addSheet(d) {
  openSheet(`<h2>Add cards</h2><input class="field" id="ad-q" placeholder="Card name" autocomplete="off"><div class="sugg" id="ad-s"></div>
    <div class="sub small" style="margin-top:14px">Or paste a list (one card per line):</div><textarea class="field" id="ad-t" rows="6" placeholder="1 Sol Ring&#10;30 Island"></textarea><button class="btn" id="ad-go" style="width:100%;margin-top:8px">Add list</button>`, root => {
    const q = root.querySelector('#ad-q'), s = root.querySelector('#ad-s');
    q.oninput = () => { s.innerHTML = nameSearch(q.value).map(n => `<button class="btn small ghost" data-n="${esc(n)}">${esc(n)}</button>`).join(''); s.querySelectorAll('button').forEach(b => b.onclick = () => { const p = bestArt(b.dataset.n); addToDeck(d, [{ print: p, finish: defaultFinish(p), qty: 1 }]); toast('Added ' + short(p.name)); q.value = ''; s.innerHTML = ''; q.focus(); }); };
    root.querySelector('#ad-go').onclick = () => { const { items, missing } = parseList(root.querySelector('#ad-t').value); if (items.length) addToDeck(d, items); closeSheet(); toast(`Added ${items.reduce((a, i) => a + i.qty, 0)} cards` + (missing.length ? ` · not found: ${missing.slice(0, 3).join(', ')}` : '')); };
  });
}
export function parseList(text) {
  const items = [], missing = []; let section = '';
  for (let line of text.split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (/^(commander|deck|sideboard|maybeboard|companion)\b:?$/i.test(line)) { section = line.toLowerCase().replace(':', ''); continue; }
    const m = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)\s*(\S+)?)?(?:\s+\*[FE]\*)?\s*(?:\[.*\])?$/); if (!m) { missing.push(line); continue; }
    const [, qn, nameRaw, set, cn] = m; const name = resolveName(nameRaw.trim()); if (!name) { missing.push(nameRaw); continue; }
    let p = set && cn ? db().bySetCn.get(set.toLowerCase() + '/' + cn) : null; if (!p || p.name !== name) p = bestArt(name);
    items.push({ print: p, finish: /\*F\*/.test(line) ? 'foil' : defaultFinish(p), qty: +qn, section });
  }
  return { items, missing };
}
function resolveName(n) { if (db().byName.has(n)) return n; const lo = n.toLowerCase(); for (const k of db().byName.keys()) if (k.toLowerCase() === lo || k.split(' // ')[0].toLowerCase() === lo) return k; return null; }
// ---------- export
export function deckText(d, style = 'arena') {
  const line = (q, p, f, tag = '') => style === 'plain' ? `${q} ${p.name.split(' // ')[0]}` : `${style === 'archidekt' ? q + 'x' : q} ${p.name} (${p.set.toUpperCase()}) ${p.cn}${f === 'foil' ? ' *F*' : f === 'etched' ? ' *E*' : ''}${tag}`;
  const cm = d.commanders.map(c => pr(c.id) || c); const body = d.cards.map(c => line(c.qty, pr(c.id) || c, c.finish));
  if (style === 'archidekt') return [...cm.map(p => line(1, p, 'nonfoil', ' [Commander]')), ...body].join('\n') + '\n';
  if (!cm.length) return (style === 'plain' ? '' : 'Deck\n') + body.join('\n') + '\n';
  return `Commander\n${cm.map(p => line(1, p, 'nonfoil')).join('\n')}\n\nDeck\n${body.join('\n')}\n`;
}
function exportSheet(d) {
  const ent = () => [...d.commanders.map(c => ({ ...(pr(c.id) || c), qty: 1, finish: 'nonfoil' })), ...d.cards.map(c => ({ ...(pr(c.id) || c), qty: c.qty, finish: c.finish }))];
  const fn = d.name.replace(/[^\w-]+/g, '-').toLowerCase();
  openSheet(`<h2>Export ${esc(d.name)}</h2><div class="sub small">Text lists are copied too, so you can paste them straight in.</div><div class="exp">
    <button class="btn" data-k="mox">Moxfield / MTG Arena <small>text, commander marked</small></button>
    <button class="btn" data-k="arch">Archidekt <small>text, commander marked</small></button>
    <button class="btn" data-k="gold">MTGGoldfish <small>text</small></button>
    <button class="btn" data-k="moxcsv">Moxfield CSV <small>CSV</small></button>
    <button class="btn" data-k="archcsv">Archidekt CSV <small>CSV</small></button>
    <button class="btn" data-k="goldcsv">MTGGoldfish CSV <small>CSV</small></button></div>`, root => {
    root.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const k = b.dataset.k;
      if (k === 'mox') copyOrSave(`${fn}-moxfield.txt`, deckText(d, 'arena'), 'Moxfield list');
      if (k === 'arch') copyOrSave(`${fn}-archidekt.txt`, deckText(d, 'archidekt'), 'Archidekt list');
      if (k === 'gold') copyOrSave(`${fn}-mtggoldfish.txt`, deckText(d, 'plain'), 'MTGGoldfish list');
      if (k === 'moxcsv') { download(`${fn}-moxfield-${stamp()}.csv`, exportMoxfield(ent())); toast('Saved Moxfield CSV'); }
      if (k === 'archcsv') { download(`${fn}-archidekt-${stamp()}.csv`, exportArchidekt(ent())); toast('Saved Archidekt CSV'); }
      if (k === 'goldcsv') { download(`${fn}-mtggoldfish-${stamp()}.csv`, exportGoldfish(ent())); toast('Saved MTGGoldfish CSV'); } });
  });
}
