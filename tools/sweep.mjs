import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860, deviceScaleFactor: 2 });
await page.goto('http://localhost:8765/?ui=0&tod=3&rain=0.6', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(5000);
const measure = async (move, y = 640) => {
  await page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = () => { const n = performance.now(); __ft.push(n - l); l = n; if (__ft.length < 300) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  for (let i = 0; i < 120; i++) { if (move) await page.mouse.move(200 + i * 9, y + Math.sin(i * 0.2) * 40); await wait(16); }
  return page.evaluate(() => { const a = __ft.slice(5).sort((x, y) => x - y); return { p50: +a[a.length >> 1].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1) }; });
};
console.log('still', JSON.stringify(await measure(false)));
console.log('move sill', JSON.stringify(await measure(true, 640)));
console.log('move sky', JSON.stringify(await measure(true, 200)));
// synthetic events inside the page (no CDP round trips)
console.log('dispatch sill', JSON.stringify(await page.evaluate(() => new Promise(res => { const ft = []; let l = performance.now(), i = 0; const f = () => { const n = performance.now(); ft.push(n - l); l = n; dispatchEvent(new PointerEvent('pointermove', { clientX: 200 + (i++ % 120) * 9, clientY: 640 })); if (ft.length < 200) requestAnimationFrame(f); else { const a = ft.slice(5).sort((x, y) => x - y); res({ p50: +a[a.length >> 1].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1) }); } }; requestAnimationFrame(f); }))));
await browser.close();
