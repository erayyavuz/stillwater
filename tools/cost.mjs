import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860, deviceScaleFactor: 2 });
await page.goto('http://localhost:8765/?ui=0&tod=2&rain=0.7', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 6000));
// GPU time per pass using a finish() sync
const r = await page.evaluate(() => {
  const A = __app, R = A.renderer, gl = R.getContext();
  const time = (fn, n = 20) => { gl.finish(); const t = performance.now(); for (let i = 0; i < n; i++) { fn(); gl.finish(); } return +((performance.now() - t) / n).toFixed(2); };
  const o = A.outside;
  const rt = new (R.getRenderTarget()?.constructor || Object)();
  const out = {};
  const room = () => { R.setRenderTarget(null); R.render(A.scene, A.camera); };
  out.base = time(room, 6);
  const tests = {
    glass: A.room.sashes.map(s => s.glass),
    deck: [A.room.deck.root], tea: [A.tea.cup, A.tea.saucer, A.tea.pot, A.tea.puddle, A.tea.dropMesh, A.tea.surf],
    lampModel: [A.room.props.lamp], candleModel: [A.room.props.candle], plant: [A.room.props.plant], clock: [A.room.props.clock],
    roomGroup: [A.room.group],
  };
  for (const [k, objs] of Object.entries(tests)) { objs.forEach(o => o.visible = false); out[k] = time(room, 6); objs.forEach(o => o.visible = true); }
  const L = [A.room.skyFill, A.room.lampLight, A.room.candleLight, A.room.day];
  L.forEach(l => l.visible = false); out.noLights = time(room, 6); L.forEach(l => l.visible = true);
  A.room.skyFill.visible = false; out.noRectLight = time(room, 6); A.room.skyFill.visible = true;
  out.shadowsOff = (() => { R.shadowMap.enabled = false; A.scene.traverse(o => { if (o.material) { [].concat(o.material).forEach(m => m.needsUpdate = true); } }); const v = time(room, 6); R.shadowMap.enabled = true; return v; })();
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
