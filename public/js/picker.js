// One picker for every fix: change the card (name search), its printing/style (with images + prices), finish and condition.
import { db, img, priceOf, isOldFrame, defaultFinish } from './carddb.js';
import { styleOf, STYLES } from './meta.js';
import { norm } from './match.js';
import { openSheet, closeSheet, esc, money, short } from './ui.js';
import { condMult } from './filters.js';
let fuzzyIndex = null; export const setFuzzyIndex = ix => fuzzyIndex = ix;
export const CONDS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
export function nameSearch(q, k = 8) {
  const n = norm(q); if (n.length < 2) return [];
  const pre = [], sub = []; for (const name of db().names) { const nn = norm(name); if (nn.startsWith(n)) pre.push(name); else if (nn.includes(n)) sub.push(name); if (pre.length >= k) break; }
  let out = [...pre, ...sub].slice(0, k);
  if (out.length < 3 && fuzzyIndex) out = [...new Set([...out, ...fuzzyIndex.search(q, k).map(c => c.full)])].slice(0, k);
  return out;
}
// printings of a name: preferred ids first (closest scan matches), then old frame, then oldest
export function printsFor(name, preferIds = []) {
  const all = (db().byName.get(name) || []).slice(); const rank = new Map(preferIds.map((id, i) => [id, i]));
  return all.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || (isOldFrame(b) - isOldFrame(a)) || (a.released < b.released ? -1 : 1));
}
export const bestArt = name => printsFor(name).find(p => !p.noimg) || printsFor(name)[0]; // old frame first
const finOf = p => (p.fin || 'n').split('').map(c => ({ n: 'nonfoil', f: 'foil', e: 'etched' }[c]));
const finLabel = f => f === 'nonfoil' ? 'Normal' : f[0].toUpperCase() + f.slice(1);
export function styleTags(p) { const s = styleOf(p); return (isOldFrame(p) && !s.includes('R') ? '<span class="tag old">old</span>' : '') + s.split('').filter(c => 'SXBFR'.includes(c)).map(c => `<span class="tag st">${STYLES[c].replace(' art', '').replace(' frame', '')}</span>`).join(''); }
const FILTERS = [['all', 'All'], ['old', 'Old frame'], ['B', 'Borderless'], ['S', 'Showcase'], ['X', 'Extended'], ['F', 'Full art'], ['R', 'Retro'], ['P', 'Promo'], ['foil', 'Has foil']];
const passes = (p, f) => f === 'all' ? true : f === 'old' ? isOldFrame(p) : f === 'foil' ? /[fe]/.test(p.fin) : styleOf(p).includes(f);
// opts: { name, selId, preferIds, thumb, finish, cond, allowCond, title, onPick({print, finish, cond}, close) , extra(root) }
export function openPicker(opts) {
  const st = { name: opts.name || null, sel: opts.selId ? db().byId.get(opts.selId) : null, finish: opts.finish || null, cond: opts.cond || 'NM', filt: 'all', q: '' };
  const commit = async (close) => { if (!st.sel) return; const f = st.sel.fin.includes((st.finish || 'n')[0]) ? st.finish : defaultFinish(st.sel); st.finish = f; await opts.onPick({ print: st.sel, finish: f, cond: st.cond }); if (close) closeSheet(); else draw(); };
  const draw = () => openSheet(html(), bind, opts.onClose);
  const html = () => {
    const prints = st.name ? printsFor(st.name, opts.preferIds || []) : [];
    const avail = FILTERS.filter(([k]) => k === 'all' || prints.some(p => passes(p, k)));
    const shown = prints.filter(p => passes(p, st.filt)).slice(0, 120); const fin = st.finish || 'nonfoil';
    return `<h2>${esc(st.name ? short(st.name) : (opts.title || 'Which card is this?'))}</h2>
    <div class="pk-top">${opts.thumb ? `<img class="pk-thumb" src="${opts.thumb}" alt="Your scan">` : ''}
      <div class="pk-ctl">
        <input class="field" id="pk-q" placeholder="${st.name ? 'Wrong card? Type the right name' : 'Type the card name'}" autocomplete="off" value="${esc(st.q)}">
        <div class="sugg" id="pk-s"></div>
        ${st.sel ? `<div class="seg small" id="pk-f">${finOf(st.sel).map(f => `<button data-f="${f}" class="${f === fin ? 'on' : ''}">${finLabel(f)}</button>`).join('')}</div>` : ''}
        ${st.sel && opts.allowCond ? `<div class="seg small" id="pk-c">${CONDS.map(c => `<button data-c="${c}" class="${c === st.cond ? 'on' : ''}">${c}</button>`).join('')}</div>` : ''}
      </div></div>
    ${opts.extra ? '<div id="pk-extra"></div>' : ''}
    ${st.name ? `<div class="chips-row" id="pk-st">${avail.map(([k, l]) => `<button class="chip sm" aria-pressed="${k === st.filt}" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="sub small">${prints.length} printing${prints.length === 1 ? '' : 's'} · tap yours${st.sel ? '' : ''} (closest match first, old frame next)</div>
      <div class="prints">${shown.map(p => { const pr = priceOf(p, p.fin.includes(fin[0]) ? fin : defaultFinish(p)); return `<button class="pr ${p.id === st.sel?.id ? 'sel' : ''}" data-id="${p.id}"><img src="${img(p, 'small')}" loading="lazy" alt="">
        <div class="c"><b>${esc(p.set.toUpperCase())} #${esc(p.cn)}</b><span class="sn">${esc(p.set_name)}</span>${styleTags(p)}<br><span class="pp">${money(pr == null ? null : pr * (condMult[st.cond] ?? 1))}</span></div></button>`; }).join('')}</div>` : ''}`;
  };
  const bind = root => {
    const inp = root.querySelector('#pk-q'), sg = root.querySelector('#pk-s');
    const upd = () => { st.q = inp.value; sg.innerHTML = nameSearch(inp.value).map(n => `<button class="btn small ghost" data-n="${esc(n)}">${esc(n)}</button>`).join('');
      sg.querySelectorAll('button').forEach(b => b.onclick = () => { st.name = b.dataset.n; st.q = ''; st.filt = 'all'; st.sel = printsFor(st.name)[0]; st.finish = st.finish && st.sel.fin.includes(st.finish[0]) ? st.finish : defaultFinish(st.sel); commit(false); }); };
    inp.oninput = upd; if (!st.name) { upd(); setTimeout(() => inp.focus(), 50); }
    root.querySelectorAll('#pk-f button').forEach(b => b.onclick = () => { st.finish = b.dataset.f; commit(false); });
    root.querySelectorAll('#pk-c button').forEach(b => b.onclick = () => { st.cond = b.dataset.c; commit(false); });
    root.querySelectorAll('#pk-st button').forEach(b => b.onclick = () => { st.filt = b.dataset.k; draw(); });
    root.querySelectorAll('.pr').forEach(b => b.onclick = () => { st.sel = db().byId.get(b.dataset.id); commit(true); });
    if (opts.extra) opts.extra(root.querySelector('#pk-extra'), { close: closeSheet, redraw: draw });
  };
  draw();
}
