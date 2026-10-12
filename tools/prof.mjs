import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__cb = [];
  window.requestAnimationFrame = (f) => raf((t) => { const a = performance.now(); f(t); window.__cb.push(performance.now() - a); });
});
await page.goto('http://localhost:8765/?ui=0&tod=3&rain=0.6', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 5000));
const run = (move) => page.evaluate((move) => new Promise(res => {
  __cb.length = 0; let i = 0; const ft = []; let l = performance.now();
  const tick = () => { const n = performance.now(); ft.push(n - l); l = n; if (move) dispatchEvent(new PointerEvent('pointermove', { clientX: 200 + (i++ % 120) * 9, clientY: 640 })); if (ft.length < 150) setTimeout(tick, 0); };
  const iv = setInterval(() => { if (move) dispatchEvent(new PointerEvent('pointermove', { clientX: 200 + (i++ % 120) * 9, clientY: 640 })); }, 16);
  setTimeout(() => { clearInterval(iv); const c = __cb.slice(5).sort((a, b) => a - b); res({ cbP50: +c[c.length >> 1].toFixed(2), cbP95: +c[Math.floor(c.length * .95)].toFixed(2), n: c.length }); }, 3000);
}), move);
console.log('still', JSON.stringify(await run(false)));
console.log('move ', JSON.stringify(await run(true)));
await browser.close();
