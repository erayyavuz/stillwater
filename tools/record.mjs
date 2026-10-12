// Records a 1-minute, 1920x1080 clip of the scene with its audio, straight from the page
// (canvas.captureStream + the WebAudio master), then writes a webm next to the given path.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const out = process.argv[2];
const LEN = +(process.argv[3] || 60);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8765/?ui=0&tod=2.75&rain=0.75', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// sound on, songs rendered
await page.evaluate(() => { __app.audio.start(); __app.tape.preload(); });
await page.waitForFunction(() => __app.tape.buffers[0] && __app.tape.buffers[1], { timeout: 120000 });
await wait(3000);

// start recording
await page.evaluate((LEN) => {
  const a = __app.audio, ctx = a.ctx;
  const dest = ctx.createMediaStreamDestination();
  a.master.connect(dest);
  const v = document.getElementById('stage').captureStream(30);
  const stream = new MediaStream([...v.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 14e6, audioBitsPerSecond: 192e3 });
  window.__chunks = [];
  rec.ondataavailable = (e) => e.data.size && __chunks.push(e.data);
  rec.onstop = async () => { const b = new Blob(__chunks, { type: 'video/webm' }); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); window.__b64 = btoa(s); };
  rec.start(1000);
  window.__rec = rec;
}, LEN);
const t0 = Date.now();
const at = async (sec) => { const d = sec * 1000 - (Date.now() - t0); if (d > 0) await wait(d); };
const screen = (x, y, z) => page.evaluate((x, y, z) => { const v = new __app.camera.position.constructor(x, y, z).project(__app.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, x, y, z);
const drag = async (pts, ms = 1800) => {
  await page.mouse.move(...pts[0]); await page.mouse.down();
  for (const p of pts) { await page.mouse.move(p[0], p[1], { steps: 3 }); await wait(ms / pts.length); }
  await page.mouse.up(); await page.mouse.move(5, 5);
};

// --- the script --------------------------------------------------------------
await at(4);   // wipe a clear stripe across the left pane
{ const pts = []; for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push(await screen(-0.5 + t * 0.42, 1.78 - t * 0.28 + Math.sin(t * 7) * 0.04, 0)); } await drag(pts, 2200); }
await at(9);   // the tape
await page.evaluate(() => { __app.actions.tapeKey('play'); });
await at(15);  await page.evaluate(() => __bolt(0.2));
await at(21);  await page.evaluate(() => { __app.state.rain = 1; });
await at(26);  // knock on the right pane, drops run
{ const p = await screen(0.28, 1.72, 0); await page.mouse.click(...p); await page.mouse.move(5, 5); }
await at(29);  await page.evaluate(() => __bolt(0.05));
await at(33);  // open the window to the storm
await page.evaluate(() => { __app.state.open = true; __app.audio.latch(true); });
await at(39);  await page.evaluate(() => __bolt(0.4));
await at(44);  await page.evaluate(() => { __app.state.open = false; __app.audio.latch(false); });
await at(49);  // knock the tea over
await page.evaluate(() => __app.tea.click('cup'));
await at(55);  await page.evaluate(() => __bolt(0.15));
await at(LEN);
await page.evaluate(() => __rec.stop());
await page.waitForFunction(() => window.__b64, { timeout: 120000 });
const b64 = await page.evaluate(() => __b64);
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log('wrote', out, fs.statSync(out).size);
await browser.close();
