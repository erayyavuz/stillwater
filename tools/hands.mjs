import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860 });
await page.goto('http://localhost:8765/?ui=0&tod=0&rain=0', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 5000));
for (const [n, a] of [['t300', [Math.PI / 2, 0, 0]], ['t1045', [10.75 / 12 * 2 * Math.PI, 0.75 * 2 * Math.PI, 0.5 * 2 * Math.PI]]]) {
  await page.evaluate((a) => { window.__handAngles = a; __app.camera.position.set(0.74, 1.05, 0.55); }, a);
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: `${out}/h_${n}.png`, clip: { x: 1195, y: 610, width: 130, height: 150 } });
}
await browser.close();
