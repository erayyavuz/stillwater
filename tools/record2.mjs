// A 60 s demo with the UI and a visible cursor: CDP screencast for the picture (DOM included),
// an in-page MediaRecorder for the sound, muxed by timestamp.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
const dir = process.argv[2]; fs.mkdirSync(dir + '/frames', { recursive: true });
const LEN = 60;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1080'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));
// fresh preferences, quiet tape
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('stillwater-audio', JSON.stringify({ tape: 0.42 })); } catch { }
  // a visible cursor and a ring on every click
  addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = `#fakeCursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
      .clickRing{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2.5px solid rgba(255,236,200,.95);z-index:99998;pointer-events:none;animation:cr .55s ease-out forwards}
      @keyframes cr{from{transform:scale(.3);opacity:1}to{transform:scale(1.25);opacity:0}}
      *{cursor:none!important}`;
    document.head.append(st);
    const c = document.createElement('div'); c.id = 'fakeCursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5l15 11.2-6.6 1 3.9 7.3-2.7 1.4-3.9-7.4L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    addEventListener('pointermove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('pointerdown', e => { const r = document.createElement('div'); r.className = 'clickRing'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.append(r); setTimeout(() => r.remove(), 600); }, true);
  });
});
await page.goto('http://localhost:8765/?rain=0.7&weather=rain', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await page.waitForFunction(() => document.getElementById('enter').classList.contains('loaded'));
await page.evaluate(() => { __app.actions.setHour(22.6); __app.tape.preload(); });
await page.waitForFunction(() => __app.tape.buffers[0], { timeout: 120000 });
await wait(1500);

// --- recording -----------------------------------------------------------------
let cur = [960, 900];
await page.mouse.move(...cur);
const cdp = await page.createCDPSession();
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  const n = frames.length; const file = `${dir}/frames/f${String(n).padStart(5, '0')}.jpg`;
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => { });
});
// sound starts with the first click (the real gesture), so record the master from now on
await page.evaluate(() => {
  const a = __app.audio; if (!a.ctx) a.start(); a.stop(); // build the graph, stay silent until "Take a seat"
  const dest = a.ctx.createMediaStreamDestination(); a.master.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192e3 });
  window.__ac = []; rec.ondataavailable = e => e.data.size && __ac.push(e.data);
  rec.onstop = async () => { const b = new Uint8Array(await new Blob(__ac).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); window.__a64 = btoa(s); };
  a.ctx.resume(); rec.start(500); window.__arec = rec; window.__aStart = Date.now() / 1000;
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
const at = async (s) => { const d = s * 1000 - (Date.now() - t0); if (d > 0) await wait(d); };
const glide = async (x, y, ms = 700) => { const [x0, y0] = cur; const n = Math.max(6, Math.round(ms / 16)); for (let i = 1; i <= n; i++) { const k = i / n, e = k * k * (3 - 2 * k); await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await wait(ms / n); } cur = [x, y]; };
const click = async (x, y, ms = 650) => { await glide(x, y, ms); await wait(120); await page.mouse.down(); await wait(70); await page.mouse.up(); };
const world = (x, y, z) => page.evaluate((x, y, z) => { const v = new __app.camera.position.constructor(x, y, z).project(__app.camera); return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)]; }, x, y, z);
const objAt = (expr, dy = 0) => page.evaluate((expr, dy) => { const o = eval(expr); const v = new __app.camera.position.constructor(); o.getWorldPosition(v); v.y += dy; v.project(__app.camera); return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)]; }, expr, dy);
const el = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

// 0–5 s: in, then the candle out and back
await at(0.6); await click(...await el('#enterBtn'), 900);
await at(2.4); { const p = await objAt('__app.room.proxies[0]', 0.06); await click(...p, 800); }
await at(4.2); { const p = await objAt('__app.room.proxies[0]', 0.06); await click(p[0] + 2, p[1], 300); }
// 6 s: wipe the glass
await at(5.6);
{ const pts = []; for (let i = 0; i <= 26; i++) { const t = i / 26; pts.push(await world(-0.5 + t * 0.42, 1.8 - t * 0.3 + Math.sin(t * 7) * 0.04, 0)); }
  await glide(...pts[0], 500); await page.mouse.down();
  for (const p of pts) { await page.mouse.move(...p, { steps: 4 }); await wait(75); }
  await page.mouse.up(); cur = pts[pts.length - 1]; }
// 10 s: the tape — hover it, press play, ease the volume down a little
await at(9.4); { const p = await objAt('__app.room.deck.root', 0.08); await glide(...p, 800); }
await wait(500); await click(...await el('#tapePanel [data-key="toggle"]'), 600);
await at(13.2); { const p = await el('#tapeVol'); const b = await (await page.$('#tapeVol')).boundingBox(); await glide(b.x + b.width * 0.42, p[1], 500); await page.mouse.down(); await glide(b.x + b.width * 0.3, p[1], 600); await page.mouse.up(); }
// 15 s: storm — lightning, then rain up to a downpour
await at(15); await page.evaluate(() => __bolt(0.2));
await at(15.6); { const b = await (await page.$('#intensity')).boundingBox(); const y = b.y + b.height / 2; const v = await page.evaluate(() => +document.getElementById('intensity').value); await glide(b.x + 9 + (b.width - 18) * (v - 0.05) / 0.95, y, 700); await page.mouse.down(); await glide(b.x + b.width - 4, y, 900); await page.mouse.up(); }
// 20–26 s: the light: golden hour, then dusk
await at(19.8); await click(...await el('[data-pop="time"]'), 700);
await at(21.2); await click(...await el('[data-hour="18"]'), 600);
await at(23.2); await click(...await el('[data-hour="20.2"]'), 500);
await at(24.8); await click(...await el('[data-hour="23"]'), 500);
await at(26.0); await click(...await el('[data-pop="time"]'), 400);
// 27 s: knock on the glass
await at(27); { const p = await world(0.28, 1.7, 0); await click(...p, 800); }
await at(29); await page.evaluate(() => __bolt(0.05));
// 31 s: open the window to the storm
await at(30.4); { const p = await objAt('__app.room.latch.children[0]', -0.03); await click(...p, 900); }
await at(37.5); await page.evaluate(() => __bolt(0.4));
await at(40.5); { const p = await objAt('__app.room.latch.children[0]', -0.03); await click(...p, 800); }
// 44 s: the tea goes over… then set right and refilled
await at(43.6); { const p = await objAt('__app.tea.cup', 0.035); await click(...p, 900); }
await at(48.6); { const p = await objAt('__app.tea.cup', 0.02); await click(...p, 700); }
// 55 s: the lamp off and on, a last flash
await at(54.4); { const p = await objAt('__app.room.proxies[1]', 0.05); await click(...p, 900); }
await at(56.4); { const p = await objAt('__app.room.proxies[1]', 0.05); await click(...p, 300); }
await at(57.4); await page.evaluate(() => __bolt(0.1));
await at(58.5); await glide(1500, 980, 1000);
await at(LEN + 0.3);
await cdp.send('Page.stopScreencast');
await page.evaluate(() => __arec.stop());
await page.waitForFunction(() => window.__a64, { timeout: 60000 });
fs.writeFileSync(`${dir}/audio.webm`, Buffer.from(await page.evaluate(() => __a64), 'base64'));
const aStart = await page.evaluate(() => __aStart);
// concat list with real frame durations
const T0 = frames[0].t;
let list = 'ffconcat version 1.0\n';
for (let i = 0; i < frames.length; i++) {
  const d = i < frames.length - 1 ? frames[i + 1].t - frames[i].t : 1 / 30;
  list += `file '${path.basename(frames[i].file)}'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
}
fs.writeFileSync(`${dir}/frames/list.txt`, list);
fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ T0, aStart, n: frames.length, span: frames[frames.length - 1].t - T0 }));
console.log('frames', frames.length, 'span', (frames[frames.length - 1].t - T0).toFixed(1), 'audio offset', (aStart - T0).toFixed(3));
await browser.close();
