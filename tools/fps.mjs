import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: +(process.argv[3] || 1440), height: +(process.argv[4] || 860), deviceScaleFactor: +(process.argv[5] || 2) });
await page.goto('http://localhost:8765/?ui=0&' + (process.argv[2] || 'tod=1&rain=0.7'), { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 6000));
const r = await page.evaluate(() => new Promise(res => { let n = 0, last = performance.now(), worst = 0; const ts = []; const t0 = last; const f = () => { const now = performance.now(); ts.push(now - last); worst = Math.max(worst, now - last); last = now; n++; if (now - t0 < 5000) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ fps: n / 5, p95: +ts[Math.floor(ts.length * 0.95)].toFixed(1), worst: +worst.toFixed(1), dpr: __app.renderer.getPixelRatio() }); } }; requestAnimationFrame(f); }));
console.log(JSON.stringify(r));
await browser.close();
