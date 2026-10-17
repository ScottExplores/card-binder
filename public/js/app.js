// Card Binder app: Scan / Binder / Decks / Value.
import { loadDB, db, img, priceOf, defaultFinish, isOldFrame } from './carddb.js';
import { Binder, DEFAULT_BINDER } from './binder.js';
import { exportCSV, exportMoxfield, importManaBox, exportGoldfish, exportArchidekt, exportDeckbox, exportManaBoxCSV, exportTCGplayer, exportText, exportSellTCG, exportEbay, ebayTitle } from './csv.js';
import { collection } from './scry.js';
import { kvGet, kvSet, kvSetRequired } from './db.js';
import { $, $$, esc, money, short, toast, openSheet, closeSheet, sheetOpen, alertBuzz, download, stamp, copyOrSave } from './ui.js';
import { loadMeta, info, FORMATS, FORMAT_LABEL } from './meta.js';
import { DEFAULT_F, applyFilters, sortEntries, SORTS, activeCount, unitPrice, condMult } from './filters.js';
import { openPicker, printsFor, nameSearch, setFuzzyIndex, styleTags, CONDS } from './picker.js';
import { initDecks, render as renderDecks, D, getDeck, addToDeck, setCommander, usedInDecks, check as checkDeckObj } from './decks.js';

const binder = new Binder();
const S = { tab: 'scan', mode: 'single', auto: false, foil: false, view: 'list', page: 0, sort: 'value', F: DEFAULT_F(), idf: null, busy: false, stream: null, tray: [],
  dest: { binder: DEFAULT_BINDER }, batch: null, batchAt: 0, lastBatch: null };
const FMT_IDX = Object.fromEntries(FORMATS.map((f, i) => [f, i]));
const PILES = [['keep', 'Keep'], ['sell', 'Sell'], ['trade', 'Trade'], ['bulk', 'Bulk']];

// ---------- tabs
function show(tab) {
  S.tab = tab; document.body.dataset.tab = tab; $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + tab)); $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'binder') renderBinder(); if (tab === 'value') renderValue(); if (tab === 'decks') renderDecks(); if (tab === 'scan') renderDest();
}
$$('.tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
async function undoLast() { const l = await binder.undo(); if (l) toast('Undid: ' + l); syncTrayWithBinder(); }
$('.sheet-bg').onclick = () => closeSheet(); $('#sheet-x').onclick = () => closeSheet();
addEventListener('popstate', () => { if (sheetOpen()) closeSheet(true); });

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
    await idf.init(); S.idf = idf; setFuzzyIndex(idf.index); status(S.price ? 'Price check: scan a card to see its price' : 'Ready'); return idf;
  })().catch(e => { enginePromise = null; status('Scanner failed to load: ' + e.message); throw e; });
  return enginePromise;
}
function status(t) { $('#scan-status').textContent = t; }

// ---------- where scans go: a binder (default "Unsorted") or a deck being checked
const destDeck = () => S.dest.deck ? getDeck(S.dest.deck) : null;
function setDest(d) { S.dest = d || { binder: DEFAULT_BINDER }; if (!S.dest.deck) kvSet('destBinder', S.dest.binder); renderDest(); }
function renderDest() {
  const d = destDeck(); const chip = $('#dest-chip');
  chip.textContent = d ? (S.dest.commander ? `Scanning commander for ${d.name} ▾` : `Into deck: ${d.name} ▾`) : `Into: ${S.dest.binder} ▾`; chip.classList.toggle('deck', !!d);
  const live = $('#deck-live');
  if (d) { const r = checkDeckObj(d); live.hidden = false; live.className = 'deck-live ' + (r.ok ? 'ok' : 'warn'); live.textContent = `${r.total}${r.exact ? '/' + r.target : ''}${r.issues.filter(i => i.name).length ? ` · ⚠ ${r.issues.filter(i => i.name).length}` : ''}`; live.onclick = () => { D.cur = d.id; show('decks'); }; }
  else live.hidden = true;
  const n = lastBatchEntries().reduce((a, e) => a + e.qty, 0); $('#btn-last').hidden = !n; $('#btn-last').textContent = `Last scan (${n})`;
}
$('#dest-chip').onclick = () => {
  const bs = binder.binders();
  openSheet(`<h2>Scan into…</h2><div class="sub small">Cards you scan go here. Unsorted is the default.</div>
    <div class="exp">${bs.map(b => `<button class="btn ${!S.dest.deck && S.dest.binder === b ? 'primary' : ''}" data-b="${esc(b)}">${esc(b)} <small>${binder.entries().filter(e => (e.binder || DEFAULT_BINDER) === b).reduce((a, e) => a + e.qty, 0)} cards</small></button>`).join('')}
    <button class="btn ghost" id="nb">+ New binder…</button></div>
    ${D.decks.length ? `<h3 class="h">Or into a deck (checks it as you scan)</h3><div class="exp">${D.decks.map(d => `<button class="btn ${S.dest.deck === d.id ? 'primary' : ''}" data-d="${d.id}">${esc(d.name)} <small>${FORMAT_LABEL[d.format]}</small></button>`).join('')}</div>` : ''}`, root => {
    root.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { setDest({ binder: b.dataset.b }); closeSheet(); });
    root.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { setDest({ deck: b.dataset.d }); closeSheet(); });
    root.querySelector('#nb').onclick = () => { const n = prompt('Name for the new binder', 'Trade binder'); if (n && n.trim()) { setDest({ binder: n.trim().slice(0, 40) }); closeSheet(); toast(`Scanning into “${n.trim()}”`); } };
  });
};
// scan batches: a batch is one scanning session (new after 10 minutes idle, or each video)
function batchId(fresh = false) { if (fresh || !S.batch || Date.now() - S.batchAt > 10 * 60e3) { S.batch = Date.now(); S.lastBatch = S.batch; kvSet('lastBatch', S.batch); } S.batchAt = Date.now(); return S.batch; }
const lastBatchEntries = () => S.lastBatch == null ? [] : binder.entries().filter(e => e.batch === S.lastBatch);

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

const thumbOf = c => { if (!c) return ''; const t = document.createElement('canvas'); t.width = 146; t.height = 204; t.getContext('2d').drawImage(c, 0, 0, 146, 204); return t.toDataURL('image/jpeg', 0.6); };
// confident reads go straight in (Undo in the toast); unsure ones wait for a tap. Same-art reprints are added but flagged "check printing".
async function addScanResults(results) {
  const items = []; const deck = destDeck();
  const newTray = results.map(r => {
    const t = { id: Math.random().toString(36).slice(2), print: r.match, alts: r.alts || [], conf: r.match ? r.conf : 'low', amb: !!r.printAmbiguous, ocr: r.ocr, added: false, finish: 'nonfoil', thumb: thumbOf(r.cardCanvas), dest: deck ? { deck: deck.id } : { binder: S.dest.binder } };
    if (t.print) { t.finish = chooseFinish(t.print); if (t.conf !== 'low') { items.push({ print: t.print, finish: t.finish, qty: 1, t }); t.added = true; } }
    return t;
  });
  S.tray = [...newTray, ...S.tray].slice(0, 40); renderTray();
  if (deck) { // deck check: commander first, then the 99
    if (S.dest.commander && items.length) { const first = items.shift(); setCommander(deck, first.print, !deck.commanders.length); S.dest.commander = false; }
    const unsure = newTray.filter(t => t.print && !t.added);
    if (items.length || unsure.length) addToDeck(deck, [...items.map(i => ({ print: i.print, finish: i.finish, qty: 1, conf: 'high', thumb: i.t.thumb })), ...unsure.map(t => ({ print: t.print, finish: t.finish, qty: 1, conf: 'low', thumb: t.thumb }))]);
    unsure.forEach(t => t.added = true); renderTray(); renderDest(); return;
  }
  if (items.length) {
    const b = batchId();
    await binder.add(items.map(i => ({ print: i.print, finish: i.finish, qty: 1, binder: S.dest.binder, batch: b })), `Scan (${items.length})`);
    const unsure = newTray.filter(t => !t.added).length, amb = items.filter(i => i.t.amb).length;
    toast(`Added ${items.length} to ${S.dest.binder}` + (unsure ? ` · ${unsure} need a look` : '') + (amb && !unsure ? ` · check printing on ${amb}` : ''), undoLast);
  } else if (newTray.length) toast('Couldn’t read that one — tap it to pick the card');
  renderDest();
}
const chooseFinish = p => S.foil && (p.fin.includes('f') || p.fin.includes('e')) ? (p.fin.includes('f') ? 'foil' : 'etched') : defaultFinish(p);
const entryKeyOf = t => Binder.key(t.print.id, t.finish, t.cond || 'NM', t.dest?.binder || DEFAULT_BINDER);
function syncTrayWithBinder() { for (const t of S.tray) if (t.added && t.print && !t.dest?.deck && !binder.get(entryKeyOf(t))) t.added = false; renderTray(); renderDest(); }
function renderTray() {
  $('#tray').innerHTML = S.tray.map(t => `<div class="titem ${t.conf}${t.amb && t.conf !== 'low' ? ' amb' : ''}" data-id="${t.id}">
    <img src="${t.print ? img(t.print, 'small') : t.thumb}" alt="" loading="lazy">
    ${t.added ? (t.amb ? '<span class="badge amb">Check printing</span>' : '') : `<span class="badge">${t.print ? 'Not added' : 'Tap to pick'}</span>`}
    <button class="x" aria-label="Remove">✕</button>
    ${t.print && t.print.fin.length > 1 ? `<button class="fz ${t.finish !== 'nonfoil' ? 'on' : ''}" aria-label="Toggle foil">${t.finish !== 'nonfoil' ? '✦ Foil' : 'Foil?'}</button>` : ''}
    <div class="nm">${esc(t.print ? short(t.print.name) : 'Unknown card')}</div>
    <div class="meta"><span>${t.print ? esc(t.print.set.toUpperCase() + ' #' + t.print.cn) : ''}</span><span>${t.print ? money(priceOf(t.print, t.finish)) : ''}</span></div></div>`).join('');
  $$('#tray .titem').forEach(el => {
    const t = S.tray.find(x => x.id === el.dataset.id);
    el.onclick = e => { if (e.target.closest('.x,.fz')) return; pickForTray(t); };
    el.querySelector('.fz')?.addEventListener('click', async () => { const p = t.print; const nf = t.finish === 'nonfoil' ? (p.fin.includes('f') ? 'foil' : 'etched') : (p.fin.includes('n') ? 'nonfoil' : t.finish); await setTrayPrint(t, p, nf, t.cond); });
    el.querySelector('.x').onclick = async () => {
      if (t.added && !t.dest?.deck) { const k = entryKeyOf(t); const cur = binder.get(k); if (cur) await binder.setQty(k, cur.qty - 1); toast('Removed ' + t.print.name, undoLast); }
      if (t.added && t.dest?.deck) { const d = getDeck(t.dest.deck); const c = d?.cards.find(x => x.id === t.print.id && x.finish === t.finish); if (c) { c.qty--; if (c.qty <= 0) d.cards.splice(d.cards.indexOf(c), 1); addToDeck(d, [], { quiet: true }); } }
      S.tray = S.tray.filter(x => x !== t); renderTray(); renderDest();
    };
  });
}
function pickForTray(t) {
  openPicker({ name: t.print?.name, selId: t.print?.id, preferIds: t.alts.map(a => a.id), thumb: t.thumb, finish: t.finish, cond: t.cond || 'NM', allowCond: !t.dest?.deck,
    title: 'Which card is this?', onPick: ({ print, finish, cond }) => setTrayPrint(t, print, finish, cond) });
  if (!t.print) setTimeout(() => { const i = $('#pk-q'); if (i && t.ocr) { i.value = t.ocr.split(' | ')[0]; i.dispatchEvent(new Event('input')); } }, 30);
}
// fix one scanned copy: one batch (so Undo puts everything back), merging into an existing entry if needed
async function setTrayPrint(t, p, finish, cond = t.cond || 'NM') {
  finish = finish || (t.print && p.fin.includes(t.finish[0]) ? t.finish : chooseFinish(p));
  if (t.dest?.deck) { const d = getDeck(t.dest.deck); if (d) { const c = t.added ? d.cards.find(x => x.id === t.print?.id && x.finish === t.finish) : null; if (c) { c.qty--; if (c.qty <= 0) d.cards.splice(d.cards.indexOf(c), 1); } addToDeck(d, [{ print: p, finish, qty: 1, conf: 'high', thumb: t.thumb }]); } }
  else {
    const bname = t.dest?.binder || DEFAULT_BINDER; const nk = Binder.key(p.id, finish, cond, bname);
    const ch = []; const b = S.batch ?? batchId();
    if (t.added) { const k = entryKeyOf(t); const cur = binder.get(k); if (cur && k !== nk) ch.push({ key: k, before: cur, after: cur.qty > 1 ? { ...cur, qty: cur.qty - 1, updated: Date.now() } : null }); if (k === nk) ch.length = 0; }
    if (!t.added || entryKeyOf(t) !== nk) { const tgt = binder.get(nk); ch.push({ key: nk, before: tgt || null, after: tgt ? { ...tgt, qty: tgt.qty + 1, updated: Date.now() } : Binder.fromPrint(p, finish, 1, { cond, binder: bname, batch: b }) }); }
    if (ch.length) await binder.apply(ch, t.added ? 'Changed printing' : 'Added ' + p.name);
  }
  Object.assign(t, { print: p, finish, cond, added: true, conf: 'high', amb: false }); renderTray(); renderDest();
  toast(`${short(p.name)} · ${p.set.toUpperCase()} #${p.cn}${finish !== 'nonfoil' ? ' · ' + finish : ''}${cond !== 'NM' ? ' · ' + cond : ''}`, t.dest?.deck ? null : undoLast);
}
// scan controls
$$('#mode-seg button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; $$('#mode-seg button').forEach(x => x.classList.toggle('on', x === b)); $('#tg-auto').disabled = S.mode !== 'single'; if (S.mode !== 'single') setAuto(false); kvSet('mode', S.mode); });
function setAuto(on) { S.auto = on; $('#tg-auto').setAttribute('aria-pressed', on); }
$('#tg-auto').onclick = () => setAuto(!S.auto);
$('#tg-foil').onclick = e => { S.foil = !S.foil; e.currentTarget.setAttribute('aria-pressed', S.foil); toast(S.foil ? 'Next scans are saved as foil' : 'Next scans are saved as normal (non-foil)'); };

// ---------- "Last scan" pop-up: the most recent batch, wherever it went
$('#btn-last').onclick = () => openLast();
function openLast() {
  const l = lastBatchEntries().sort((a, b) => b.updated - a.updated); if (!l.length) return toast('Nothing scanned yet');
  const t = binder.totals(l, unitPrice);
  openSheet(`<h2>Last scan</h2><div class="sub small">${t.count} card${t.count === 1 ? '' : 's'} · ${money(t.value)} · tap one to fix it</div>
    <div class="list tight">${l.map(row).join('')}</div>
    <div class="btn-row" style="margin-top:10px"><button class="btn" id="ls-move">Move all to binder…</button><button class="btn" id="ls-sort">Sort into piles</button></div>
    <button class="btn ghost" id="ls-view" style="width:100%;margin-top:8px">Show in Binder with filters</button>`, root => {
    root.querySelectorAll('.li').forEach(el => el.onclick = () => openDetail(el.dataset.k, openLast));
    root.querySelector('#ls-move').onclick = () => moveSheet(l, openLast);
    root.querySelector('#ls-sort').onclick = () => sortPiles(l.map(e => e.key));
    root.querySelector('#ls-view').onclick = () => { closeSheet(); S.F = { ...DEFAULT_F(), last: true }; show('binder'); };
  });
}
function moveSheet(list, back) {
  const bs = binder.binders();
  openSheet(`<h2>Move ${list.reduce((a, e) => a + e.qty, 0)} cards to…</h2><div class="exp">${bs.map(b => `<button class="btn" data-b="${esc(b)}">${esc(b)}</button>`).join('')}<button class="btn ghost" id="mv-new">+ New binder…</button></div>`, root => {
    const go = async name => { const ch = []; const pend = new Map();
      for (const e of list) { const cur = binder.get(e.key); if (!cur || (cur.binder || DEFAULT_BINDER) === name) continue; const nk = Binder.key(cur.id, cur.finish, cur.cond || 'NM', name); const tgt = pend.get(nk) || binder.get(nk);
        ch.push({ key: cur.key, before: cur, after: null }); const after = tgt ? { ...tgt, qty: tgt.qty + cur.qty, updated: Date.now() } : { ...cur, key: nk, binder: name, updated: Date.now() };
        const ex = ch.find(c => c.key === nk); if (ex) ex.after = after; else ch.push({ key: nk, before: binder.get(nk) || null, after }); pend.set(nk, after); }
      if (ch.length) await binder.apply(ch, 'Moved to ' + name); toast(`Moved to ${name}`, undoLast); back ? back() : closeSheet(); };
    root.querySelectorAll('[data-b]').forEach(b => b.onclick = () => go(b.dataset.b));
    root.querySelector('#mv-new').onclick = () => { const n = prompt('Binder name'); if (n && n.trim()) go(n.trim().slice(0, 40)); };
  });
}

// ---------- binder view: filters + sort
const SORT_SEL = $('#sort'); SORT_SEL.innerHTML = Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
function filtered() { return sortEntries(applyFilters(binder.entries(), S.F, info, { lastBatch: S.lastBatch, fmtIdx: FMT_IDX }), S.sort, info); }
let listLimit = 200;
function row(e) {
  const u = unitPrice(e);
  return `<div class="li" data-k="${esc(e.key)}"><img src="${img(e, 'small')}" loading="lazy" alt=""><div class="t"><div class="n">${esc(short(e.name))}${e.finish !== 'nonfoil' ? `<span class="tag foil">${e.finish}</span>` : ''}${e.old ? '<span class="tag old">old</span>' : ''}${e.cond && e.cond !== 'NM' ? `<span class="tag cond">${e.cond}</span>` : ''}${e.pile ? `<span class="tag pile ${e.pile}">${e.pile}</span>` : (u || 0) >= 5 ? '<span class="tag sell">$5+</span>' : ''}</div>
    <div class="s">${esc(e.set.toUpperCase())} #${esc(e.cn)} · ${esc(e.binder || DEFAULT_BINDER)}</div></div><div><div class="p">${money(u != null ? u * e.qty : null)}</div><div class="q">${e.qty > 1 ? `${e.qty} × ${money(u)}` : ''}</div></div></div>`;
}
function renderBinder() {
  const l = filtered(); const t = binder.totals(l, unitPrice); const nf = activeCount(S.F);
  $('#f-open').textContent = nf ? `Filters (${nf})` : 'Filters'; $('#f-open').setAttribute('aria-pressed', nf > 0);
  $('#f-last').setAttribute('aria-pressed', S.F.last); $('#f-over5').setAttribute('aria-pressed', S.F.over5); SORT_SEL.value = S.sort;
  if ($('#q').value !== S.F.q) $('#q').value = S.F.q;
  const bs = binder.binders(); $('#binder-chips').innerHTML = bs.length > 1 ? ['', ...bs].map(b => `<button class="chip sm" aria-pressed="${S.F.binder === b}" data-b="${esc(b)}">${b ? esc(b) : 'All binders'}</button>`).join('') : '';
  $$('#binder-chips button').forEach(b => b.onclick = () => { S.F.binder = b.dataset.b; renderBinder(); });
  $('#binder-sum').textContent = `${t.count} card${t.count === 1 ? '' : 's'} (${t.unique} unique) · ${money(t.value)}`;
  $('#list').hidden = S.view !== 'list'; $('#pages').hidden = S.view !== 'pages';
  if (!binder.entries().length) { $('#list').innerHTML = '<div class="empty">Your binder is empty.<br>Go to <b>Scan</b> and point the camera at a card.</div>'; $('#list').hidden = false; $('#pages').hidden = true; return; }
  if (S.view === 'list') {
    $('#list').innerHTML = l.slice(0, listLimit).map(row).join('') + (l.length > listLimit ? `<button class="btn big ghost" id="more">Show more (${l.length - listLimit})</button>` : '') + (!l.length ? `<div class="empty">No cards match.${nf ? '<br><button class="btn small" id="clr">Clear filters</button>' : ''}</div>` : '');
    $('#more')?.addEventListener('click', () => { listLimit += 400; renderBinder(); });
    $('#clr')?.addEventListener('click', () => { S.F = DEFAULT_F(); renderBinder(); });
    $$('#list .li').forEach(el => el.onclick = () => openDetail(el.dataset.k));
  } else {
    const pages = Math.max(1, Math.ceil(l.length / 9)); S.page = Math.min(S.page, pages - 1);
    const slice = l.slice(S.page * 9, S.page * 9 + 9);
    $('#page-grid').innerHTML = Array.from({ length: 9 }, (_, i) => { const e = slice[i]; return e ? `<div class="pocket" data-k="${esc(e.key)}"><img src="${img(e, 'normal')}" loading="lazy" alt="${esc(e.name)}">${e.qty > 1 ? `<span class="qb">×${e.qty}</span>` : ''}<span class="pb">${money(unitPrice(e))}</span></div>` : '<div class="pocket"></div>'; }).join('');
    $('#pg-num').textContent = `Page ${S.page + 1} of ${pages}`;
    $$('#page-grid .pocket[data-k]').forEach(el => el.onclick = () => openDetail(el.dataset.k));
  }
}
$('#q').oninput = e => { S.F.q = e.target.value; listLimit = 200; renderBinder(); };
$('#f-over5').onclick = () => { S.F.over5 = !S.F.over5; renderBinder(); };
$('#f-last').onclick = () => { S.F.last = !S.F.last; renderBinder(); };
SORT_SEL.onchange = e => { S.sort = e.target.value; kvSet('sort', S.sort); renderBinder(); };
$$('#view-seg button').forEach(b => b.onclick = () => { S.view = b.dataset.v; $$('#view-seg button').forEach(x => x.classList.toggle('on', x === b)); renderBinder(); });
$('#pg-prev').onclick = () => { S.page = Math.max(0, S.page - 1); renderBinder(); };
$('#pg-next').onclick = () => { S.page++; renderBinder(); };
let sx = null; $('#pages').addEventListener('touchstart', e => sx = e.touches[0].clientX, { passive: true });
$('#pages').addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) { S.page = Math.max(0, S.page + (dx < 0 ? 1 : -1)); renderBinder(); } });
$('#f-open').onclick = () => openFilters();
function openFilters() {
  const F = S.F; const sets = [...new Set(binder.entries().map(e => e.set))].sort(); const setName = s => binder.entries().find(e => e.set === s)?.set_name || s;
  const chips = (key, opts) => `<div class="chips-row">${opts.map(([v, l, cls]) => `<button class="chip sm ${cls || ''}" data-key="${key}" data-v="${v}" aria-pressed="${F[key].includes(v)}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>Filters</h2>
    <div class="fl"><b>Color</b>${chips('colors', [['W', 'W', 'pW'], ['U', 'U', 'pU'], ['B', 'B', 'pB'], ['R', 'R', 'pR'], ['G', 'G', 'pG'], ['C', 'Colorless'], ['M', 'Multicolor']])}
      <div class="seg small" id="cm"><button data-m="any" class="${F.colorMode === 'any' ? 'on' : ''}">Any of these</button><button data-m="exact" class="${F.colorMode === 'exact' ? 'on' : ''}">Exactly these</button></div></div>
    <div class="fl"><b>Fits commander colors</b> <span class="sub small">(color identity within)</span>${chips('ci', [['W', 'W', 'pW'], ['U', 'U', 'pU'], ['B', 'B', 'pB'], ['R', 'R', 'pR'], ['G', 'G', 'pG']])}</div>
    <div class="fl"><b>Type</b>${chips('types', ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Legendary'].map(x => [x, x]))}</div>
    <div class="fl"><b>Mana value</b>${chips('cmc', [0, 1, 2, 3, 4, 5, 6, 7].map(x => [x, x === 7 ? '7+' : String(x)]))}</div>
    <div class="fl"><b>Rarity</b>${chips('rarity', [['c', 'Common'], ['u', 'Uncommon'], ['r', 'Rare'], ['m', 'Mythic']])}</div>
    <div class="fl two"><label><b>Set</b><select id="fs"><option value="">Any set</option>${sets.map(s => `<option value="${s}" ${F.set === s ? 'selected' : ''}>${esc(setName(s))} (${s.toUpperCase()})</option>`).join('')}</select></label>
      <label><b>Legal in</b><select id="fl"><option value="">Any format</option>${FORMATS.map(f => `<option value="${f}" ${F.legal === f ? 'selected' : ''}>${FORMAT_LABEL[f]}</option>`).join('')}</select></label></div>
    <div class="fl two"><label><b>Price from $</b><input id="pmin" type="number" inputmode="decimal" min="0" value="${esc(F.pmin)}"></label><label><b>to $</b><input id="pmax" type="number" inputmode="decimal" min="0" value="${esc(F.pmax)}"></label></div>
    <div class="fl two"><label><b>Foil</b><select id="ff"><option value="">Any</option><option value="foil" ${F.foil === 'foil' ? 'selected' : ''}>Foil only</option><option value="nonfoil" ${F.foil === 'nonfoil' ? 'selected' : ''}>Non-foil only</option></select></label>
      <label><b>Scanned</b><select id="fd"><option value="">Any time</option>${[['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']].map(([v, l]) => `<option value="${v}" ${F.since === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="fl two"><label><b>Binder</b><select id="fb"><option value="">All binders</option>${binder.binders().map(b => `<option ${F.binder === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
      <label><b>Pile</b><select id="fp"><option value="">Any</option><option value="none" ${F.pile === 'none' ? 'selected' : ''}>Not sorted</option>${PILES.map(([v, l]) => `<option value="${v}" ${F.pile === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="fl two"><label><b>Sort by</b><select id="fso">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><div></div></div>
    <div class="btn-row sticky-b"><button class="btn ghost" id="f-clear">Clear all</button><button class="btn primary" id="f-done">Show <span id="f-n"></span></button></div>`, root => {
    const upd = () => { root.querySelector('#f-n').textContent = `${applyFilters(binder.entries(), F, info, { lastBatch: S.lastBatch, fmtIdx: FMT_IDX }).length} cards`; renderBinder(); };
    root.querySelectorAll('[data-key]').forEach(b => b.onclick = () => { const k = b.dataset.key; const v = k === 'cmc' ? +b.dataset.v : b.dataset.v; F[k] = F[k].includes(v) ? F[k].filter(x => x !== v) : [...F[k], v]; b.setAttribute('aria-pressed', F[k].includes(v)); upd(); });
    root.querySelectorAll('#cm button').forEach(b => b.onclick = () => { F.colorMode = b.dataset.m; root.querySelectorAll('#cm button').forEach(x => x.classList.toggle('on', x === b)); upd(); });
    const bindSel = (id, k) => root.querySelector(id).onchange = e => { F[k] = e.target.value; upd(); };
    bindSel('#fs', 'set'); bindSel('#fl', 'legal'); bindSel('#ff', 'foil'); bindSel('#fd', 'since'); bindSel('#fb', 'binder'); bindSel('#fp', 'pile');
    root.querySelector('#fso').onchange = e => { S.sort = e.target.value; kvSet('sort', S.sort); upd(); };
    root.querySelector('#pmin').oninput = e => { F.pmin = e.target.value; upd(); }; root.querySelector('#pmax').oninput = e => { F.pmax = e.target.value; upd(); };
    root.querySelector('#f-clear').onclick = () => { S.F = DEFAULT_F(); closeSheet(); renderBinder(); openFilters(); };
    root.querySelector('#f-done').onclick = () => closeSheet();
    upd();
  });
}

// ---------- card detail: quantity, finish, condition, binder, pile, spare count, fix, sell
function openDetail(key, back) {
  const e = binder.get(key); if (!e) return back ? back() : closeSheet();
  const p = db().byId.get(e.id) || e; const u = unitPrice(e);
  const fins = (p.fin || 'n').split('').map(c => ({ n: 'nonfoil', f: 'foil', e: 'etched' }[c]));
  const own = binder.ownedByName().get(e.name) || 0, used = usedInDecks().get(e.name) || 0;
  openSheet(`<div class="detail"><img src="${img(e, 'normal')}" alt=""><div class="info">
      <h2>${esc(e.name)}</h2><div class="sub">${esc(e.set_name)} · ${esc(e.set.toUpperCase())} #${esc(e.cn)} ${styleTags(p)}</div>
      <div class="bigp">${money(u)} <span class="sub small">each${e.cond && e.cond !== 'NM' ? ` (${e.cond}; NM ${money(e.price)})` : ''}</span></div>
      <div class="qty"><button id="qm" aria-label="One fewer">−</button><span id="qv">${e.qty}</span><button id="qp" aria-label="One more">+</button></div>
      ${used ? `<div class="spare">Own ${own} · decks use ${used} · <b>${Math.max(0, own - used)} spare</b></div>` : ''}
    </div></div>
    <div class="fl"><b>Finish</b><div class="seg small" id="fin">${fins.map(f => `<button data-f="${f}" class="${f === e.finish ? 'on' : ''}">${f === 'nonfoil' ? 'Normal' : f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div></div>
    <div class="fl"><b>Condition</b><div class="seg small" id="cnd">${CONDS.map(c => `<button data-c="${c}" class="${c === (e.cond || 'NM') ? 'on' : ''}">${c}</button>`).join('')}</div></div>
    <div class="fl"><b>Pile</b><div class="seg small" id="pile">${PILES.map(([v, l]) => `<button data-p="${v}" class="${e.pile === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="fl two"><label><b>Binder</b><select id="bsel">${[...new Set([...binder.binders(), e.binder || DEFAULT_BINDER])].map(b => `<option ${b === (e.binder || DEFAULT_BINDER) ? 'selected' : ''}>${esc(b)}</option>`).join('')}<option value="__new">+ New binder…</option></select></label><div></div></div>
    <div class="btn-row"><button class="btn" id="chg">Fix card / printing</button><button class="btn" id="sold">Mark sold…</button></div>
    <div class="btn-row" style="margin-top:8px"><a class="btn ghost" target="_blank" rel="noopener" href="${ebaySold(e)}">eBay sold prices ↗</a><a class="btn ghost" target="_blank" rel="noopener" href="https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(short(e.name))}">TCGplayer ↗</a></div>
    ${back ? '<button class="btn ghost" id="bk" style="width:100%;margin-top:8px">‹ Back</button>' : ''}
    <button class="btn ghost warnc" id="del" style="width:100%;margin-top:8px">Delete</button>`, root => {
    const reopen = k => openDetail(k || key, back);
    root.querySelector('#qm').onclick = async () => { await binder.setQty(key, e.qty - 1); binder.get(key) ? reopen() : (back ? back() : closeSheet(), toast('Removed ' + e.name, undoLast)); };
    root.querySelector('#qp').onclick = async () => { await binder.setQty(key, e.qty + 1); reopen(); };
    root.querySelectorAll('#fin button').forEach(b => b.onclick = async () => { const nk = await binder.change(key, db().byId.get(e.id), b.dataset.f, {}, 'Changed finish'); reopen(nk); });
    root.querySelectorAll('#cnd button').forEach(b => b.onclick = async () => { const nk = await binder.change(key, null, null, { cond: b.dataset.c }, 'Condition'); reopen(nk); });
    root.querySelectorAll('#pile button').forEach(b => b.onclick = async () => { const v = e.pile === b.dataset.p ? '' : b.dataset.p; await binder.change(key, null, null, { pile: v }, 'Pile'); reopen(); });
    root.querySelector('#bsel').onchange = async ev => { let v = ev.target.value; if (v === '__new') { v = (prompt('Binder name') || '').trim().slice(0, 40); if (!v) return reopen(); } const nk = await binder.change(key, null, null, { binder: v }, 'Moved'); toast(`Moved to ${v}`, undoLast); reopen(nk); };
    root.querySelector('#chg').onclick = () => openPicker({ name: e.name, selId: e.id, finish: e.finish, cond: e.cond || 'NM', allowCond: true, onClose: () => setTimeout(() => { if (!sheetOpen()) openDetail(key, back); }, 250),
      onPick: async ({ print, finish, cond }) => { const cur = binder.get(key); if (!cur) return; const nk = await binder.change(key, print, finish, { cond }); key = nk || key; } , extra: el => { el.innerHTML = '<div class="sub small">Changes save as you tap. Close when done.</div>'; } });
    root.querySelector('#sold').onclick = () => soldSheet(key, back);
    root.querySelector('#bk')?.addEventListener('click', () => back());
    root.querySelector('#del').onclick = async () => { await binder.remove(key); back ? back() : closeSheet(); toast('Deleted ' + e.name, undoLast); };
  });
}
const ebaySold = e => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${short(e.name)} ${e.set_name} mtg${e.finish !== 'nonfoil' ? ' foil' : ''}`)}&LH_Sold=1&LH_Complete=1`;
function soldSheet(key, back) {
  const e = binder.get(key); if (!e) return;
  openSheet(`<h2>Sold ${esc(short(e.name))}</h2><div class="sub small">Takes the copies out of your binder and logs the sale. Market: ${money(unitPrice(e))} each.</div>
    <div class="fl two"><label><b>How many</b><input id="sq" type="number" min="1" max="${e.qty}" value="1" inputmode="numeric"></label><label><b>Sold for $ (each)</b><input id="sp" type="number" min="0" step="0.01" inputmode="decimal" value="${(unitPrice(e) ?? 0).toFixed(2)}"></label></div>
    <div class="fl two"><label><b>You paid $ (each, optional)</b><input id="sc" type="number" min="0" step="0.01" inputmode="decimal" value="${e.cost ?? ''}"></label><div class="sub small" id="sprof" style="align-self:end"></div></div>
    <button class="btn big primary" id="sgo">Log sale</button>`, root => {
    const upd = () => { const q = +root.querySelector('#sq').value || 1, pr = +root.querySelector('#sp').value || 0, c = root.querySelector('#sc').value === '' ? 0 : +root.querySelector('#sc').value; root.querySelector('#sprof').textContent = `Profit ${money((pr - c) * q)}`; };
    root.querySelectorAll('input').forEach(i => i.oninput = upd); upd();
    root.querySelector('#sgo').onclick = async () => {
      const q = Math.max(1, Math.min(e.qty, parseInt(root.querySelector('#sq').value, 10) || 1)), pr = +root.querySelector('#sp').value || 0, cv = root.querySelector('#sc').value;
      if (cv !== '') await binder.change(key, null, null, { cost: +cv }, null);
      const rec = await binder.sell(key, q, pr); closeSheet(); renderValue();
      toast(`Sold ${q} × ${short(e.name)} for ${money(pr * q)}`, async () => { await binder.unsell(rec); renderValue(); toast('Sale undone'); });
    };
  });
}

// ---------- bulk sort: one card at a time into Keep / Sell / Trade / Bulk, with running totals
$('#btn-piles').onclick = () => { const l = filtered(); if (!l.length) return toast('No cards to sort'); sortPiles(l.map(e => e.key)); };
function sortPiles(keys) {
  let i = keys.findIndex(k => !binder.get(k)?.pile); if (i < 0) i = 0; const hist = [];
  const draw = () => {
    while (i < keys.length && !binder.get(keys[i])) i++;
    const tot = { keep: [0, 0], sell: [0, 0], trade: [0, 0], bulk: [0, 0] }; for (const k of keys) { const x = binder.get(k); if (x?.pile) { tot[x.pile][0] += x.qty; tot[x.pile][1] += (unitPrice(x) || 0) * x.qty; } }
    const totals = `<div class="pile-tot">${PILES.map(([v, l]) => `<div class="pt ${v}"><b>${l}</b><span>${tot[v][0]} · ${money(tot[v][1])}</span></div>`).join('')}</div>`;
    if (i >= keys.length) return openSheet(`<h2>All sorted</h2>${totals}<div class="btn-row" style="margin-top:12px"><button class="btn" id="ps-sell">Export Sell pile…</button><button class="btn ghost" id="ps-x">Done</button></div>`, r => { r.querySelector('#ps-x').onclick = () => closeSheet(); r.querySelector('#ps-sell').onclick = () => exportSheet('sell'); });
    const e = binder.get(keys[i]); const u = unitPrice(e);
    openSheet(`<div class="sub small">${i + 1} of ${keys.length}</div><div class="ps-card"><img src="${img(e, 'normal')}" alt=""><div><h2>${esc(short(e.name))}</h2><div class="sub small">${esc(e.set.toUpperCase())} #${esc(e.cn)}${e.finish !== 'nonfoil' ? ' · ' + e.finish : ''}${e.qty > 1 ? ' · ×' + e.qty : ''}</div><div class="bigp">${money(u)}</div>${(u || 0) >= 5 ? '<span class="tag sell">$5+ — worth selling</span>' : ''}</div></div>
      <div class="pile-btns">${PILES.map(([v, l]) => `<button class="btn big pb-${v} ${e.pile === v ? 'on' : ''}" data-p="${v}">${l}</button>`).join('')}</div>${totals}
      <div class="btn-row"><button class="btn ghost" id="ps-back" ${hist.length ? '' : 'disabled'}>‹ Back</button><button class="btn ghost" id="ps-skip">Skip ›</button></div>`, root => {
      root.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => { navigator.vibrate?.(15); await binder.change(e.key, null, null, { pile: b.dataset.p }, null); hist.push(i); i++; draw(); });
      root.querySelector('#ps-skip').onclick = () => { hist.push(i); i++; draw(); };
      root.querySelector('#ps-back').onclick = () => { if (hist.length) { i = hist.pop(); draw(); } };
    });
  };
  draw();
}

// ---------- value view
async function renderValue() {
  const t = binder.totals(binder.entries(), unitPrice);
  $('#total').textContent = money(t.value);
  $('#total-sub').textContent = `${t.count} cards · ${t.unique} unique · ${t.over5} worth $5+ (${money(t.over5v)})`;
  const at = await kvGet('pricesAt'); $('#prices-age').textContent = at ? 'Prices updated ' + new Date(at).toLocaleString() : `Prices from card data of ${db()?.built || '…'}`;
  const pt = {}; for (const e of binder.entries()) if (e.pile) { pt[e.pile] ??= [0, 0]; pt[e.pile][0] += e.qty; pt[e.pile][1] += (unitPrice(e) || 0) * e.qty; }
  $('#piles-sum').innerHTML = Object.keys(pt).length ? `<div class="pile-tot">${PILES.filter(([v]) => pt[v]).map(([v, l]) => `<button class="pt ${v}" data-p="${v}"><b>${l}</b><span>${pt[v][0]} · ${money(pt[v][1])}</span></button>`).join('')}</div>` : '';
  $$('#piles-sum [data-p]').forEach(b => b.onclick = () => { S.F = { ...DEFAULT_F(), pile: b.dataset.p }; show('binder'); });
  const st = binder.salesTotals(); $('#sales-sum').hidden = !st.n;
  if (st.n) { $('#sales-sum').innerHTML = `<div><b>Sold</b> ${st.n} card${st.n === 1 ? '' : 's'} · ${money(st.rev)} · profit <b>${money(st.profit)}</b></div><button class="btn small ghost" id="sales-open">Sales log</button>`; $('#sales-open').onclick = salesLog; }
  $('#top').innerHTML = binder.entries().sort((a, b) => (unitPrice(b) || 0) * b.qty - (unitPrice(a) || 0) * a.qty).slice(0, 15).map(row).join('') || '<div class="empty">No cards yet.</div>';
  $$('#top .li').forEach(el => el.onclick = () => openDetail(el.dataset.k));
}
function salesLog() {
  const l = binder.sales.slice().reverse();
  openSheet(`<h2>Sales</h2><div class="list tight">${l.map(s => `<div class="li"><div class="t"><div class="n">${s.qty}× ${esc(short(s.name))}</div><div class="s">${esc(s.set.toUpperCase())} #${esc(s.cn)} · ${new Date(s.at).toLocaleDateString()}</div></div><div><div class="p">${money(s.each * s.qty)}</div><div class="q">profit ${money((s.each - (s.cost ?? 0)) * s.qty)}</div></div></div>`).join('')}</div>
    <button class="btn" id="sl-csv" style="width:100%;margin-top:10px">Save sales CSV</button>`, root => root.querySelector('#sl-csv').onclick = () => { const rows = [['Date', 'Name', 'Set', 'Number', 'Finish', 'Condition', 'Qty', 'Sold each', 'Cost each', 'Profit']]; for (const s of binder.sales) rows.push([new Date(s.at).toISOString().slice(0, 10), s.name, s.set.toUpperCase(), s.cn, s.finish, s.cond || 'NM', s.qty, s.each, s.cost ?? '', ((s.each - (s.cost ?? 0)) * s.qty).toFixed(2)]); download(`sales-${stamp()}.csv`, rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n') + '\r\n'); });
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
// exports: pick what (everything / what the Binder filter shows / Sell pile), and for sell lists a price rule
const byName = l => l.slice().sort((a, b) => a.name.localeCompare(b.name));
const EXPORTS = [
  ['moxfield', 'Moxfield', 'CSV', l => exportMoxfield(l)], ['archidekt', 'Archidekt', 'CSV', l => exportArchidekt(l)], ['goldfish', 'MTGGoldfish', 'CSV', l => exportGoldfish(l)],
  ['deckbox', 'Deckbox', 'CSV', l => exportDeckbox(l)], ['manabox', 'ManaBox', 'CSV', l => exportManaBoxCSV(l)], ['tcgplayer', 'TCGplayer Mass Entry', 'text · pick foil on TCGplayer', l => exportTCGplayer(l)],
  ['decklist', 'Plain text list', 'text', l => exportText(l)], ['card-binder', 'Spreadsheet (with prices)', 'CSV', l => exportCSV(l)],
];
$('#btn-export').onclick = () => exportSheet();
function exportSheet(scope0) {
  if (!binder.entries().length) return toast('No cards yet');
  const st = { scope: scope0 || (binder.entries().some(e => e.pile === 'sell') ? 'all' : 'all'), pct: 0 };
  const pick = () => byName(st.scope === 'filter' ? filtered() : st.scope === 'sell' ? binder.entries().filter(e => e.pile === 'sell') : st.scope === 'last' ? lastBatchEntries() : binder.entries());
  const draw = () => { const l = pick(); const n = l.reduce((a, e) => a + e.qty, 0);
    openSheet(`<h2>Export</h2><div class="seg small" id="sc">${[['all', 'Everything'], ['filter', 'Filtered'], ['sell', 'Sell pile'], ['last', 'Last scan']].map(([v, t]) => `<button data-s="${v}" class="${st.scope === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="sub small">${n} card${n === 1 ? '' : 's'} · set code, number, foil, condition and quantity included. Text formats are also copied.</div>
      <h3 class="h">Sell lists</h3><div class="fl"><b>List price</b><div class="seg small" id="pct">${[0, 5, 10, 15, 20].map(p => `<button data-p="${p}" class="${st.pct === p ? 'on' : ''}">${p ? 'Market −' + p + '%' : 'Market'}</button>`).join('')}</div></div>
      <div class="exp"><button class="btn" data-x="tcgsell">TCGplayer sell list <small>CSV · condition + your price</small></button><button class="btn" data-x="ebay">eBay bulk listing <small>CSV · auto titles, drafts</small></button></div>
      <h3 class="h">Collection</h3><div class="exp">${EXPORTS.map(([k, nm, t]) => `<button class="btn" data-k="${k}">${nm} <small>${t}</small></button>`).join('')}</div>`, root => {
      root.querySelectorAll('#sc button').forEach(b => b.onclick = () => { st.scope = b.dataset.s; draw(); });
      root.querySelectorAll('#pct button').forEach(b => b.onclick = () => { st.pct = +b.dataset.p; draw(); });
      const ok = () => { if (!pick().length) { toast('Nothing in that list'); return false; } return true; };
      root.querySelector('[data-x=tcgsell]').onclick = () => { if (ok()) { download(`tcgplayer-sell-${stamp()}.csv`, exportSellTCG(pick(), st.pct)); toast('Saved TCGplayer sell list'); } };
      root.querySelector('[data-x=ebay]').onclick = () => { if (ok()) { download(`ebay-listings-${stamp()}.csv`, exportEbay(pick(), st.pct, e => img(e, 'large'))); toast('Saved eBay CSV — upload in Seller Hub › Reports'); } };
      root.querySelectorAll('[data-k]').forEach(b => b.onclick = async () => { if (!ok()) return; const [k, nm, t, fn] = EXPORTS.find(x => x[0] === b.dataset.k); const text = fn(pick());
        if (t.startsWith('text')) copyOrSave(`${k}-${stamp()}.txt`, text, nm + ' list'); else { download(`${k}-${stamp()}.csv`, text); toast(`Saved ${nm} CSV`); } });
    }); };
  draw();
}
$('#imp').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; await loadDB();
  const { items, missing } = importManaBox(await f.text(), db()); e.target.value = '';
  if (!items.length) return toast('No cards recognised in that file');
  await binder.add(items.map(i => ({ ...i, binder: S.dest.binder || DEFAULT_BINDER })), `Import (${items.length})`);
  toast(`Imported ${items.reduce((a, i) => a + i.qty, 0)} cards` + (missing.length ? ` · ${missing.length} row${missing.length === 1 ? '' : 's'} not matched` : ''), undoLast); renderValue();
};
$('#btn-sync').onclick = () => openSheet(`<h2>Backup</h2><p class="sub">Your binder, decks and sales are saved on this phone. Save a backup file to Google Drive or Files, and restore it on any device.</p>
  <div class="btn-row"><button class="btn big" id="bk">Save backup</button><label class="btn big">Restore<input type="file" id="rs" accept=".json,application/json" hidden></label></div>`, root => {
  root.querySelector('#bk').onclick = () => download(`card-binder-backup-${stamp()}.json`, JSON.stringify({ app: 'card-binder', v: 2, cards: binder.entries(), decks: D.decks, sales: binder.sales }), 'application/json');
  root.querySelector('#rs').onchange = async ev => { try { const j = JSON.parse(await ev.target.files[0].text()); const ch = validateBackup(j); await binder.apply(ch, 'Restore');
      if (Array.isArray(j.decks)) { for (const d of j.decks) if (d?.id && Array.isArray(d.cards) && !getDeck(d.id)) D.decks.push(d); kvSet('decks', D.decks); }
      closeSheet(); toast(`Restored ${ch.length} entries`, undoLast); renderValue(); } catch (err) { toast(err.message?.startsWith('Backup') ? err.message : 'That file is not a Card Binder backup'); } };
});
// strict restore: every row must be a known printing with a valid finish and whole-number quantity; identity is rebuilt from the card data
function validateBackup(j) {
  if (j?.app !== 'card-binder' || ![1, 2].includes(j.v) || !Array.isArray(j.cards)) throw new Error('Backup: not a Card Binder file');
  const out = new Map(); let bad = 0;
  for (const c of j.cards) {
    const p = db().byId.get(c?.id), f = { nonfoil: 'n', foil: 'f', etched: 'e' }[c?.finish];
    if (!p || !f || !p.fin.includes(f) || !Number.isSafeInteger(c.qty) || c.qty < 1) { bad++; continue; }
    const cond = CONDS.includes(c.cond) ? c.cond : 'NM', bname = typeof c.binder === 'string' && c.binder.trim() ? c.binder.trim().slice(0, 40) : DEFAULT_BINDER;
    const e = { ...Binder.fromPrint(p, c.finish, c.qty, { cond, binder: bname, batch: Number.isFinite(c.batch) ? c.batch : null, pile: PILES.some(x => x[0] === c.pile) ? c.pile : '' }), price: Number.isFinite(c.price) ? c.price : priceOf(p, c.finish) ?? null, added: Number.isFinite(c.added) ? c.added : Date.now(), cost: Number.isFinite(c.cost) ? c.cost : undefined };
    const prev = out.get(e.key); out.set(e.key, prev ? { ...prev, qty: prev.qty + e.qty } : e);
  }
  if (bad && !out.size) throw new Error('Backup: no valid cards in this file');
  return [...out.values()].map(e => ({ key: e.key, before: binder.get(e.key) || null, after: e }));
}

// ---------- boot
binder.on(() => { if (S.tab === 'binder') renderBinder(); if (S.tab === 'value') renderValue(); });
(async () => {
  status('Loading cards…');
  const mode = await kvGet('mode'); if (mode) $(`#mode-seg [data-mode="${mode}"]`)?.click();
  S.sort = (await kvGet('sort')) || 'value'; S.lastBatch = (await kvGet('lastBatch')) ?? null; const db0 = await kvGet('destBinder'); if (db0) S.dest = { binder: db0 };
  await Promise.all([loadDB(), binder.load()]);
  await loadMeta(db()).catch(e => console.warn('meta', e));
  await initDecks({ recordDeck, deckVideo, scanInto, deckToBinder, setDest: d => { if (!d && S.dest.deck) setDest(null); } });
  renderDest(); loadJob().catch(() => {}); if (await kvGet('priceMode')) setPrice(true);
  engine().catch(() => {});
  if (await kvGet('camOK')) startCam();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict the binder
})();
window.__app = { S, binder, capture, show, D }; document.body.dataset.tab = 'scan';

// ---------- decks <-> scanner
function scanInto(d, { commander = false } = {}) { setDest({ deck: d.id, commander }); show('scan'); toast(commander ? 'Scan your commander' : `Scanning into ${d.name} — alerts pop up as you go`); if (!S.stream) startCam(); }
async function recordDeck(d) { setDest({ deck: d.id }); show('scan'); if (S.mode !== 'single') $('#mode-seg [data-mode=single]').click(); await startRec(); toast('Deal the deck one card at a time under the camera — pause about half a second on each', null, 5000); }
function deckVideo(d, file) { setDest({ deck: d.id }); runRecord(file, { deck: d.id }); }
async function deckToBinder(d) {
  const items = [...d.commanders.map(c => ({ print: db().byId.get(c.id), finish: 'nonfoil', qty: 1 })), ...d.cards.map(c => ({ print: db().byId.get(c.id), finish: c.finish, qty: c.qty }))].filter(i => i.print);
  if (!items.length) return toast('Deck is empty');
  const b = batchId(true); await binder.add(items.map(i => ({ ...i, binder: d.name, batch: b })), `Deck → binder (${items.length})`);
  toast(`Added ${items.reduce((a, i) => a + i.qty, 0)} cards to binder “${d.name}”`, undoLast);
}

// ---------- Record mode: film your cards, then review everything at once.
// 1-card mode = deal cards one at a time (each pause is one card, duplicates counted); 4/9 mode = sweep binder pages.
let recorder = null, recChunks = [];
function setRecUI(on) { S.rec = on; $('#tg-rec').setAttribute('aria-pressed', on); $('#tg-rec').textContent = on ? '■ Stop' : '● Rec'; $('#btn-shutter').classList.toggle('recording', on); }
$('#tg-rec').onclick = () => S.rec ? stopRec() : startRec();
async function startRec() {
  if (!S.stream) await startCam(); if (!S.stream) return;
  setAuto(false); engine();
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t));
  try { recorder = new MediaRecorder(S.stream, { mimeType: type, videoBitsPerSecond: 8e6 }); } catch (e) { toast('Recording isn’t supported here — use Video instead'); return; }
  recChunks = []; recorder.ondataavailable = e => e.data.size && recChunks.push(e.data);
  const dest = S.dest.deck ? { deck: S.dest.deck } : null;
  recorder.onstop = () => { const b = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' }); recChunks = []; runRecord(b, dest); };
  recorder.start(1000); setRecUI(true); status(S.mode === 'single' ? 'Recording — deal one card at a time, pause ~½ s on each' : 'Recording — sweep slowly, pause ~1 s on each page'); liveQuads = [];
}
function stopRec() { if (recorder && recorder.state !== 'inactive') recorder.stop(); setRecUI(false); }
$('#vid-in').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) runRecord(f, S.dest.deck ? { deck: S.dest.deck } : null); };
// A video is read in the background: close the sheet any time, a pill shows progress and reopens the results.
const JOB = { state: 'idle', pct: 0, msg: '', ac: null, items: [], dest: null };
function pill() {
  const el = $('#job-pill');
  if (JOB.state === 'running') { el.hidden = false; el.className = 'job-pill run'; el.textContent = `Reading video… ${Math.round(JOB.pct * 100)}%`; }
  else if (JOB.state === 'done' && JOB.items.length) { el.hidden = false; el.className = 'job-pill'; el.textContent = `${JOB.items.length} card${JOB.items.length === 1 ? '' : 's'} to review ›`; }
  else el.hidden = true;
}
$('#job-pill').onclick = () => openJob();
// results must survive a reload: if storage fails, say so (the in-memory review still works)
const saveJob = () => kvSetRequired('videoJob', JOB.state === 'done' && JOB.items.length ? { at: Date.now(), items: JOB.items.map(i => ({ ...i, print: i.print.id, alts: i.alts.slice(0, 20).map(a => a.id) })) } : null)
  .catch(() => { status('Video results couldn’t be saved — add them before closing'); toast('Phone storage full: add these results before closing the app', null, 6000); });
async function loadJob() {
  const j = await kvGet('videoJob'); if (!j?.items?.length) return;
  JOB.items = j.items.map(i => ({ ...i, print: db().byId.get(i.print), alts: (i.alts || []).map(id => db().byId.get(id)).filter(Boolean) })).filter(i => i.print);
  if (JOB.items.length) { JOB.state = 'done'; pill(); }
}
function openJob() {
  if (JOB.state === 'running') {
    openSheet(`<h3>Reading your video…</h3><div class="sub small">You can close this — it keeps going. Tap the pill to come back.</div><div class="prog"><i id="rp" style="width:${JOB.pct * 100}%"></i></div><div id="rs" class="sub small">${esc(JOB.msg)}</div>
      <div class="btn-row"><button class="btn" id="rh">Keep going in background</button><button class="btn ghost warnc" id="rc">Cancel</button></div>`, root => {
      root.querySelector('#rh').onclick = () => closeSheet();
      root.querySelector('#rc').onclick = () => { JOB.ac?.abort(); closeSheet(); };
    });
  } else if (JOB.state === 'done') showReview();
}
async function runRecord(blob, dest = null) {
  if (JOB.state === 'running') return toast('Already reading a video — tap the pill');
  if (!dest && JOB.state === 'done' && JOB.items.length && !confirm(`You still have ${JOB.items.length} cards to review from the last video. Replace them?`)) return;
  const prevItems = JOB.items; const ac = new AbortController(); Object.assign(JOB, { state: 'running', pct: 0, msg: 'Starting…', ac, items: [], dest }); pill(); openJob();
  try {
    const idf = await engine(); const { processVideo, processDeck } = await import('./record.js');
    const onProgress = (f, msg) => { JOB.pct = f; JOB.msg = msg; pill(); const p = $('#rp'), m = $('#rs'); if (p) p.style.width = (f * 100).toFixed(0) + '%'; if (m) m.textContent = msg; };
    const deckMode = !!dest?.deck || S.mode === 'single';
    const r = deckMode ? await processDeck(idf, blob, { signal: ac.signal, onProgress }) : await processVideo(idf, blob, { signal: ac.signal, onProgress });
    const items = r.cards.map(c => ({ id: Math.random().toString(36).slice(2), print: c.match, alts: c.alts || [], conf: c.conf, amb: !!c.printAmbiguous, finish: chooseFinish(c.match), qty: 1, on: c.conf !== 'low', thumb: thumbOf(c.cardCanvas) }));
    navigator.vibrate?.([40, 60, 40]);
    if (dest?.deck) { // straight into the deck; unsure ones are marked "check"
      const d = getDeck(dest.deck); Object.assign(JOB, { state: prevItems.length ? 'done' : 'idle', items: prevItems }); pill();
      if (!d) return; if (!items.length) return openSheet('<h3>No cards found</h3><p class="sub">Deal one card at a time, fill most of the screen, pause about half a second, and avoid glare.</p>');
      const { r: res } = addToDeck(d, items.map(i => ({ print: i.print, finish: i.finish, qty: 1, conf: i.conf === 'low' ? 'low' : 'high', thumb: i.thumb, alts: i.alts.slice(0, 12).map(a => a.id) })), { quiet: true });
      if (res.issues.some(i => i.name)) alertBuzz('warn');
      closeSheet(); D.cur = d.id; show('decks'); toast(`Read ${items.length} cards in ${(r.ms / 1000).toFixed(0)}s${res.issues.length ? ` · ${res.issues.length} alert${res.issues.length > 1 ? 's' : ''}` : ' · deck is legal'}`, null, 5000); return;
    }
    JOB.items = items; JOB.state = 'done'; await saveJob(); pill();
    if (!JOB.items.length) { JOB.state = 'idle'; pill(); openSheet('<h3>No cards found</h3><p class="sub">Hold each card or page still for about a second, fill most of the screen, and avoid glare.</p>'); }
    else if (sheetOpen() && $('#rp')) showReview(); else toast(`Video done: ${JOB.items.length} cards to review`, null);
  } catch (e) {
    const cancelled = ac.signal.aborted; Object.assign(JOB, { state: prevItems.length ? 'done' : 'idle', items: prevItems }); pill();
    if (cancelled) toast('Video cancelled'); else { console.error(e); openSheet(`<h3>Couldn’t read that video</h3><p class="sub">${esc(e.message)}</p>`); }
  }
}
function showReview() {
  const items = JOB.items;
  const draw = root => {
    const on = items.filter(i => i.on); const val = on.reduce((s, i) => s + (priceOf(i.print, i.finish) || 0) * i.qty, 0);
    root.innerHTML = `<h3>${items.length} cards found</h3><div class="sub small">Amber = not sure (unchecked). Tap a card to fix it. Saved until you add or discard. Going into <b>${esc(S.dest.binder || DEFAULT_BINDER)}</b>.</div>
      <div class="rv">${items.map(i => `<div class="rv-it ${i.conf}${i.amb ? ' amb' : ''}" data-id="${i.id}"><input type="checkbox" ${i.on ? 'checked' : ''} aria-label="Include"><img src="${img(i.print, 'small')}" alt="" loading="lazy">
      <div class="nmc"><b>${esc(short(i.print.name))}</b><div class="sub small">${esc(i.print.set.toUpperCase())} #${esc(i.print.cn)}${isOldFrame(i.print) ? ' · old' : ''}${i.finish !== 'nonfoil' ? ' · ' + i.finish : ''} · ${money(priceOf(i.print, i.finish))}${i.amb ? ' · check printing' : ''}</div></div>
      <div class="q"><button data-d="-1" aria-label="Fewer">−</button><span>${i.qty}</span><button data-d="1" aria-label="More">+</button></div></div>`).join('')}</div>
      <button class="btn big primary" id="rv-add" ${on.length ? '' : 'disabled'}>Add ${on.reduce((s, i) => s + i.qty, 0)} to binder · ${money(val)}</button>
      <button class="btn ghost warnc" id="rv-discard" style="width:100%;margin-top:8px">Discard this video’s results</button>`;
    root.querySelectorAll('.rv-it').forEach(el => { const it = items.find(x => x.id === el.dataset.id);
      el.querySelector('input').onchange = e => { it.on = e.target.checked; saveJob(); draw(root); };
      el.querySelectorAll('.q button').forEach(b => b.onclick = e => { e.stopPropagation(); it.qty = Math.max(1, it.qty + +b.dataset.d); saveJob(); draw(root); });
      el.querySelector('img').onclick = el.querySelector('.nmc').onclick = () => openPicker({ name: it.print.name, selId: it.print.id, preferIds: it.alts.map(a => a.id), thumb: it.thumb, finish: it.finish,
        onPick: ({ print, finish }) => { it.print = print; it.finish = finish; it.on = true; it.conf = 'high'; it.amb = false; saveJob(); }, onClose: () => setTimeout(() => { if (!sheetOpen()) showReview(); }, 250) }); });
    const addBtn = root.querySelector('#rv-add');
    addBtn.onclick = async () => {
      addBtn.disabled = true; // no double-add
      const add = items.filter(i => i.on); const b = batchId(true);
      await binder.add(add.map(i => ({ print: i.print, finish: i.finish, qty: i.qty, binder: S.dest.binder || DEFAULT_BINDER, batch: b })), `Video (${add.length})`);
      S.tray = [...add.map(i => ({ ...i, added: true, dest: { binder: S.dest.binder || DEFAULT_BINDER } })), ...S.tray].slice(0, 60); renderTray();
      Object.assign(JOB, { state: 'idle', items: [] }); saveJob(); pill(); closeSheet(); renderDest();
      toast(`Added ${add.reduce((s, i) => s + i.qty, 0)} cards`, undoLast);
    };
    root.querySelector('#rv-discard').onclick = () => { if (!confirm('Discard these results?')) return; Object.assign(JOB, { state: 'idle', items: [] }); saveJob(); pill(); closeSheet(); };
  };
  openSheet('', draw);
}

// ---------- Price check: scan and just see the price (nothing is added)
function setPrice(on) { S.price = on; $('#tg-price').setAttribute('aria-pressed', on); kvSet('priceMode', on); if (!on) $('#pcard').hidden = true; status(on ? 'Price check: scan a card to see its price' : S.idf ? 'Ready' : 'Loading…'); }
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
    const draw = pr => { const v = pr ? (chooseFinish(p) === 'nonfoil' ? pr.usd ?? pr.usd_foil : pr.usd_foil ?? pr.usd_etched) : priceOf(p, chooseFinish(p));
      el.innerHTML = `<img src="${img(p, 'small')}" alt=""><div><div class="nm">${esc(short(p.name))}${(v || 0) >= 5 ? ' <span class="tag sell">$5+</span>' : ''}</div><div class="sub small">${esc(p.set.toUpperCase())} #${esc(p.cn)} · ${esc(p.set_name)}${isOldFrame(p) ? ' · old' : ''}</div><div class="pr2">${priceLine(p, pr)}</div><div class="sub small">${pr?.live ? 'TCGplayer market via Scryfall' : 'Saved price · updating…'} · <a href="${ebaySold({ name: p.name, set_name: p.set_name, finish: chooseFinish(p) })}" target="_blank" rel="noopener">eBay sold ↗</a>${r.conf === 'low' ? ' · not sure it’s this card' : ''}</div></div>
      <div class="acts"><button class="btn small" id="pc-add">Add</button><button class="btn small ghost" id="pc-other">Other</button><button class="btn small ghost" id="pc-x">✕</button></div>`;
      el.querySelector('#pc-x').onclick = () => el.hidden = true;
      el.querySelector('#pc-add').onclick = async () => { const f = chooseFinish(p); await binder.add([{ print: p, finish: f, binder: S.dest.binder || DEFAULT_BINDER, batch: batchId() }], 'Added ' + p.name); toast(`Added ${p.name}`, undoLast); el.hidden = true; renderDest(); };
      el.querySelector('#pc-other').onclick = () => openPicker({ name: p.name, selId: p.id, preferIds: (r.alts || []).map(a => a.id), onPick: async ({ print }) => { p = print; draw(null); draw(await freshPrices(p)); } });
    };
    draw(null); el.hidden = false; freshPrices(p).then(pr => { if (pr && found[0].match === r.match) draw(pr); });
  } else {
    const draw = prs => { let tot = 0; const rows = found.map((r, i) => { const p = r.match, x = prs[i] || p, f = chooseFinish(p); const v = f === 'foil' ? x.usd_foil : f === 'etched' ? x.usd_etched : (x.usd ?? x.usd_foil); tot += v || 0; return `<div class="mrow"><span>${esc(short(p.name))} <span class="sub small">${esc(p.set.toUpperCase())}</span></span><b>${money(v)}</b></div>`; }).join('');
      el.innerHTML = `<div class="multi">${rows}<div class="mrow"><b>Total (${found.length})</b><b>${money(tot)}</b></div></div><div class="acts" style="grid-column:1/-1;flex-direction:row"><button class="btn small" id="pc-add">Add all</button><button class="btn small ghost" id="pc-x">✕</button></div>`;
      el.querySelector('#pc-x').onclick = () => el.hidden = true;
      el.querySelector('#pc-add').onclick = async () => { const b = batchId(); await binder.add(found.map(r => ({ print: r.match, finish: chooseFinish(r.match), binder: S.dest.binder || DEFAULT_BINDER, batch: b })), `Added ${found.length}`); toast(`Added ${found.length} cards`, undoLast); el.hidden = true; renderDest(); };
    };
    draw([]); el.hidden = false; Promise.all(found.map(r => freshPrices(r.match))).then(draw);
  }
}
