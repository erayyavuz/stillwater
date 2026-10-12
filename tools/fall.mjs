import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 700 });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await page.goto('http://localhost:8765/?ui=0&tod=3&season=winter&weather=snow', { waitUntil: 'networkidle0' });
await wait(4000);
await page.screenshot({ path: `${out}/f1.png`, clip: { x: 200, y: 100, width: 400, height: 300 } });
await wait(400);
await page.screenshot({ path: `${out}/f2.png`, clip: { x: 200, y: 100, width: 400, height: 300 } });
for (const [q, n] of [['tod=3&season=winter', 'fw'], ['tod=0', 'fs']]) {
  await page.goto('http://localhost:8765/?ui=0&' + q, { waitUntil: 'networkidle0' }); await wait(3500);
  const r = await page.evaluate(() => { const v = __app.view; return [(0.562 - v.x0) / v.w * innerWidth, (0.76 - v.y0) / v.h * innerHeight]; });
  await page.screenshot({ path: `${out}/${n}.png`, clip: { x: r[0] - 200, y: r[1] - 190, width: 400, height: 300 } });
}
await browser.close();
