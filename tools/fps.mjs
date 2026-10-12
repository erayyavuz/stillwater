import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: +(process.argv[3] || 1440), height: +(process.argv[4] || 860), deviceScaleFactor: +(process.argv[5] || 2) });
await page.goto('http://localhost:8765/?ui=0&' + (process.argv[2] || 'tod=1&rain=0.7'), { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 6000));
const r = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res({ fps: n / 4, drops: __app.drops.list.length, dpr: __app.renderer.getPixelRatio() }); }; requestAnimationFrame(f); }));
console.log(JSON.stringify(r));
await browser.close();
