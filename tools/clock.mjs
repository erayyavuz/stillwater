import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 400 });
await page.goto('http://localhost:8765/?ui=0&tod=0&rain=0', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 6000));
for (const [i, ry] of [0, Math.PI].entries()) {
  await page.evaluate((ry) => { __app.camera.fov = 50;  const c = __app.room.props.clock; c.rotation.y = ry; const t = __app.room.props.tape; t.rotation.y = ry; }, ry);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `${out}/clk${i}.png`, clip: { x: 470, y: 270, width: 130, height: 110 } });
}
await browser.close();
