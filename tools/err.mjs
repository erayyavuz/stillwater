import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.stack));
await page.goto('http://localhost:8765/?ui=0&' + (process.argv[2] || ''), { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 4000));
await browser.close();
