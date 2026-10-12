import puppeteer from 'puppeteer-core';
const out = process.argv[2], q = process.argv[3] || 'tod=1.6&rain=0.7';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860 });
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:8765/?' + q, { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(3000);
await page.click('#enterBtn');
await wait(9000);
// screen position of a world point
const at = (x, y, z) => page.evaluate((x, y, z) => { const v = new __app.camera.position.constructor(x, y, z).project(__app.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, x, y, z);
// 1. wipe a big S across the left pane
const pts = [];
for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(await at(-0.45 + t * 0.32, 1.85 - t * 0.55 + Math.sin(t * 6) * 0.05, 0.0)); }
await page.mouse.move(...pts[0]); await page.mouse.down();
for (const p of pts) { await page.mouse.move(p[0], p[1], { steps: 2 }); await wait(16); }
await page.mouse.up();
await wait(700);
await page.screenshot({ path: `${out}/x1_wipe.png` });
// 2. breathe on the right pane then write a line through it
const b = await at(0.3, 1.55, 0);
await page.mouse.move(...b); await page.mouse.down(); await wait(2200);
for (let i = 0; i <= 20; i++) { await page.mouse.move(b[0] - 60 + i * 6, b[1] + Math.sin(i * 0.6) * 18, { steps: 2 }); await wait(16); }
await page.mouse.up();
await wait(500);
await page.screenshot({ path: `${out}/x2_breath.png` });
// 3. knock, blow out candle, lamp off, sip, tape
const k = await at(0.15, 1.9, 0); await page.mouse.click(...k); await wait(1200);
await page.screenshot({ path: `${out}/x3_knock.png` });
await page.mouse.click(...(await at(-0.16, 0.95 + 0.17, 0.24))); await wait(300);
await page.mouse.click(...(await at(-0.74, 0.95 + 0.2, 0.28))); await wait(1600);
await page.screenshot({ path: `${out}/x4_dark.png` });
await page.mouse.click(...(await at(0.17, 0.95 + 0.04, 0.3))); await wait(900);
await page.mouse.click(...(await at(0.47, 0.95 + 0.05, 0.17))); await wait(800);
logs.push('[info] tape=' + await page.evaluate(() => __app.tape.on) + ' candle=' + await page.evaluate(() => __app.state.candle) + ' lamp=' + await page.evaluate(() => __app.state.lamp));
// 4. latch
await page.mouse.click(...(await at(0.03, 1.47, 0.04))); await wait(2500);
await page.screenshot({ path: `${out}/x5_open.png` });
logs.push('[info] open=' + await page.evaluate(() => __app.state.open));
// 5. hold the clock
const c = await at(0.74, 0.95 + 0.07, 0.25);
await page.mouse.move(...c); await page.mouse.down(); await wait(3000); await page.mouse.up();
logs.push('[info] offset=' + await page.evaluate(() => __app.state.offset.toFixed(2)));
await page.screenshot({ path: `${out}/x6_lapse.png` });
console.log(logs.join('\n'));
await browser.close();
