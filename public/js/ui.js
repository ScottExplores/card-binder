// Shared UI helpers: DOM shortcuts, money, toast with undo, bottom sheets (close with ✕, backdrop, or phone Back), alerts.
export const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
export const money = v => v == null ? '—' : '$' + v.toFixed(2);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const short = n => String(n || '').split(' // ')[0];
let toastT;
export function toast(msg, undo, ms) {
  const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button id="t-undo">Undo</button>' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms || (undo ? 6000 : 2500));
  if (undo) $('#t-undo').onclick = async () => { t.hidden = true; await undo(); };
}
export const SH = { open: false, onClose: null, stack: [] };
export function openSheet(html, bind, onClose = null) {
  if (SH.onClose && SH.onClose !== onClose) { const f = SH.onClose; SH.onClose = null; f(); }
  SH.onClose = onClose; $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; $('#sheet-body').scrollTop = 0;
  if (!SH.open) { SH.open = true; history.pushState({ sheet: 1 }, ''); }
  bind && bind($('#sheet-body'));
}
export function closeSheet(fromBack = false) {
  $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; const f = SH.onClose; SH.onClose = null; f && f();
  if (SH.open) { SH.open = false; if (!fromBack) history.back(); }
}
export const sheetOpen = () => SH.open;
// gentle alert: vibration + short two-tone beep (no sound if the phone is on silent / audio blocked)
let ac;
export function alertBuzz(kind = 'warn') {
  try { navigator.vibrate?.(kind === 'warn' ? [80, 60, 80] : 30); } catch { }
  try { ac ??= new (window.AudioContext || window.webkitAudioContext)(); const t = ac.currentTime;
    const tones = kind === 'warn' ? [[660, 0], [520, 0.13]] : [[880, 0]];
    for (const [f, d] of tones) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12); o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.14); }
  } catch { }
}
export function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
export const stamp = () => new Date().toISOString().slice(0, 10);
export async function copyOrSave(name, text, label) { let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch { } download(name, text, 'text/plain'); toast(copied ? `Copied ${label} — paste it in, or use the saved file` : `Saved ${label} file`); }
