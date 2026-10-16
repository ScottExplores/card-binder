// Load OpenCV.js once and resolve when the WASM runtime is ready.
let p;
export function loadCV(src = './vendor/opencv.js') {
  if (p) return p;
  p = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = async () => {
      const t0 = Date.now();
      const poll = () => { const cv = window.cv; if (cv && cv.Mat && cv.getBuildInformation) { delete cv.then; return res(cv); } if (Date.now() - t0 > 60000) return rej(new Error('OpenCV load timeout')); setTimeout(poll, 50); };
      poll();
    };
    s.onerror = rej; document.head.appendChild(s);
  });
  return p;
}
