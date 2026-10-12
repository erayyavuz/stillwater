import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860 });
const logs = [];
page.on('pageerror', e => logs.push('[pageerror] ' + e.stack));
page.on('console', m => { if (m.type() === 'error') logs.push('[err] ' + m.text()); });
await page.goto('http://localhost:8765/?tod=3', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(2500);
await page.screenshot({ path: `${out}/s0.png` });
await page.click('#enterBtn'); await wait(1500);
logs.push('voices ' + await page.evaluate(() => { const a = __app.audio, t = a.ctx.currentTime + 0.1; a._wolf(t, 1, 0); a._wolf(t + 2, 0.5, 0.5, 1.1); a._frog(t); a._owl(t); a._bird(t, 0); a._bird(t, 1); a._bird(t, 2); a._bird(t, 3); a.latch(true); a.shut(); return 'ok'; }));
await page.click('[data-pop="more"]'); await wait(300);
await page.screenshot({ path: `${out}/s1.png` });
await page.evaluate(() => __app.actions.setSleep(0.12)); // ~7 s
await wait(4000); logs.push('mid ' + await page.evaluate(() => [document.getElementById('sleepDim').style.opacity, __app.audio.sleepK?.toFixed(2)]));
await wait(5000); logs.push('end ' + await page.evaluate(() => [document.getElementById('sleepDim').style.opacity, __app.audio.sleepK?.toFixed(2)]));
await page.screenshot({ path: `${out}/s2.png` });
// a caption over a bright area
await page.evaluate(() => __app.actions.setSleep(0)); await wait(6000);
const p = await page.evaluate(() => { const v = new __app.camera.position.constructor(); __app.tea.pot.getWorldPosition(v); v.y += 0.06; v.project(__app.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
await page.mouse.move(...p); await wait(600);
await page.screenshot({ path: `${out}/s3.png` });
console.log(logs.join('\n'));
await browser.close();
