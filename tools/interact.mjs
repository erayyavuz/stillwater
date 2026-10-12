// Drive the real interactions headless and capture frames + console errors.
import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:8765/?tod=1.6', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(4000);
// 1. click on water -> ripple + sound starts
await page.mouse.click(560, 470);
await wait(600); await page.mouse.click(900, 430);
await wait(900);
await page.screenshot({ path: `${out}/i1_ripple.png` });
logs.push('[info] audio on=' + await page.evaluate(() => __app.audio.on + ' state=' + __app.audio.ctx?.state));
// 2. click fire
const fireXY = await page.evaluate(() => { const v = __app.view; return [(0.562 - v.x0) / v.w * innerWidth, (0.765 - v.y0) / v.h * innerHeight]; });
await page.mouse.click(fireXY[0], fireXY[1]);
await wait(350);
await page.screenshot({ path: `${out}/i2_sparks.png` });
// 3. skip a stone
await page.click('#skipBtn');
await wait(2200);
await page.screenshot({ path: `${out}/i3_skip.png` });
// 4. winter + skip on ice
await page.click('[data-season="winter"]');
await wait(9000);
await page.click('#skipBtn');
await wait(1600);
await page.screenshot({ path: `${out}/i4_iceskip.png` });
// 5. breathe
await page.click('#breatheBtn');
await wait(4500);
await page.screenshot({ path: `${out}/i5_breathe.png` });
await page.keyboard.press('Escape');
await wait(1200);
// 6. mixer
await page.click('#mixBtn'); await wait(400);
await page.screenshot({ path: `${out}/i6_mixer.png` });
logs.push('[info] state=' + JSON.stringify(await page.evaluate(() => __app.state)));
console.log(logs.join('\n'));
await browser.close();
