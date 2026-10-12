// usage: node shot.mjs <url> <out.png> [waitMs] [w] [h] [js-to-eval-before-shot]
import puppeteer from 'puppeteer-core';
const [url, out, wait = '2500', w = '1280', h = '800', js] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, +wait));
if (js) { const r = await page.evaluate(js); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); await new Promise(r => setTimeout(r, 600)); }
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
