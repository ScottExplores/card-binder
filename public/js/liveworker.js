// Live card-outline detection off the main thread (classic worker: OpenCV.js via importScripts, vision.js via dynamic import).
let cv = null, V = null, ready = null;
function init(base) {
  if (ready) return ready;
  ready = (async () => {
    importScripts(base + 'vendor/opencv.js');
    const t0 = Date.now();
    while (!(self.cv && self.cv.Mat)) { if (Date.now() - t0 > 60000) throw new Error('cv timeout'); await new Promise(r => setTimeout(r, 50)); }
    cv = self.cv; V = await import(base + 'js/vision.js');
    postMessage({ ready: true });
  })().catch(e => postMessage({ error: String(e) }));
  return ready;
}
let canvas = null, g = null;
onmessage = async e => {
  const m = e.data;
  if (m.init) return init(m.base);
  if (!V) { m.bmp?.close(); return postMessage({ quads: [], id: m.id }); }
  const t0 = performance.now(); const { bmp, n } = m;
  if (!canvas || canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas = new OffscreenCanvas(bmp.width, bmp.height); g = canvas.getContext('2d', { willReadFrequently: true }); }
  g.drawImage(bmp, 0, 0); bmp.close();
  const src = cv.matFromImageData(g.getImageData(0, 0, canvas.width, canvas.height));
  let quads = []; try { quads = V.detectLive(cv, src, { n }); } catch { } src.delete();
  postMessage({ quads: quads.map(q => q.map(p => [p[0], p[1]])), id: m.id, sc: m.sc, ms: performance.now() - t0 });
};
