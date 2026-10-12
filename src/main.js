import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Outside } from './outside/world.js';
import { Room, WIN, SILL_Y, LAYOUT } from './room.js';
import { Drops, Fog, createGlassMaterial } from './glass.js';
import { CandleFlame, Steam } from './cozy.js';
import { Ambience } from './audio.js';
import { Tape } from './music.js';
import { Tea } from './tea.js';
import { initUI } from './ui.js';
THREE.DefaultLoadingManager.onProgress = (url, done, total) => { window.__loadP = done / total; window.dispatchEvent(new CustomEvent('sw-progress', { detail: done / total })); };

const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const Q = mobile
  ? { terrainSeg: 160, trees: 1200, frameTrees: 8, grass: 6000, reeds: 1200, rain: 3000, snow: 2000, smoke: 8, reflScale: 0.14, fireflies: 40, out: 0.45 }
  : { terrainSeg: 200, trees: 2200, frameTrees: 12, grass: 12000, reeds: 2500, rain: 5000, snow: 3500, smoke: 12, reflScale: 0.16, fireflies: 70, out: 0.55 };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

// ---------- persistent state ----------
const store = (() => { try { return JSON.parse(localStorage.getItem('stillwater2') || '{}'); } catch { return {}; } })();
const state = {
  rain: +(params.get('rain') ?? store.rain ?? 0.6),           // intensity of whatever is falling
  weather: params.get('weather') ?? (params.get('season') === 'winter' ? 'snow' : store.weather ?? 'rain'),
  hour: store.hour ?? null,                                      // null = follow the real clock
  lamp: params.get('lamp') ? params.get('lamp') === '1' : (store.lamp ?? true),
  candle: store.candle ?? true,
  open: params.get('open') === '1',
  offset: 0, // hours added to the real clock (time-lapse)
};
const save = () => { try { localStorage.setItem('stillwater2', JSON.stringify({ rain: state.rain, weather: state.weather, hour: state.hour, lamp: state.lamp, candle: state.candle })); } catch { } };
const month = new Date().getMonth();
const winterDefault = params.get('season') ? params.get('season') === 'winter' : (month === 11 || month <= 1);

// ---------- renderer ----------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let dpr = Math.min(devicePixelRatio, mobile ? 1.5 : 1.6);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // the room is mostly still: refresh shadows only when needed

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.2;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 40);
const camHome = new THREE.Vector3(0, 1.43, 1.5), lookHome = new THREE.Vector3(0, 1.37, 0);

const room = new Room(scene);
const outside = new Outside(Q);

// outside -> render target (+ a blurred copy for misted glass)
const outRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2 });
const blurA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
const blurB = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
const kawase = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tIn: { value: null }, uPx: { value: new THREE.Vector2() }, uK: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tIn; uniform vec2 uPx; uniform float uK; varying vec2 vUv;
    void main(){ vec2 o = uPx * (uK + .5);
      vec3 c = texture2D(tIn, vUv + vec2(o.x, o.y)).rgb + texture2D(tIn, vUv + vec2(-o.x, o.y)).rgb
             + texture2D(tIn, vUv + vec2(o.x, -o.y)).rgb + texture2D(tIn, vUv + vec2(-o.x, -o.y)).rgb;
      gl_FragColor = vec4(c * .25, 1.); }`,
}));
function blurOutside() {
  const m = kawase.material;
  let src = outRT, dst = blurA;
  for (let i = 0; i < 4; i++) {
    m.uniforms.tIn.value = src.texture;
    m.uniforms.uPx.value.set(1 / dst.width, 1 / dst.height);
    m.uniforms.uK.value = i;
    renderer.setRenderTarget(dst); kawase.render(renderer);
    src = dst; dst = dst === blurA ? blurB : blurA;
  }
  renderer.setRenderTarget(null);
  return src;
}
const outTex = { sharp: outRT.texture, blur: blurB.texture };

// the outside, as the room's backdrop (seen directly through an open sash)
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tOut: { value: outRT.texture }, tBlur: { value: blurB.texture }, uRes: { value: new THREE.Vector2() }, uDef: { value: 0.3 } },
  vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.99999, 1.); }`,
  fragmentShader: `uniform sampler2D tOut, tBlur; uniform vec2 uRes; uniform float uDef;
    void main(){ vec2 uv = gl_FragCoord.xy / uRes; gl_FragColor = vec4(mix(texture2D(tOut, uv).rgb, texture2D(tBlur, uv).rgb, uDef), 1.); }`,
  depthWrite: false,
}));
backdrop.frustumCulled = false; backdrop.renderOrder = -100;
scene.add(backdrop);

// glass
const drops = new Drops(renderer, mobile ? 1800 : 3200);
const fog = new Fog(renderer);
const glassMats = room.sashes.map(s => {
  const m = createGlassMaterial(drops, fog, outTex);
  const r = s.glass.userData.rect;
  m.uniforms.uRect.value.set(r.x0 - WIN.x0, r.y0 - WIN.y0, r.x1 - WIN.x0, r.y1 - WIN.y0);
  s.glass.material = m;
  s.glass.userData.glass = true;
  return m;
});

// cozy bits
const flame = new CandleFlame(new THREE.Vector3(LAYOUT.candle[0], SILL_Y + 0.209, LAYOUT.candle[1]));
scene.add(flame.group);
flame.attachSmoke(scene);
if (!state.candle) { flame.target = 0; flame.lit = 0; }
const steam = new Steam(new THREE.Vector3(0.2, SILL_Y + 0.07, 0.3), mobile ? 20 : 34);
let teaSys = null;
scene.add(steam.group);

const audio = new Ambience();
const tape = new Tape(audio);

// ---------- post ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.55, 1.35);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 v = vUv - .5;
      vec2 ca = v * dot(v, v) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
      v.x *= uRes.x / uRes.y;
      c *= 1. - smoothstep(0.4, 1.2, length(v)) * 0.5;
      c += (h(vUv * uRes + fract(uTime * 7.3) * 100.) - .5) * 0.018;
      gl_FragColor = vec4(c, 1.);
    }`,
});
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);
composer.addPass(finish);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  const portrait = w / h < 0.85;
  camera.fov = portrait ? 58 : 50;
  // portrait: step back until the whole sill (about 1.1 m) fits across the screen
  const sillD = Math.min(2.6, Math.max(1.4, 0.98 / (2 * Math.tan(THREE.MathUtils.degToRad(58) / 2) * (w / h))));
  // portrait: step in and favour the left pane, the candle and the tea
  camHome.set(0, portrait ? 1.62 : 1.43, portrait ? 0.32 + sillD : 1.5);
  lookHome.set(0, portrait ? 1.36 : 1.37, 0);
  camera.updateProjectionMatrix();
  const W = Math.round(w * Math.min(dpr, 1.25) * Q.out), H = Math.round(h * Math.min(dpr, 1.25) * Q.out);
  outRT.setSize(W, H);
  blurA.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2)); blurB.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2));
  outside.water.resizeReflection && outside.water.resizeReflection(Q);
  const res = new THREE.Vector2(w * dpr, h * dpr);
  for (const m of glassMats) m.uniforms.uRes.value.copy(res);
  backdrop.material.uniforms.uRes.value.copy(res);
  finish.uniforms.uRes.value.copy(res);
  fxaa.material.uniforms.resolution.value.set(1 / res.x, 1 / res.y);
  bloom.resolution.set(w / 2, h / 2);
}
addEventListener('resize', resize);
resize();

// ---------- time of day from the real clock ----------
// light keys: 0 noon, 1 golden, 2 dusk, 3 night
function lightFromHour(h) {
  const k = [[0, 3], [5, 3], [6.3, 2], [7.5, 1], [10, 0], [16, 0], [18.3, 1], [19.6, 2], [21, 3], [24, 3]];
  for (let i = 0; i < k.length - 1; i++) if (h >= k[i][0] && h <= k[i + 1][0]) {
    const f = (h - k[i][0]) / (k[i + 1][0] - k[i][0]);
    return k[i][1] + (k[i + 1][1] - k[i][1]) * f;
  }
  return 3;
}
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

// ---------- interaction ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2(), mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
let hoverRay = null, pointer = null;
const pickables = () => [...room.sashes.map(s => s.glass), room.latch, ...(room.proxies || []), ...(room.deck ? [room.deck.root] : []), ...(teaSys ? [teaSys.cup, teaSys.saucer, teaSys.pot] : [])];
function pick(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables(), true);
  for (const h of hits) {
    let o = h.object, name = null, part = h.object.userData.part;
    while (o) { if (o.userData.glass) { name = 'glass'; break; } if (o === room.latch) { name = 'latch'; break; } if (o.userData.prop) { name = o.userData.prop; break; } o = o.parent; }
    if (!name) continue;
    if (name === 'glass') {
      const s = room.sashes.find(s => s.glass === h.object);
      if (s.open > 0.3) continue; // looking through the open sash
      const r = s.glass.userData.rect;
      return { name, gx: r.x0 - WIN.x0 + h.uv.x * (r.x1 - r.x0), gy: r.y0 - WIN.y0 + h.uv.y * (r.y1 - r.y0), point: h.point };
    }
    return { name, part, point: h.point };
  }
  return null;
}
let focusT = 0, lapse = false;
let sleepEnd = 0, sleepFade = 0, sleepSpan = 480;
let camShake = 0, lampFlick = 0, sipT = 0, tapeBump = 0, plantRustle = 0, breathe = 0, breatheT = 0, boltRoom = 0;
const BRUSH = 0.046;
function onDown(e) {
  ui.firstGesture();
  const p = pick(e.clientX, e.clientY);
  pointer = { x: e.clientX, y: e.clientY, t: performance.now(), hit: p, moved: false, last: p, breath: 0 };
  if (p && p.name === 'clock') { lapse = true; }
  if (p && p.name === 'tape' && p.part === 'vol') { pointer.vol = tape.vol; }
}
function onMove(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  ndc.set(mouse.x, -mouse.y); ray.setFromCamera(ndc, camera); hoverRay = ray.ray.clone();
  const p = pick(e.clientX, e.clientY);
  canvas.style.cursor = !p ? 'default' : p.name === 'glass' ? 'crosshair' : 'pointer';
  ui.hover(p ? p.name : null);
  if (!pointer) return;
  if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 6) pointer.moved = true;
  if (pointer.vol !== undefined) { tape.setVolume(pointer.vol + (pointer.y - e.clientY) * 0.005 + (e.clientX - pointer.x) * 0.003); ui.toast('Volume ' + Math.round(tape.vol * 10)); return; }
  if (pointer.moved && pointer.hit && pointer.hit.name === 'glass' && p && p.name === 'glass' && pointer.last) {
    const a = pointer.last, len = Math.hypot(p.gx - a.gx, p.gy - a.gy);
    const steps = Math.max(1, Math.ceil(len / (BRUSH * 0.3)));
    for (let i = 1; i <= steps; i++) fog.wipe(a.gx + (p.gx - a.gx) * i / steps, a.gy + (p.gy - a.gy) * i / steps, BRUSH, 0.92);
    drops.wipe(a.gx, a.gy, p.gx, p.gy, BRUSH * 0.9);
    const speed = len / Math.max(0.016, (performance.now() - (pointer.lt || pointer.t)) / 1000);
    if (len > 0.004 && Math.random() < 0.5) audio.squeak(Math.min(2, speed * 2), (p.gx / 1.2) * 2 - 1);
    pointer.last = p; pointer.lt = performance.now();
    focusT = 9;
  }
}
function onUp() {
  if (!pointer) return;
  const p = pointer, held = performance.now() - p.t;
  if (lapse && held > 350) ui.toast('Time passed');
  lapse = false;
  if (!p.moved && p.hit && held < 350) {
    const n = p.hit.name;
    if (n === 'glass') { drops.knock(p.hit.gx, p.hit.gy, 1); audio.knock((p.hit.gx / 1.2) * 2 - 1); camShake = 0.004; }
    else if (n === 'candle') { const on = flame.toggle(); state.candle = !!on; on ? audio.match() : audio.blow(); save(); }
    else if (n === 'lamp') { shadowKick = 2; state.lamp = !state.lamp; lampFlick = 0.4; audio.click(0.8); save(); }
    else if ((n === 'cup' || n === 'pot') && teaSys) {
      const r = teaSys.click(n);
      if (r === 'spill') ui.toast('Oops');
      else if (r === 'pour') { audio.clink(); }
      else if (r === 'full') { steam.puff = 1.5; }
    }
    else if (n === 'tape') tapeKey(p.hit.part);
    else if (n === 'latch') { state.open = !state.open; audio.latch(state.open); ui.toast(state.open ? 'Window open' : 'Window closed'); }
    else if (n === 'plant') { plantRustle = 1; audio.breath(); }
    else if (n === 'clock') { if (Math.abs(state.offset) > 0.01) { state.offset = 0; ui.toast('Back to now'); } else audio.tick(); }
  }
  pointer = null;
}
canvas.addEventListener('pointerdown', onDown);
addEventListener('pointermove', onMove);
addEventListener('pointerup', onUp);
addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('.menu')) return;
  const hp = pick(e.clientX, e.clientY);
  if (hp && hp.name === 'tape') { tape.setVolume(tape.vol - e.deltaY * 0.0015); ui.toast('Volume ' + Math.round(tape.vol * 10)); return; }
  if (state.weather === 'clear') return;
  state.rain = THREE.MathUtils.clamp(state.rain - e.deltaY * 0.0008, 0.05, 1);
  ui.sync(); ui.toast(ui.intensityName());
  save();
}, { passive: true });

function tapeKey(part) {
  const d = room.deck;
  if (part === 'vol') { audio.click(1.4); return; }
  if (part === 'ff' || part === 'rew') { d.press(part); audio.tape(false); tape.wind(part === 'ff' ? 1 : -1); return; }
  if (part === 'stop') { d.press('stop'); if (tape.on) { tape.stop(); audio.tape(false); ui.toast('Stopped'); } else audio.click(0.9); return; }
  if (part === 'pause') { d.press('pause'); if (tape.on) { tape.stop(); audio.tape(false); ui.toast('Paused'); } return; }
  if (part === 'rec') { d.press('rec'); audio.click(0.7); ui.toast('No blank tape in there'); return; }
  // play, or the body itself
  if (tape.on && part !== 'play') { tape.stop(); audio.tape(false); d.press('stop'); ui.toast('Stopped'); return; }
  if (!tape.on) { d.press('play', true); audio.tape(true); tape.play(); ui.toast(tape.title()); }
  tapeBump = 1;
}
tape.onSong = (t) => ui.toast(t);
tape.onWait = () => ui.toast('Rewinding…');
const actions = {
  audio, tape,
  setWeather(w) { state.weather = w; save(); },
  setIntensity(v) { state.rain = v; save(); },
  setSleep(min) { sleepEnd = min ? performance.now() + min * 60000 : 0; sleepSpan = Math.min(480, min * 60 * 0.5); sleepFade = 0; },
  sleepLeft: () => sleepEnd ? Math.max(0, (sleepEnd - performance.now()) / 1000) : 0,
  setHour(h) { state.hour = h; state.offset = 0; save(); },
  tapeKey,
  breathe(on) { breathe = on ? 1 : 0; breatheT = 0; },
  getState: () => state,
};
const ui = initUI(actions);

// ---------- loop ----------
const cur = { tod: params.get('tod') ? +params.get('tod') : lightFromHour(state.hour ?? hourNow()), rain: state.weather === 'rain' ? state.rain : 0, snow: state.weather === 'snow' ? state.rain : 0, winter: state.weather === 'snow' ? 1 : 0, open: state.open ? 1 : 0, lamp: state.lamp ? 1 : 0, wet: 0.6 };
let last = performance.now(), time = 0, nextBolt = 20, frameAcc = 0, frameN = 0;
const warm = new THREE.Color(1, 0.6, 0.3), tmpV = new THREE.Vector3(), steamCol = new THREE.Color(), tmpC = new THREE.Color();
const sleepDimEl = document.getElementById('sleepDim');
let ready = false, lastShadow = -9, frameCount = 0, shadowKick = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;

  // time of day: the real clock, plus any time-lapse from holding the clock
  if (lapse) { state.offset += dt * 0.9; if (Math.random() < dt * 8) audio.tick(); }
  const hour = (((state.hour ?? hourNow()) + state.offset) % 24 + 24) % 24;
  const todTarget = params.get('tod') ? +params.get('tod') : lightFromHour(hour);
  cur.tod = approach(cur.tod, todTarget, lapse ? 6 : 1.5, dt);
  // the rain breathes on its own around the chosen intensity
  const amt = THREE.MathUtils.clamp(state.rain + Math.sin(time / 170) * 0.08 + Math.sin(time / 53) * 0.04, 0.03, 1);
  cur.rain = approach(cur.rain, state.weather === 'rain' ? amt : 0, 0.5, dt);
  cur.snow = approach(cur.snow, state.weather === 'snow' ? amt : 0, 0.5, dt);
  // snow settles slowly; a thaw is slower still
  cur.winter = approach(cur.winter, state.weather === 'snow' ? 1 : 0, state.weather === 'snow' ? 0.12 : 0.06, dt);
  const wasOpen = cur.open;
  // closing accelerates into the frame; opening eases out
  if (state.open) cur.open = approach(cur.open, 1, 2.2, dt);
  else cur.open = Math.max(0, cur.open - dt * (0.35 + (1 - cur.open) * 2.2));
  if (wasOpen > 0 && cur.open === 0) audio.shut();
  cur.lamp = approach(cur.lamp, state.lamp ? 1 : 0, 5, dt);
  cur.wet = approach(cur.wet, cur.rain > 0.1 ? 1 : 0, 0.05, dt);
  const winter = cur.winter;
  const rainFall = cur.rain, snowFall = cur.snow;

  // lightning in a downpour
  if (rainFall > 0.78) {
    nextBolt -= dt;
    if (nextBolt <= 0) { outside.flash = 1; boltRoom = 1; audio.thunder(Math.random() * 1.5); nextBolt = 14 + Math.random() * 40; }
  }
  boltRoom = Math.max(0, boltRoom - dt * 3);

  const e = outside.update({ tod: cur.tod, todLight: cur.tod, rain: rainFall, snow: snowFall, winter, wet: cur.wet, ice: winter, time }, dt);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.55, e.night);

  for (const s of room.sashes) { s.open = cur.open; s.pivot.rotation.y = -s.side * cur.open * 1.15; }
  room.lever.rotation.z = Math.min(1, cur.open * 3) * 1.25;

  // camera: tiny head movement, a breath, a knock shake
  mouseS.x = approach(mouseS.x, mouse.x, 1.6, dt); mouseS.y = approach(mouseS.y, mouse.y, 1.6, dt);
  if (breathe) breatheT += dt;
  const bz = breathe ? ss(0, 22, breatheT) : 0;
  camShake = Math.max(0, camShake - dt * 0.03);
  if (Math.abs(mouseS.x - mouse.x) < 1e-4) mouseS.x = mouse.x; if (Math.abs(mouseS.y - mouse.y) < 1e-4) mouseS.y = mouse.y;
  camera.position.set(camHome.x, camHome.y + bz * 0.04, camHome.z - bz * 0.55);
  if (camShake > 1e-4) { camera.position.x += (Math.random() - 0.5) * camShake; camera.position.y += (Math.random() - 0.5) * camShake; }
  camera.lookAt(tmpV.copy(lookHome).add(new THREE.Vector3(0, bz * 0.1, 0)));
  if (params.get('cam')) { const c = params.get('cam').split(',').map(Number); camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); }
  camera.updateMatrixWorld();

  // interior light: daylight through the window, the lamp, the candle
  const sunVis = ss(-0.1, 0.06, e.sunDir.y);
  const dayL = (1 - e.night) * (1 - Math.max(cur.rain, cur.snow * 0.7) * 0.45);
  room.day.color.copy(e.sun).lerp(e.hor, 0.4);
  room.day.intensity = e.sunI * sunVis * 0.9 * (1 - Math.max(cur.rain, cur.snow * 0.8) * 0.6) + dayL * 0.4 + boltRoom * 6;
  room.day.position.set(e.sunDir.x * 3 + 0.4, Math.max(0.6, e.sunDir.y * 3) + 1.4, -3.5);
  room.skyFill.color.copy(e.hor).lerp(e.zen, 0.5);
  room.skyFill.intensity = dayL * 3.2 + 0.08 + boltRoom * 12;
  room.hemi.intensity = 0.06 + dayL * 0.35;
  scene.environmentIntensity = 0.06 + dayL * 0.35;
  lampFlick = Math.max(0, lampFlick - dt);
  const lampF = cur.lamp * (0.97 + 0.03 * Math.sin(time * 9.7) * Math.sin(time * 3.1)) * (lampFlick > 0 ? 0.6 + 0.4 * Math.random() : 1);
  if (room.lampLight) {
    room.lampLight.intensity = lampF * 1.6;
    if (room.lampFlame) room.lampFlame.material.opacity = lampF;
    if (room.chimney) {
      const cu = room.chimney.uniforms;
      cu.uLamp.value = lampF; cu.uFlameY.value = room.lampLight.position.y;
      cu.uSky.value.copy(e.hor).lerp(e.zen, 0.3).multiplyScalar(0.25 + dayL * 0.9).addScalar(0.04);
    }
  }
  let cursorBend = 0;
  if (hoverRay) { hoverRay.closestPointToPoint(flame.group.position, tmpV); const d = tmpV.sub(flame.group.position); const dist = d.length(); if (dist < 0.12) cursorBend = -Math.sign(d.x) * (1 - dist / 0.12) * 0.25; }
  flame.update(dt, time, camera, 0.2 + cur.open * 1.4, cursorBend);
  if (room.candleLight) room.candleLight.intensity = flame.flicker * 0.55;

  steamCol.copy(e.hor).multiplyScalar(dayL * 0.9).add(warm.clone().multiplyScalar((cur.lamp * 0.35 + flame.lit * 0.15) * (0.3 + 0.7 * e.night))).addScalar(0.05);
  steam.update(dt, time, hoverRay, steamCol);

  if (teaSys) {
    teaSys.update(dt, time, {
      sky: tmpC.copy(e.hor).lerp(e.zen, 0.3).multiplyScalar(0.25 + dayL * 0.8),
      warm: (cur.lamp * 0.8 + flame.lit * 0.4) * (0.3 + 0.7 * e.night),
      lamp: room.lampLight.position, candle: flame.group.position, lampK: cur.lamp, candleK: flame.lit * 0.6,
    });
    const upright = teaSys.state === 'full' || teaSys.state === 'pouring' || teaSys.state === 'empty';
    steam.origin.set(teaSys.cupHome.x, teaSys.cupHome.y + 0.012 + teaSys.fill * 0.04, teaSys.cupHome.z);
    steam.heat = (upright ? Math.min(1, teaSys.fill * 1.3) : 0) * (1 - cur.open * 0.4);
  }
  if (room.deck) {
    tapeBump = Math.max(0, tapeBump - dt * 4); room.deck.update(dt, tape, e.night);
    room.deck.root.getWorldPosition(tmpV); tmpV.y += 0.2; tmpV.project(camera);
    ui.placeTape((tmpV.x + 1) / 2 * innerWidth, (1 - tmpV.y) / 2 * innerHeight);
  }
  if (room.props.plant) { plantRustle = Math.max(0, plantRustle - dt * 0.8); room.props.plant.rotation.z = Math.sin(time * 14) * plantRustle * 0.04 + cur.open * Math.sin(time * 2.1) * 0.01; }
  if (room.hands && room.hands[0]) {
    const sec = (hour * 3600) % 60, min = (hour * 60) % 60;
    const ang = window.__handAngles || [hour % 12 / 12, min / 60, sec / 60].map(f => f * Math.PI * 2);
    // hands turn about the dial's normal (the clock's local +z); the model rests at about 5:50:05
    const REST = [150, 300, 30].map(d => d * Math.PI / 180);
    room.hands.forEach((pv, i) => pv.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(ang[i] - REST[i])));
  }

  // glass: drops, mist, focus
  drops.update(dt, (rainFall + snowFall * 0.12) * (1 - cur.open), e.night > 0.5 ? 0.2 : 0.4);
  const fogGrow = cur.open > 0.5 ? 0 : 0.016 + e.night * 0.012 + winter * 0.015;
  if (cur.open > 0.3) fog.wipe(0.6, 0.58, 1.2, dt * 0.8);
  if (pointer && pointer.hit && pointer.hit.name === 'glass' && !pointer.moved && performance.now() - pointer.t > 300) {
    if (!pointer.breath) audio.breath();
    pointer.breath = (pointer.breath || 0) + dt;
    fog.breath(pointer.hit.gx, pointer.hit.gy - 0.01, 0.05 + Math.min(0.07, pointer.breath * 0.06), dt * 2.5);
  }
  fog.update(dt, fogGrow, 0.045, drops.clearStamps);
  focusT = Math.max(0, focusT - dt);
  const defocus = focusT > 0 ? 0.1 : 0.6;
  const night = e.night;
  const glows = glassMats[0].uniforms.uGlow.value;
  [[flame.group.position, flame.lit * 0.1, 0.012], [room.lampLight ? room.lampLight.position : null, cur.lamp * 0.3, 0.035]].forEach(([p, k, sz], i) => {
    if (!p) return;
    tmpV.set(p.x, p.y, -p.z).project(camera);
    glows[i].set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5, sz, k * (0.15 + 0.85 * night));
  });
  for (const m of glassMats) {
    const u = m.uniforms;
    u.uTime.value = time;
    u.uDefocus.value = approach(u.uDefocus.value, defocus, focusT > 0 ? 3 : 0.5, dt);
    u.uFogLevel.value = (0.8 + night * 0.12) * (1 - winter * 0.25);
    u.uWarmAmt.value = (cur.lamp * 0.9 + flame.lit * 0.5) * (0.25 + 0.75 * night);
    u.uSky.value.copy(e.hor).lerp(e.zen, 0.3).multiplyScalar(0.5 + dayL * 0.5).addScalar(boltRoom * 0.5);
    u.uNight.value = night;
    u.uFrost.value = winter * 0.85;
    u.uGlow.value = glows;
  }
  backdrop.material.uniforms.uDef.value = 0.25 * (1 - cur.open * 0.6);

  // render: outside -> blur -> room
  const moving = (cur.open > 0.005 && cur.open < 0.995) || sipT > 0 || plantRustle > 0 || tapeBump > 0;
  const shadowDue = moving || frameCount < 3 || shadowKick > 0;
  shadowKick = Math.max(0, shadowKick - 1);
  if (shadowDue) lastShadow = time;
  frameCount++;
  outside.syncCamera(camera);
  renderer.shadowMap.needsUpdate = false;
  renderer.setRenderTarget(outRT);
  renderer.render(outside.scene, outside.camera);
  renderer.setRenderTarget(null);
  blurOutside();
  finish.uniforms.uTime.value = time;
  renderer.shadowMap.needsUpdate = shadowDue;
  composer.render();

  if (sleepEnd) {
    const left = (sleepEnd - performance.now()) / 1000;
    sleepFade = Math.min(1, Math.max(0, 1 - left / sleepSpan));
    if (left <= 0 && tape.on) tape.stop();
  } else sleepFade = Math.max(0, sleepFade - dt * 0.2);
  if (Math.abs(sleepFade - (audio.sleepK || 0)) > 0.002) audio.setSleep(sleepFade);
  tape.setFade && tape.setFade(sleepFade);
  sleepDimEl.style.opacity = (sleepFade * 0.93).toFixed(3);
  audio.update({ hour, rain: rainFall, snowFall, night, winter, tod: cur.tod, fireBoost: 0, ice: winter, candle: flame.lit, open: cur.open });

  if (!ready) { ready = true; document.body.classList.add('ready'); window.__ready = true; }
  requestAnimationFrame(frame);
}
room.loadProps().then(() => {
  if (!mobile) setTimeout(() => tape.preload(), 4000);
  window.dispatchEvent(new Event('sw-ready'));
  teaSys = new Tea(scene, room.teaScene, audio);
  teaSys.place(LAYOUT.cup[0], LAYOUT.cup[1], LAYOUT.pot[0], LAYOUT.pot[1]);
  // the tea flows around everything standing on the sill
  const L = LAYOUT;
  teaSys.addBlock(L.lamp[0], L.lamp[1], 0.11 * L.lamp[3]); teaSys.addBlock(L.plant[0], L.plant[1], 0.085 * L.plant[3]); teaSys.addBlock(L.candle[0], L.candle[1], 0.05); teaSys.addBlock(L.clock[0], L.clock[1], 0.05);
  teaSys.addBlockRect(L.tape[0], L.tape[1], 0.3, 0.07, L.tape[2]);
  room.props.cup = teaSys.cup; room.props.saucer = teaSys.saucer; room.props.pot = teaSys.pot;
  if (!state.lamp) cur.lamp = 0;
  requestAnimationFrame((t) => { last = t; frame(t); });
});
window.__app = { pick, get tea() { return teaSys; }, state, cur, room, drops, fog, flame, steam, camera, scene, renderer, outside, audio, tape, glassMats, actions };
