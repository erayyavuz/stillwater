import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860 });
page.on('pageerror', e => console.log('[pageerror]', e.stack));
page.on('framenavigated', f => console.log('[nav]', f.url()));
await page.goto('http://localhost:8765/?tod=2&rain=0.3&cam=0.45,1.12,0.62,0.5,1.02,0.2', { waitUntil: 'networkidle0' });
for (let i = 0; i < 6; i++) { console.log(i, await page.evaluate(() => typeof window.__app + ' ' + document.readyState)); await new Promise(r => setTimeout(r, 700)); }
await page.click('#enterBtn');
console.log('after enter', await page.evaluate(() => typeof window.__app));
await browser.close();
