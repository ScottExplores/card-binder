// Card Binder app: Scan / Binder / Value.
import { loadDB, db, img, priceOf, defaultFinish, isOldFrame } from './carddb.js';
import { Binder } from './binder.js';
import { exportCSV, exportMoxfield, importManaBox, exportGoldfish, exportArchidekt, exportDeckbox, exportManaBoxCSV, exportTCGplayer, exportText } from './csv.js';
import { collection } from './scry.js';
import { kvGet, kvSet } from './db.js';
import { norm } from './match.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const money = v => v == null ? '—' : '$' + v.toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const binder = new Binder();
const S = { tab: 'scan', mode: 'single', auto: false, foil: false, view: 'list', page: 0, over5: false, sort: 'value', q: '', idf: null, busy: false, stream: null, tray: [] };

// ---------- tabs
function show(tab) {
  S.tab = tab; document.body.dataset.tab = tab; $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + tab)); $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'binder') renderBinder(); if (tab === 'value') renderValue();
}
$$('.tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));

// ---------- toast with undo
let toastT;
function toast(msg, undo) {
  const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button id="t-undo">Undo</button>' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, undo ? 6000 : 2500);
  if (undo) $('#t-undo').onclick = async () => { t.hidden = true; await undo(); };
}
async function undoLast() { const l = await binder.undo(); if (l) toast('Undid: ' + l); syncTrayWithBinder(); }

// ---------- sheet
// sheets close with ✕, the dark backdrop, or the phone's Back button
let sheetOpen = false, sheetOnClose = null;
function openSheet(html, bind, onClose = null) {
  if (sheetOnClose && sheetOnClose !== onClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
  sheetOnClose = onClose; $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; $('#sheet-body').scrollTop = 0;
  if (!sheetOpen) { sheetOpen = true; history.pushState({ sheet: 1 }, ''); }
  bind && bind($('#sheet-body'));
}
function closeSheet(fromBack = false) {
  $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; const f = sheetOnClose; sheetOnClose = null; f && f();
  if (sheetOpen) { sheetOpen = false; if (!fromBack) history.back(); }
}
$('.sheet-bg').onclick = () => closeSheet(); $('#sheet-x').onclick = () => closeSheet();
addEventListener('popstate', () => { if (sheetOpen) closeSheet(true); });

// ---------- scanner engine (lazy)
let enginePromise;
function engine() {
  if (!enginePromise) enginePromise = (async () => {
    status('Loading scanner…');
    const [{ loadCV }, { NameIndex }, { Identifier }] = await Promise.all([import('./loadcv.js'), import('./match.js'), import('./identify.js')]);
    await loadDB();
    while (!window.Tesseract) await new Promise(r => setTimeout(r, 50));
    const cv = await loadCV('./vendor/opencv.js');
    const idf = new Identifier({ cv, Tesseract: window.Tesseract, names: db().names, NameIndex, workers: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1)), base: new URL('../vendor/', import.meta.url).href });
    await idf.init(); S.idf = idf; status('Ready'); return idf;
  })().catch(e => { enginePromise = null; status('Scanner failed to load: ' + e.message); throw e; });
  return enginePromise;
}
function status(t) { $('#scan-status').textContent = t; }

// ---------- camera
const video = $('#video'), overlay = $('#overlay');
async function startCam() {
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    S.stream = st; video.srcObject = st; await video.play();
    $('#btn-startcam').hidden = true; $('#cam-msg').hidden = true; kvSet('camOK', true);
    const tr = st.getVideoTracks()[0]; const caps = tr.getCapabilities?.() || {};
    if (caps.torch) $('#tg-torch').hidden = false;
    if (caps.focusMode?.includes('continuous')) tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    LIVE.camAt = performance.now(); LIVE.lockAt = LIVE.firstAt = 0; initLiveWorker(); requestAnimationFrame(drawOverlay); liveLoop();
  } catch (e) { $('#cam-msg').innerHTML = 'Camera blocked. Allow camera access for this site, or use <b>Photo</b>.'; }
}
$('#btn-startcam').onclick = startCam;
$('#tg-torch').onclick = async e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); S.stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
// map between video pixels and the on-screen (object-fit: cover) overlay
function viewMap() {
  const vw = video.videoWidth, vh = video.videoHeight, cw = overlay.clientWidth, ch = overlay.clientHeight; const s = Math.max(cw / vw, ch / vh);
  return { s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2, vw, vh, cw, ch };
}
// guide boxes in video coordinates: inside the visible area, above the bottom controls
function guideBoxes() {
  const m = viewMap(); if (!m.vw) return [];
  const top = 120, bottom = 230; const visX0 = (0 - m.ox) / m.s, visY0 = (top - m.oy) / m.s, visW = m.cw / m.s, visH = (m.ch - top - bottom) / m.s;
  const n = S.mode === 'grid3' ? 3 : S.mode === 'grid2' ? 2 : 1; const R = 63 / 88;
  let H = visH * 0.96, W = H * R * n / n; let gw = Math.min(visW * 0.94, visH * 0.96 * R), gh = gw / R; // whole page box keeps card ratio
  const x0 = visX0 + (visW - gw) / 2, y0 = visY0 + (visH - gh) / 2; const boxes = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const w = gw / n, h = gh / n; boxes.push([[x0 + c * w, y0 + r * h], [x0 + (c + 1) * w, y0 + r * h], [x0 + (c + 1) * w, y0 + (r + 1) * h], [x0 + c * w, y0 + (r + 1) * h]]); }
  return boxes;
}
let liveQuads = [], stableN = 0, lastCenter = null, sawEmpty = true, lastAutoName = '', lastAutoT = 0;
function drawOverlay() {
  const g = overlay.getContext('2d'); const dpr = devicePixelRatio || 1;
  if (overlay.width !== overlay.clientWidth * dpr) { overlay.width = overlay.clientWidth * dpr; overlay.height = overlay.clientHeight * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, overlay.width, overlay.height);
  const m = viewMap(); const P = p => [p[0] * m.s + m.ox, p[1] * m.s + m.oy];
  const poly = (q, color, w, dash) => { g.beginPath(); q.map(P).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.setLineDash(dash || []); g.lineWidth = w; g.strokeStyle = color; g.stroke(); };
  for (const b of guideBoxes()) poly(b, '#ffffff88', 2, [10, 8]);
  for (const q of liveQuads) poly(q, stableN >= 2 ? '#2ecc71' : '#3ea6ff', 4);
  requestAnimationFrame(drawOverlay);
}
// lightweight live detection for the outline + auto mode
// Live outline runs in a Web Worker (its own OpenCV) on a small 480px frame, so the screen and the card reader stay smooth.
// The full-resolution frame is only grabbed when a card is actually read.
const small = document.createElement('canvas');
const LIVE = { w: null, ready: false, busy: false, id: 0, last: 0, camAt: 0, lockAt: 0, firstAt: 0, ms: [] };
window.__live = LIVE; LIVE.reset = () => { stableN = 0; lastCenter = null; liveQuads = []; LIVE.lockAt = LIVE.firstAt = 0; LIVE.camAt = performance.now(); };
function initLiveWorker() {
  if (LIVE.w || !window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) return;
  try {
    LIVE.w = new Worker(new URL('./liveworker.js', import.meta.url));
    LIVE.w.onmessage = e => { const m = e.data; if (m.ready) { LIVE.ready = true; return; } if (m.error) { LIVE.w.terminate(); LIVE.w = null; return; } if (m.quads) { LIVE.busy = false; if (m.ms) { LIVE.ms.push(m.ms); if (LIVE.ms.length > 50) LIVE.ms.shift(); } onLive(m.quads, m.sc ?? LIVE.sc); } };
    LIVE.w.onerror = () => { LIVE.w = null; LIVE.ready = false; LIVE.busy = false; };
    LIVE.w.postMessage({ init: true, base: new URL('../', import.meta.url).href });
  } catch { LIVE.w = null; }
}
const liveN = () => S.mode === 'grid3' ? 9 : S.mode === 'grid2' ? 4 : 1;
function onLive(qs, sc) {
  if (!S.stream) return;
  liveQuads = qs.map(q => q.map(p => [p[0] / sc, p[1] / sc]));
  if (liveQuads.length && !LIVE.firstAt) LIVE.firstAt = performance.now();
  if (liveN() === 1 && liveQuads.length) {
    const c = liveQuads[0].reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const moved = lastCenter ? Math.hypot(c[0] - lastCenter[0], c[1] - lastCenter[1]) / video.videoWidth : 1;
    stableN = moved < 0.025 ? stableN + 1 : 0; lastCenter = c;
    if (stableN >= 1 && !LIVE.lockAt) LIVE.lockAt = performance.now();
    if (S.auto && stableN >= 1 && sawEmpty && !S.busy) { stableN = 0; capture({ auto: true }); }
  } else { stableN = 0; lastCenter = null; if (!liveQuads.length) sawEmpty = true; }
}
async function liveLoop() {
  if (!S.stream) return;
  const gap = S.rec ? 500 : JOB.state === 'running' ? 250 : 70; // gentle while a video is being read
  if (!S.busy && !S.rec && S.tab === 'scan' && video.videoWidth && performance.now() - LIVE.last > gap) {
    const n = liveN(); const sz = n === 1 ? 480 : 640; const sc = sz / Math.max(video.videoWidth, video.videoHeight);
    const w = video.videoWidth * sc | 0, h = video.videoHeight * sc | 0;
    if (LIVE.ready && !LIVE.busy) {
      LIVE.busy = true; LIVE.last = performance.now(); LIVE.sc = sc;
      try { const bmp = await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' }); LIVE.w.postMessage({ bmp, n, id: ++LIVE.id, sc }, [bmp]); } catch { LIVE.busy = false; }
      setTimeout(() => { if (LIVE.busy && performance.now() - LIVE.last > 3000) LIVE.busy = false; }, 3100);
    } else if (!LIVE.ready && S.idf) { // fallback: main thread (until the worker is up, or if it can't run)
      LIVE.last = performance.now(); small.width = w; small.height = h;
      const g = small.getContext('2d', { willReadFrequently: true }); g.drawImage(video, 0, 0, w, h);
      const { detectLive } = await import('./vision.js'); const cv = S.idf.cv;
      const src = cv.matFromImageData(g.getImageData(0, 0, w, h)); let qs = []; try { qs = detectLive(cv, src, { n }); } catch { } src.delete();
      onLive(qs, sc);
    }
  }
  setTimeout(liveLoop, 30);
}

// ---------- capture & identify
async function capture({ auto = false, imageEl = null } = {}) {
  if (S.busy) return; S.busy = true; $('#btn-shutter').classList.add('busy');
  try {
    const idf = await engine();
    let canvas;
    if (imageEl) { canvas = document.createElement('canvas'); const s = Math.min(1, 4000 / Math.max(imageEl.naturalWidth, imageEl.naturalHeight)); canvas.width = imageEl.naturalWidth * s; canvas.height = imageEl.naturalHeight * s; canvas.getContext('2d').drawImage(imageEl, 0, 0, canvas.width, canvas.height); }
    else { if (!video.videoWidth) { toast('Start the camera first'); return; } const cap = S.mode === 'single' ? 1920 : 2880; const s = Math.min(1, cap / Math.max(video.videoWidth, video.videoHeight)); canvas = document.createElement('canvas'); canvas.width = video.videoWidth * s | 0; canvas.height = video.videoHeight * s | 0; canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); }
    status('Reading…');
    const gs = !imageEl ? canvas.width / video.videoWidth : 1; const guide = !imageEl && S.mode === 'single' ? guideBoxes()[0]?.map(p => [p[0] * gs, p[1] * gs]) : null;
    const r = await idf.identifyCanvas(canvas, { mode: S.mode, guide });
    const found = r.results.filter(x => x.match);
    if (auto) {
      const top = found[0];
      if (!top || top.conf === 'low') { status('Hold steady…'); return; }
      sawEmpty = false;
      if (top.match.name === lastAutoName && Date.now() - lastAutoT < 2500) { status('Same card — move it away to scan the next'); return; }
      lastAutoName = top.match.name; lastAutoT = Date.now();
    }
    if (S.price) { status(found.length ? `Read in ${(r.ms / 1000).toFixed(1)}s` : 'No card found — fill the box and avoid glare'); if (navigator.vibrate && found.length) navigator.vibrate(30); showPrice(found); return; }
    status(found.length ? `${found.length} card${found.length > 1 ? 's' : ''} in ${(r.ms / 1000).toFixed(1)}s` : 'No card found — fill the box and avoid glare');
    if (navigator.vibrate && found.length) navigator.vibrate(30);
    await addScanResults(r.results);
  } catch (e) { console.error(e); status('Error: ' + e.message); }
  finally { S.busy = false; $('#btn-shutter').classList.remove('busy'); }
}
$('#btn-shutter').onclick = () => S.rec ? stopRec() : capture();
$('#file-in').onchange = async e => { const f = e.target.files[0]; if (!f) return; const im = new Image(); im.src = URL.createObjectURL(f); await im.decode(); await capture({ imageEl: im }); e.target.value = ''; };

async function addScanResults(results) {
  const items = [];
  const newTray = results.map(r => {
    const t = { id: Math.random().toString(36).slice(2), print: r.match, alts: r.alts || [], conf: r.match ? r.conf : 'low', ocr: r.ocr, added: false, finish: 'nonfoil', thumb: r.cardCanvas ? r.cardCanvas.toDataURL('image/jpeg', 0.6) : '' };
    if (t.print) { t.finish = chooseFinish(t.print); if (t.conf !== 'low') { items.push({ print: t.print, finish: t.finish, qty: 1 }); t.added = true; } }
    return t;
  });
  S.tray = [...newTray, ...S.tray].slice(0, 30); renderTray();
  if (items.length) {
    await binder.add(items, `Scan (${items.length})`);
    const unsure = newTray.filter(t => !t.added).length;
    toast(`Added ${items.length} card${items.length > 1 ? 's' : ''}` + (unsure ? ` · ${unsure} need a look` : ''), undoLast);
  } else if (newTray.length) toast('Couldn’t read that one — tap it to pick the card');
}
const chooseFinish = p => S.foil && (p.fin.includes('f') || p.fin.includes('e')) ? (p.fin.includes('f') ? 'foil' : 'etched') : defaultFinish(p);
function syncTrayWithBinder() { for (const t of S.tray) if (t.added && t.print && !binder.get(Binder.key(t.print.id, t.finish))) t.added = false; renderTray(); }
function renderTray() {
  $('#tray').innerHTML = S.tray.map(t => `<div class="titem ${t.conf}" data-id="${t.id}">
    <img src="${t.print ? img(t.print, 'small') : t.thumb}" alt="" loading="lazy">
    ${t.added ? '' : `<span class="badge">${t.print ? 'Not added' : 'Tap to pick'}</span>`}
    <button class="x" aria-label="Remove">✕</button>
    <div class="nm">${esc(t.print ? t.print.name.split(' // ')[0] : 'Unknown card')}</div>
    <div class="meta"><span>${t.print ? esc(t.print.set.toUpperCase() + ' #' + t.print.cn) : ''}</span><span>${t.print ? money(priceOf(t.print, t.finish)) : ''}</span></div></div>`).join('');
  $$('#tray .titem').forEach(el => {
    const t = S.tray.find(x => x.id === el.dataset.id);
    el.onclick = e => { if (e.target.classList.contains('x')) return; pickForTray(t); };
    el.querySelector('.x').onclick = async () => {
      if (t.added) { const k = Binder.key(t.print.id, t.finish); const cur = binder.get(k); if (cur) await binder.setQty(k, cur.qty - 1); toast('Removed ' + t.print.name, undoLast); }
      S.tray = S.tray.filter(x => x !== t); renderTray();
    };
  });
}
// ---------- printing picker (used from scan tray and binder)
function printsFor(name, preferIds = []) {
  const all = (db().byName.get(name) || []).slice();
  const rank = new Map(preferIds.map((id, i) => [id, i]));
  return all.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || (isOldFrame(b) - isOldFrame(a)) || (a.released < b.released ? -1 : 1));
}
function printGrid(prints, selId) {
  return `<div class="prints">${prints.slice(0, 90).map(p => `<button class="pr ${p.id === selId ? 'sel' : ''}" data-id="${p.id}"><img src="${img(p, 'small')}" loading="lazy" alt="">
    <div class="c"><b>${esc(p.set.toUpperCase())} #${esc(p.cn)}</b>${esc(p.set_name)}${isOldFrame(p) ? ' <span class="tag old">old</span>' : ''}<br>${money(p.usd ?? p.usd_foil)}</div></button>`).join('')}</div>`;
}
function nameSearch(q, k = 8) {
  const n = norm(q); if (n.length < 2) return [];
  const pre = [], sub = []; for (const name of db().names) { const nn = norm(name); if (nn.startsWith(n)) pre.push(name); else if (nn.includes(n)) sub.push(name); if (pre.length >= k) break; }
  let out = [...pre, ...sub].slice(0, k);
  if (out.length < 3 && S.idf) out = [...new Set([...out, ...S.idf.index.search(q, k).map(c => c.full)])].slice(0, k);
  return out;
}
function pickForTray(t) {
  const name = t.print?.name;
  const body = sel => `<h2>${esc(sel ? sel.split(' // ')[0] : 'Which card is this?')}</h2>
    ${t.thumb ? `<div class="sub small">Your scan:</div><img src="${t.thumb}" style="width:96px;border-radius:6px">` : ''}
    <input class="field" id="ns" placeholder="Type the card name" value="${esc(sel ? '' : (t.ocr || '').split(' | ')[0])}" autocomplete="off">
    <div class="sugg" id="sugg"></div>
    ${sel ? `<div class="btn-row" style="margin-top:10px"><button class="btn" id="foilbtn">${t.finish === 'nonfoil' ? 'Mark foil' : 'Mark non-foil'}</button></div><div class="sub small" style="margin-top:8px">Pick the exact printing (closest match first):</div>${printGrid(printsFor(sel, t.alts.map(a => a.id)), t.print?.id)}` : ''}`;
  const bind = (root, sel) => {
    const inp = root.querySelector('#ns'), sg = root.querySelector('#sugg');
    const upd = () => { sg.innerHTML = nameSearch(inp.value).map(n => `<button class="btn small ghost" data-n="${esc(n)}">${esc(n)}</button>`).join(''); sg.querySelectorAll('button').forEach(b => b.onclick = () => { openSheet(body(b.dataset.n), r => bind(r, b.dataset.n)); }); };
    inp.oninput = upd; if (!sel) upd();
    root.querySelector('#foilbtn')?.addEventListener('click', async () => { const p = t.print; const nf = t.finish === 'nonfoil' ? (p.fin.includes('f') ? 'foil' : p.fin.includes('e') ? 'etched' : 'nonfoil') : (p.fin.includes('n') ? 'nonfoil' : t.finish); await setTrayPrint(t, p, nf); closeSheet(); });
    root.querySelectorAll('.pr').forEach(b => b.onclick = async () => { await setTrayPrint(t, db().byId.get(b.dataset.id), null); closeSheet(); });
  };
  openSheet(body(name), r => bind(r, name));
}
async function setTrayPrint(t, p, finish) {
  finish = finish || (t.print && p.fin.includes(t.finish[0]) ? t.finish : chooseFinish(p));
  if (t.added) { const k = Binder.key(t.print.id, t.finish); const cur = binder.get(k); if (cur && cur.qty > 1) { await binder.apply([{ key: k, before: cur, after: { ...cur, qty: cur.qty - 1 } }], null); await binder.add([{ print: p, finish }], 'Changed printing'); } else if (cur) await binder.change(k, p, finish); else await binder.add([{ print: p, finish }], 'Added'); }
  else await binder.add([{ print: p, finish }], 'Added ' + p.name);
  t.print = p; t.finish = finish; t.added = true; t.conf = 'high'; renderTray(); toast(`${p.name} · ${p.set.toUpperCase()} #${p.cn}`, undoLast);
}
// scan controls
$$('#mode-seg button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; $$('#mode-seg button').forEach(x => x.classList.toggle('on', x === b)); $('#tg-auto').disabled = S.mode !== 'single'; if (S.mode !== 'single') setAuto(false); kvSet('mode', S.mode); });
function setAuto(on) { S.auto = on; $('#tg-auto').setAttribute('aria-pressed', on); }
$('#tg-auto').onclick = () => setAuto(!S.auto);
$('#tg-foil').onclick = e => { S.foil = !S.foil; e.currentTarget.setAttribute('aria-pressed', S.foil); };

// ---------- binder view
function filtered() {
  let l = binder.entries(); const q = norm(S.q);
  if (q) l = l.filter(e => norm(e.name + ' ' + e.set + ' ' + e.set_name).includes(q));
  if (S.over5) l = l.filter(e => (e.price || 0) > 5);
  const by = { value: (a, b) => (b.price || 0) - (a.price || 0), name: (a, b) => a.name.localeCompare(b.name), set: (a, b) => a.set.localeCompare(b.set) || a.cn.localeCompare(b.cn, undefined, { numeric: true }), added: (a, b) => b.added - a.added }[S.sort];
  return l.sort(by);
}
let listLimit = 200;
function row(e) {
  return `<div class="li" data-k="${esc(e.key)}"><img src="${img(e, 'small')}" loading="lazy" alt=""><div class="t"><div class="n">${esc(e.name.split(' // ')[0])}${e.finish !== 'nonfoil' ? `<span class="tag foil">${e.finish}</span>` : ''}${e.old ? '<span class="tag old">old</span>' : ''}</div>
    <div class="s">${esc(e.set.toUpperCase())} #${esc(e.cn)} · ${esc(e.set_name)}</div></div><div><div class="p">${money(e.price != null ? e.price * e.qty : null)}</div><div class="q">${e.qty > 1 ? `${e.qty} × ${money(e.price)}` : ''}</div></div></div>`;
}
function renderBinder() {
  const l = filtered(); const t = binder.totals(l);
  $('#binder-sum').textContent = `${t.count} card${t.count === 1 ? '' : 's'} (${t.unique} unique) · ${money(t.value)}`;
  $('#list').hidden = S.view !== 'list'; $('#pages').hidden = S.view !== 'pages';
  if (!binder.entries().length) { $('#list').innerHTML = '<div class="empty">Your binder is empty.<br>Go to <b>Scan</b> and point the camera at a card.</div>'; $('#list').hidden = false; $('#pages').hidden = true; return; }
  if (S.view === 'list') {
    $('#list').innerHTML = l.slice(0, listLimit).map(row).join('') + (l.length > listLimit ? `<button class="btn big ghost" id="more">Show more (${l.length - listLimit})</button>` : '') + (!l.length ? '<div class="empty">No cards match.</div>' : '');
    $('#more')?.addEventListener('click', () => { listLimit += 400; renderBinder(); });
    $$('#list .li').forEach(el => el.onclick = () => openDetail(el.dataset.k));
  } else {
    const pages = Math.max(1, Math.ceil(l.length / 9)); S.page = Math.min(S.page, pages - 1);
    const slice = l.slice(S.page * 9, S.page * 9 + 9);
    $('#page-grid').innerHTML = Array.from({ length: 9 }, (_, i) => { const e = slice[i]; return e ? `<div class="pocket" data-k="${esc(e.key)}"><img src="${img(e, 'normal')}" loading="lazy" alt="${esc(e.name)}">${e.qty > 1 ? `<span class="qb">×${e.qty}</span>` : ''}<span class="pb">${money(e.price)}</span></div>` : '<div class="pocket"></div>'; }).join('');
    $('#pg-num').textContent = `Page ${S.page + 1} of ${pages}`;
    $$('#page-grid .pocket[data-k]').forEach(el => el.onclick = () => openDetail(el.dataset.k));
  }
}
$('#q').oninput = e => { S.q = e.target.value; listLimit = 200; renderBinder(); };
$('#f-over5').onclick = e => { S.over5 = !S.over5; e.currentTarget.setAttribute('aria-pressed', S.over5); renderBinder(); };
$('#sort').onchange = e => { S.sort = e.target.value; renderBinder(); };
$$('#view-seg button').forEach(b => b.onclick = () => { S.view = b.dataset.v; $$('#view-seg button').forEach(x => x.classList.toggle('on', x === b)); renderBinder(); });
$('#pg-prev').onclick = () => { S.page = Math.max(0, S.page - 1); renderBinder(); };
$('#pg-next').onclick = () => { S.page++; renderBinder(); };
// swipe between pages
let sx = null; $('#pages').addEventListener('touchstart', e => sx = e.touches[0].clientX, { passive: true });
$('#pages').addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) { S.page = Math.max(0, S.page + (dx < 0 ? 1 : -1)); renderBinder(); } });

function openDetail(key) {
  const e = binder.get(key); if (!e) return closeSheet();
  const p = db().byId.get(e.id) || e;
  const fins = (p.fin || 'n').split('').map(c => ({ n: 'nonfoil', f: 'foil', e: 'etched' }[c]));
  openSheet(`<div class="detail"><img src="${img(e, 'normal')}" alt=""><div class="info">
      <h2>${esc(e.name)}</h2><div class="sub">${esc(e.set_name)} · ${esc(e.set.toUpperCase())} #${esc(e.cn)}${e.old ? ' <span class="tag old">old frame</span>' : ''}</div>
      <div style="font-size:24px;font-weight:800">${money(e.price)} <span class="sub small">each</span></div>
      <div class="qty"><button id="qm">−</button><span id="qv">${e.qty}</span><button id="qp">+</button></div>
      <div class="seg small" id="fin">${fins.map(f => `<button data-f="${f}" class="${f === e.finish ? 'on' : ''}">${f === 'nonfoil' ? 'Normal' : f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
      <button class="btn" id="chg">Change printing</button><button class="btn danger ghost" id="del">Delete</button></div></div><div id="prints-wrap"></div>`, root => {
    root.querySelector('#qm').onclick = async () => { await binder.setQty(key, e.qty - 1); binder.get(key) ? openDetail(key) : (closeSheet(), toast('Removed ' + e.name, undoLast)); renderBinder(); };
    root.querySelector('#qp').onclick = async () => { await binder.setQty(key, e.qty + 1); openDetail(key); renderBinder(); };
    root.querySelectorAll('#fin button').forEach(b => b.onclick = async () => { const nk = await binder.change(key, p, b.dataset.f); renderBinder(); if (nk) openDetail(nk); });
    root.querySelector('#del').onclick = async () => { await binder.remove(key); closeSheet(); renderBinder(); toast('Deleted ' + e.name, async () => { await undoLast(); renderBinder(); }); };
    root.querySelector('#chg').onclick = () => {
      const w = root.querySelector('#prints-wrap'); w.innerHTML = printGrid(printsFor(e.name), e.id);
      w.querySelectorAll('.pr').forEach(b => b.onclick = async () => { const np = db().byId.get(b.dataset.id); const f = np.fin.includes(e.finish[0]) ? e.finish : defaultFinish(np); const nk = await binder.change(key, np, f); renderBinder(); openDetail(nk || key); });
      w.scrollIntoView({ behavior: 'smooth' });
    };
  });
}

// ---------- value view
async function renderValue() {
  const t = binder.totals();
  $('#total').textContent = money(t.value);
  $('#total-sub').textContent = `${t.count} cards · ${t.unique} unique · ${t.over5} over $5 (${money(t.over5v)})`;
  const at = await kvGet('pricesAt'); $('#prices-age').textContent = at ? 'Prices updated ' + new Date(at).toLocaleString() : `Prices from card data of ${db()?.built || '…'}`;
  $('#top').innerHTML = binder.entries().sort((a, b) => (b.price || 0) * b.qty - (a.price || 0) * a.qty).slice(0, 15).map(row).join('') || '<div class="empty">No cards yet.</div>';
  $$('#top .li').forEach(el => el.onclick = () => openDetail(el.dataset.k));
}
$('#btn-refresh').onclick = async () => {
  const ids = [...new Set(binder.entries().map(e => e.id))]; if (!ids.length) return toast('No cards yet');
  toast('Refreshing ' + ids.length + ' prices…');
  try {
    const cards = await collection(ids.map(id => ({ id }))); const m = new Map(cards.map(c => [c.id, c]));
    const n = await binder.updatePrices(e => { const c = m.get(e.id); if (!c) return undefined; const pr = c.prices || {}; const v = e.finish === 'foil' ? pr.usd_foil ?? pr.usd_etched : e.finish === 'etched' ? pr.usd_etched ?? pr.usd_foil : pr.usd ?? pr.usd_foil; return v != null ? +v : null; });
    await kvSet('pricesAt', Date.now()); toast(`Prices updated (${n} changed)`); renderValue();
  } catch (e) { toast('Price refresh failed: ' + e.message); }
};
function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const stamp = () => new Date().toISOString().slice(0, 10);
const EXPORTS = [
  ['moxfield', 'Moxfield', 'CSV', () => exportMoxfield(filteredAll())],
  ['archidekt', 'Archidekt', 'CSV', () => exportArchidekt(filteredAll())],
  ['goldfish', 'MTGGoldfish', 'CSV', () => exportGoldfish(filteredAll())],
  ['deckbox', 'Deckbox', 'CSV', () => exportDeckbox(filteredAll())],
  ['manabox', 'ManaBox', 'CSV', () => exportManaBoxCSV(filteredAll())],
  ['tcgplayer', 'TCGplayer Mass Entry', 'text · pick foil on TCGplayer', () => exportTCGplayer(filteredAll())],
  ['decklist', 'Plain text list', 'text', () => exportText(filteredAll())],
  ['card-binder', 'Spreadsheet (with prices)', 'CSV', () => exportCSV(filteredAll())],
];
$('#btn-export').onclick = () => {
  if (!binder.entries().length) return toast('No cards yet');
  openSheet(`<h2>Export your binder</h2><div class="sub small">Every format includes set code, collector number, foil and quantity. Text formats are also copied so you can paste them.</div>
    <div class="exp">${EXPORTS.map(([k, n, t]) => `<button class="btn" data-k="${k}">${n} <small>${t}</small></button>`).join('')}</div>`, root => {
    root.querySelectorAll('.exp button').forEach(b => b.onclick = async () => {
      const [k, n, t, fn] = EXPORTS.find(x => x[0] === b.dataset.k); const text = fn();
      if (t.startsWith('text')) { let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch { } download(`${k}-${stamp()}.txt`, text, 'text/plain'); toast(copied ? `Copied ${n} list — paste it in, or use the saved file` : `Saved ${n} file`); }
      else { download(`${k}-${stamp()}.csv`, text); toast(`Saved ${n} CSV`); }
    });
  });
};
const filteredAll = () => binder.entries().sort((a, b) => a.name.localeCompare(b.name));
$('#imp').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; await loadDB();
  const { items, missing } = importManaBox(await f.text(), db()); e.target.value = '';
  if (!items.length) return toast('No cards recognised in that file');
  await binder.add(items, `Import (${items.length})`);
  toast(`Imported ${items.reduce((a, i) => a + i.qty, 0)} cards` + (missing.length ? ` · ${missing.length} row${missing.length === 1 ? '' : 's'} not matched` : ''), undoLast); renderValue();
};
$('#btn-sync').onclick = () => openSheet(`<h2>Backup</h2><p class="sub">Your binder is saved on this phone. Save a backup file to Google Drive or Files, and restore it on any device.</p>
  <div class="btn-row"><button class="btn big" id="bk">Save backup</button><label class="btn big">Restore<input type="file" id="rs" accept=".json,application/json" hidden></label></div>`, root => {
  root.querySelector('#bk').onclick = () => download(`card-binder-backup-${stamp()}.json`, JSON.stringify({ app: 'card-binder', v: 1, cards: binder.entries() }), 'application/json');
  root.querySelector('#rs').onchange = async ev => { try { const j = JSON.parse(await ev.target.files[0].text()); const ch = j.cards.filter(c => c.key && c.id && c.qty > 0).map(c => ({ key: c.key, before: binder.get(c.key) || null, after: c })); await binder.apply(ch, 'Restore'); closeSheet(); toast(`Restored ${ch.length} entries`, undoLast); renderValue(); } catch { toast('That file is not a Card Binder backup'); } };
});

// ---------- boot
binder.on(() => { if (S.tab === 'binder') renderBinder(); if (S.tab === 'value') renderValue(); });
(async () => {
  status('Loading cards…');
  const mode = await kvGet('mode'); if (mode) $(`#mode-seg [data-mode="${mode}"]`)?.click();
  await Promise.all([loadDB(), binder.load()]);
  loadJob().catch(() => {}); if (await kvGet('priceMode')) setPrice(true);
  engine().catch(() => {});
  if (await kvGet('camOK')) startCam();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__app = { S, binder, capture, show }; document.body.dataset.tab = 'scan';

// ---------- Record mode: film a sweep over cards / binder pages, then review everything at once
let recorder = null, recChunks = [];
function setRecUI(on) { S.rec = on; $('#tg-rec').setAttribute('aria-pressed', on); $('#tg-rec').textContent = on ? '■ Stop' : '● Record'; $('#btn-shutter').classList.toggle('recording', on); }
$('#tg-rec').onclick = () => S.rec ? stopRec() : startRec();
async function startRec() {
  if (!S.stream) await startCam(); if (!S.stream) return;
  setAuto(false); engine();
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t));
  try { recorder = new MediaRecorder(S.stream, { mimeType: type, videoBitsPerSecond: 8e6 }); } catch (e) { toast('Recording isn’t supported here — use Video instead'); return; }
  recChunks = []; recorder.ondataavailable = e => e.data.size && recChunks.push(e.data);
  recorder.onstop = () => { const b = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' }); recChunks = []; runRecord(b); };
  recorder.start(1000); setRecUI(true); status('Recording — sweep slowly, pause ~1 s on each card or page'); liveQuads = [];
}
function stopRec() { if (recorder && recorder.state !== 'inactive') recorder.stop(); setRecUI(false); }
$('#vid-in').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) runRecord(f); };
// A video is read in the background: close the sheet any time, a pill shows progress and reopens the results.
// Results are saved on the phone (IndexedDB) until you add or discard them.
const JOB = { state: 'idle', pct: 0, msg: '', ac: null, items: [] };
function pill() {
  const el = $('#job-pill');
  if (JOB.state === 'running') { el.hidden = false; el.className = 'job-pill run'; el.textContent = `Reading video… ${Math.round(JOB.pct * 100)}%`; }
  else if (JOB.state === 'done' && JOB.items.length) { el.hidden = false; el.className = 'job-pill'; el.textContent = `${JOB.items.length} card${JOB.items.length === 1 ? '' : 's'} to review ›`; }
  else el.hidden = true;
}
$('#job-pill').onclick = () => openJob();
const saveJob = () => kvSet('videoJob', JOB.state === 'done' && JOB.items.length ? { at: Date.now(), items: JOB.items.map(i => ({ ...i, print: i.print.id, alts: i.alts.slice(0, 20).map(a => a.id) })) } : null);
async function loadJob() {
  const j = await kvGet('videoJob'); if (!j?.items?.length) return;
  JOB.items = j.items.map(i => ({ ...i, print: db().byId.get(i.print), alts: (i.alts || []).map(id => db().byId.get(id)).filter(Boolean) })).filter(i => i.print);
  if (JOB.items.length) { JOB.state = 'done'; pill(); }
}
function openJob() {
  if (JOB.state === 'running') {
    openSheet(`<h3>Reading your video…</h3><div class="sub small">You can close this — it keeps going. Tap the blue pill to come back.</div><div class="prog"><i id="rp" style="width:${JOB.pct * 100}%"></i></div><div id="rs" class="sub small">${esc(JOB.msg)}</div>
      <div class="btn-row"><button class="btn" id="rh">Keep going in background</button><button class="btn ghost danger" id="rc">Cancel</button></div>`, root => {
      root.querySelector('#rh').onclick = () => closeSheet();
      root.querySelector('#rc').onclick = () => { JOB.ac?.abort(); closeSheet(); };
    });
  } else if (JOB.state === 'done') showReview();
}
async function runRecord(blob) {
  if (JOB.state === 'running') return toast('Already reading a video — tap the pill');
  if (JOB.state === 'done' && JOB.items.length && !confirm(`You still have ${JOB.items.length} cards to review from the last video. Replace them?`)) return;
  const ac = new AbortController(); Object.assign(JOB, { state: 'running', pct: 0, msg: 'Starting…', ac, items: [] }); pill(); openJob();
  try {
    const idf = await engine(); const { processVideo } = await import('./record.js');
    const r = await processVideo(idf, blob, { signal: ac.signal, onProgress: (f, msg) => { JOB.pct = f; JOB.msg = msg; pill(); const p = $('#rp'), m = $('#rs'); if (p) p.style.width = (f * 100).toFixed(0) + '%'; if (m) m.textContent = msg; } });
    JOB.items = r.cards.map(c => ({ id: Math.random().toString(36).slice(2), print: c.match, alts: c.alts || [], conf: c.conf, finish: chooseFinish(c.match), qty: 1, on: c.conf !== 'low', thumb: c.cardCanvas ? c.cardCanvas.toDataURL('image/jpeg', 0.5) : '' }));
    JOB.state = 'done'; await saveJob(); pill();
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    if (!JOB.items.length) { JOB.state = 'idle'; pill(); openSheet('<h3>No cards found</h3><p class="sub">Hold each card or page still for about a second, fill most of the screen, and avoid glare.</p>'); }
    else if (sheetOpen && $('#rp')) showReview(); else toast(`Video done: ${JOB.items.length} cards to review`, null);
  } catch (e) {
    const cancelled = ac.signal.aborted; Object.assign(JOB, { state: 'idle', items: [] }); pill();
    if (cancelled) toast('Video cancelled'); else { console.error(e); openSheet(`<h3>Couldn’t read that video</h3><p class="sub">${esc(e.message)}</p>`); }
  }
}
function showReview() {
  const items = JOB.items;
  const draw = root => {
    const on = items.filter(i => i.on); const val = on.reduce((s, i) => s + (priceOf(i.print, i.finish) || 0) * i.qty, 0);
    root.innerHTML = `<h3>${items.length} cards found</h3><div class="sub small">Red = not sure (unchecked). Tap a card to fix it. Saved until you add or discard.</div>
      <div class="rv">${items.map(i => `<div class="rv-it ${i.conf}" data-id="${i.id}"><input type="checkbox" ${i.on ? 'checked' : ''} aria-label="Include"><img src="${img(i.print, 'small')}" alt="" loading="lazy">
      <div class="nmc"><b>${esc(i.print.name.split(' // ')[0])}</b><div class="sub small">${esc(i.print.set.toUpperCase())} #${esc(i.print.cn)}${isOldFrame(i.print) ? ' · old' : ''}${i.finish !== 'nonfoil' ? ' · ' + i.finish : ''} · ${money(priceOf(i.print, i.finish))}</div></div>
      <div class="q"><button data-d="-1" aria-label="Fewer">−</button><span>${i.qty}</span><button data-d="1" aria-label="More">+</button></div></div>`).join('')}</div>
      <button class="btn big primary" id="rv-add" ${on.length ? '' : 'disabled'}>Add ${on.reduce((s, i) => s + i.qty, 0)} to binder · ${money(val)}</button>
      <button class="btn ghost danger" id="rv-discard" style="width:100%;margin-top:8px">Discard this video’s results</button>`;
    root.querySelectorAll('.rv-it').forEach(el => { const it = items.find(x => x.id === el.dataset.id);
      el.querySelector('input').onchange = e => { it.on = e.target.checked; saveJob(); draw(root); };
      el.querySelectorAll('.q button').forEach(b => b.onclick = e => { e.stopPropagation(); it.qty = Math.max(1, it.qty + +b.dataset.d); saveJob(); draw(root); });
      el.querySelector('img').onclick = el.querySelector('.nmc').onclick = () => pickReview(it, () => openSheet('', draw)); });
    root.querySelector('#rv-add').onclick = async () => {
      const add = items.filter(i => i.on); await binder.add(add.map(i => ({ print: i.print, finish: i.finish, qty: i.qty })), `Video (${add.length})`);
      S.tray = [...add.map(i => ({ ...i, added: true })), ...S.tray].slice(0, 60); renderTray();
      Object.assign(JOB, { state: 'idle', items: [] }); saveJob(); pill(); closeSheet();
      toast(`Added ${add.reduce((s, i) => s + i.qty, 0)} cards`, undoLast);
    };
    root.querySelector('#rv-discard').onclick = () => { if (!confirm('Discard these results?')) return; Object.assign(JOB, { state: 'idle', items: [] }); saveJob(); pill(); closeSheet(); };
  };
  openSheet('', draw);
}
function pickReview(it, back) {
  const prints = printsFor(it.print.name, it.alts.map(a => a.id));
  const fins = (it.print.fin || 'n').split('').map(c => ({ n: 'nonfoil', f: 'foil', e: 'etched' }[c]));
  openSheet(`<h3>${esc(it.print.name)}</h3><div class="seg small" id="rf">${fins.map(f => `<button data-f="${f}" class="${f === it.finish ? 'on' : ''}">${f === 'nonfoil' ? 'Normal' : f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
    <input class="field" id="rn" placeholder="Wrong card? Type the name" autocomplete="off" style="margin-top:8px"><div id="rnl" class="sugg"></div>${printGrid(prints, it.print.id)}<button class="btn ghost" id="rb" style="width:100%;margin-top:8px">‹ Back to list</button>`, root => {
    root.querySelectorAll('#rf button').forEach(b => b.onclick = () => { it.finish = b.dataset.f; saveJob(); back(); });
    root.querySelectorAll('.pr').forEach(b => b.onclick = () => { it.print = db().byId.get(b.dataset.id); if (!it.print.fin.includes(it.finish[0])) it.finish = chooseFinish(it.print); it.on = true; it.conf = 'high'; saveJob(); back(); });
    root.querySelector('#rb').onclick = back;
    root.querySelector('#rn').oninput = e => { root.querySelector('#rnl').innerHTML = nameSearch(e.target.value).map(n => `<button class="btn ghost small" data-n="${esc(n)}">${esc(n)}</button>`).join(''); root.querySelectorAll('#rnl button').forEach(b => b.onclick = () => { const p = printsFor(b.dataset.n)[0]; it.print = p; it.alts = []; it.finish = chooseFinish(p); it.on = true; it.conf = 'high'; saveJob(); pickReview(it, back); }); };
  });
}

// ---------- Price check: scan and just see the price (nothing is added)
function setPrice(on) { S.price = on; $('#tg-price').setAttribute('aria-pressed', on); kvSet('priceMode', on); if (!on) $('#pcard').hidden = true; status(on ? 'Price check: scan a card to see its price' : 'Ready'); }
$('#tg-price').onclick = () => setPrice(!S.price);
const livePrices = new Map();
async function freshPrices(p) { // live Scryfall price (TCGplayer market, USD); falls back to the built-in prices
  if (livePrices.has(p.id)) return livePrices.get(p.id);
  const pr = fetch('https://api.scryfall.com/cards/' + p.id).then(r => r.ok ? r.json() : null).then(c => c && c.prices ? { usd: num(c.prices.usd), usd_foil: num(c.prices.usd_foil), usd_etched: num(c.prices.usd_etched), live: true } : null).catch(() => null);
  livePrices.set(p.id, pr); return pr;
}
const num = v => v == null ? null : +v;
function priceLine(p, pr) {
  const x = pr || p; const fins = (p.fin || 'n').split('');
  const parts = []; if (fins.includes('n')) parts.push(['Normal', x.usd, 'nonfoil']); if (fins.includes('f')) parts.push(['Foil', x.usd_foil, 'foil']); if (fins.includes('e')) parts.push(['Etched', x.usd_etched, 'etched']);
  const want = chooseFinish(p);
  return parts.map(([l, v, f]) => `<span class="${f === want ? 'on' : ''}">${money(v)} <small>${l}</small></span>`).join(' &nbsp;');
}
function showPrice(found) {
  const el = $('#pcard');
  if (!found.length) { el.hidden = true; return; }
  if (found.length === 1) {
    const r = found[0]; let p = r.match;
    const draw = pr => { el.innerHTML = `<img src="${img(p, 'small')}" alt=""><div><div class="nm">${esc(p.name.split(' // ')[0])}</div><div class="sub small">${esc(p.set.toUpperCase())} #${esc(p.cn)} · ${esc(p.set_name)}${isOldFrame(p) ? ' · old' : ''}</div><div class="pr2">${priceLine(p, pr)}</div><div class="sub small">${pr?.live ? 'Live TCGplayer price via Scryfall' : 'Saved price · updating…'}${r.conf === 'low' ? ' · not sure it’s this card' : ''}</div></div>
      <div class="acts"><button class="btn small" id="pc-add">Add</button><button class="btn small ghost" id="pc-other">Other</button><button class="btn small ghost" id="pc-x">✕</button></div>`;
      el.querySelector('#pc-x').onclick = () => el.hidden = true;
      el.querySelector('#pc-add').onclick = async () => { const f = chooseFinish(p); await binder.add([{ print: p, finish: f }], 'Added ' + p.name); toast(`Added ${p.name}`, undoLast); el.hidden = true; };
      el.querySelector('#pc-other').onclick = () => openSheet(`<h2>${esc(p.name)}</h2><div class="sub small">Pick the printing you have:</div>${printGrid(printsFor(p.name, (r.alts || []).map(a => a.id)), p.id)}`, root => root.querySelectorAll('.pr').forEach(b => b.onclick = async () => { p = db().byId.get(b.dataset.id); closeSheet(); draw(null); draw(await freshPrices(p)); }));
    };
    draw(null); el.hidden = false; freshPrices(p).then(pr => { if (pr && found[0].match === r.match) draw(pr); });
  } else {
    const draw = prs => { let tot = 0; const rows = found.map((r, i) => { const p = r.match, x = prs[i] || p, f = chooseFinish(p); const v = f === 'foil' ? x.usd_foil : f === 'etched' ? x.usd_etched : (x.usd ?? x.usd_foil); tot += v || 0; return `<div class="mrow"><span>${esc(p.name.split(' // ')[0])} <span class="sub small">${esc(p.set.toUpperCase())}</span></span><b>${money(v)}</b></div>`; }).join('');
      el.innerHTML = `<div class="multi">${rows}<div class="mrow"><b>Total (${found.length})</b><b>${money(tot)}</b></div></div><div class="acts" style="grid-column:1/-1;flex-direction:row"><button class="btn small" id="pc-add">Add all</button><button class="btn small ghost" id="pc-x">✕</button></div>`;
      el.querySelector('#pc-x').onclick = () => el.hidden = true;
      el.querySelector('#pc-add').onclick = async () => { await binder.add(found.map(r => ({ print: r.match, finish: chooseFinish(r.match) })), `Added ${found.length}`); toast(`Added ${found.length} cards`, undoLast); el.hidden = true; };
    };
    draw([]); el.hidden = false; Promise.all(found.map(r => freshPrices(r.match))).then(draw);
  }
}
