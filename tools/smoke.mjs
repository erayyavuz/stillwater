import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1000 });
page.on('pageerror', e => console.log('[pageerror]', e.stack));
await page.goto('http://localhost:8765/?ui=0&tod=3&rain=0.2&cam=-0.27,1.33,0.72,-0.27,1.36,0.25', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(4000);
await page.evaluate(() => __app.flame.toggle());
for (const [ms, n] of [[900, 1], [1200, 2], [1500, 3], [2500, 4]]) { await wait(ms); await page.screenshot({ path: `${out}/sm${n}.png` }); }
await browser.close();
