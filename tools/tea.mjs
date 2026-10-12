import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860 });
const logs = [];
page.on('pageerror', e => logs.push(`[pageerror] ${e.stack}`));
page.on('console', m => { if (m.type() === 'error') logs.push('[err] ' + m.text()); });
const q = process.argv[3] || 'tod=2.2&rain=0.3&cam=0.12,1.2,0.85,0.18,0.97,0.3';
await page.goto('http://localhost:8765/?' + q, { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(2500); await page.click('#enterBtn'); await wait(1500);
const at = (name) => page.evaluate((name) => { const v = new __app.camera.position.constructor(); __app.tea[name].getWorldPosition(v); v.y += (name === "cup" && __app.tea.state === "tipped") ? 0.02 : 0.04; v.project(__app.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, name);
const st = () => page.evaluate(() => { const T = __app.tea; let vol = 0, wet = 0; for (let k = 0; k < T.h.length; k++) { vol += T.h[k]; if (T.h[k] > 0.0005) wet++; } return { state: T.state, fill: +T.fill.toFixed(2), parts: T.parts.length, puddleMl: +(vol * 0.0065 * 0.0065 * 1e6).toFixed(1), wetCells: wet, hang: T.hang.size }; });
await page.mouse.click(...await at('cup'));
for (const [ms, n] of [[300, 'a'], [500, 'b'], [1200, 'c'], [3000, 'd'], [8000, 'e']]) { await wait(ms); await page.screenshot({ path: `${out}/tea_${n}.png` }); logs.push(n + ' ' + JSON.stringify(await st())); }
// second click: righting + auto pour
await page.mouse.click(...await at('cup'));
await wait(2600); await page.screenshot({ path: `${out}/tea_f.png` }); logs.push('f ' + JSON.stringify(await st()));
await wait(3500); logs.push('g ' + JSON.stringify(await st()));
// spill again
await page.mouse.click(...await at('cup')); await wait(4000);
await page.screenshot({ path: `${out}/tea_h.png` }); logs.push('h ' + JSON.stringify(await st()));
console.log(logs.join('\n'));
await browser.close();
