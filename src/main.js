import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Outside } from './outside/world.js';
import { Room, WIN, SILL_Y } from './room.js';
import { Drops, Fog, createGlassMaterial } from './glass.js';
import { CandleFlame, Steam } from './cozy.js';
import { Ambience } from './audio.js';
import { Tape } from './music.js';
import { initUI } from './ui.js';

const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const Q = mobile
  ? { terrainSeg: 180, trees: 1400, frameTrees: 8, grass: 9000, reeds: 1800, rain: 4000, snow: 2500, smoke: 8, reflScale: 0.18, fireflies: 40, out: 0.8 }
  : { terrainSeg: 240, trees: 2600, frameTrees: 12, grass: 24000, reeds: 4000, rain: 7000, snow: 4500, smoke: 12, reflScale: 0.22, fireflies: 70, out: 1.0 };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

// ---------- persistent state ----------
const store = (() => { try { return JSON.parse(localStorage.getItem('stillwater2') || '{}'); } catch { return {}; } })();
const state = {
  rain: +(params.get('rain') ?? store.rain ?? 0.6),
  lamp: params.get('lamp') ? params.get('lamp') === '1' : (store.lamp ?? true),
  candle: store.candle ?? true,
  open: params.get('open') === '1',
  offset: 0, // hours added to the real clock (time-lapse)
};
const save = () => { try { localStorage.setItem('stillwater2', JSON.stringify({ rain: state.rain, lamp: state.lamp, candle: state.candle })); } catch { } };
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
const flame = new CandleFlame(new THREE.Vector3(-0.16, SILL_Y + 0.221, 0.24));
scene.add(flame.group);
if (!state.candle) { flame.target = 0; flame.lit = 0; }
const steam = new Steam(new THREE.Vector3(0.17, SILL_Y + 0.07, 0.3), mobile ? 20 : 34);
scene.add(steam.group);

const audio = new Ambience();
const tape = new Tape(audio);

// ---------- post ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: mobile || devicePixelRatio >= 2 ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.9);
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
      c += (h(vUv * uRes + fract(uTime * 7.3) * 100.) - .5) * 0.035;
      gl_FragColor = vec4(c, 1.);
    }`,
});
composer.addPass(finish);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  const portrait = w / h < 0.85;
  camera.fov = portrait ? 60 : 50;
  // portrait: step in and favour the left pane, the candle and the tea
  camHome.set(portrait ? -0.08 : 0, portrait ? 1.48 : 1.43, portrait ? 1.42 : 1.5);
  lookHome.set(portrait ? -0.08 : 0, portrait ? 1.42 : 1.37, 0);
  camera.updateProjectionMatrix();
  const W = Math.round(w * Math.min(dpr, 1.25) * Q.out), H = Math.round(h * Math.min(dpr, 1.25) * Q.out);
  outRT.setSize(W, H);
  blurA.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2)); blurB.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2));
  outside.water.resizeReflection && outside.water.resizeReflection(Q);
  const res = new THREE.Vector2(w * dpr, h * dpr);
  for (const m of glassMats) m.uniforms.uRes.value.copy(res);
  backdrop.material.uniforms.uRes.value.copy(res);
  finish.uniforms.uRes.value.copy(res);
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
const pickables = () => [...room.sashes.map(s => s.glass), room.latch, ...Object.values(room.props)];
function pick(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables(), true);
  for (const h of hits) {
    let o = h.object, name = null;
    while (o) { if (o.userData.glass) { name = 'glass'; break; } if (o === room.latch) { name = 'latch'; break; } if (o.userData.prop) { name = o.userData.prop; break; } o = o.parent; }
    if (!name) continue;
    if (name === 'glass') {
      const s = room.sashes.find(s => s.glass === h.object);
      if (s.open > 0.3) continue; // looking through the open sash
      const r = s.glass.userData.rect;
      return { name, gx: r.x0 - WIN.x0 + h.uv.x * (r.x1 - r.x0), gy: r.y0 - WIN.y0 + h.uv.y * (r.y1 - r.y0), point: h.point };
    }
    return { name, point: h.point };
  }
  return null;
}
let focusT = 0, lapse = false;
let camShake = 0, lampFlick = 0, sipT = 0, tapeBump = 0, plantRustle = 0, breathe = 0, breatheT = 0, boltRoom = 0;
const BRUSH = 0.046;
function onDown(e) {
  ui.firstGesture();
  const p = pick(e.clientX, e.clientY);
  pointer = { x: e.clientX, y: e.clientY, t: performance.now(), hit: p, moved: false, last: p, breath: 0 };
  if (p && p.name === 'clock') { lapse = true; }
}
function onMove(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  ndc.set(mouse.x, -mouse.y); ray.setFromCamera(ndc, camera); hoverRay = ray.ray.clone();
  const p = pick(e.clientX, e.clientY);
  canvas.style.cursor = !p ? 'default' : p.name === 'glass' ? 'crosshair' : 'pointer';
  ui.hover(p ? p.name : null);
  if (!pointer) return;
  if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 6) pointer.moved = true;
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
    else if (n === 'lamp') { state.lamp = !state.lamp; lampFlick = 0.4; audio.click(0.8); save(); }
    else if (n === 'cup') { sipT = 2.2; steam.puff = 1.5; audio.sip(); }
    else if (n === 'tape') { const on = tape.toggle(); audio.tape(on); tapeBump = 1; ui.toast(on ? 'Tape playing' : 'Tape stopped'); }
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
  state.rain = THREE.MathUtils.clamp(state.rain - e.deltaY * 0.0008, 0, 1);
  ui.toast(state.rain < 0.04 ? 'Clearing' : state.rain < 0.35 ? 'Drizzle' : state.rain < 0.75 ? 'Rain' : 'Downpour');
  save();
}, { passive: true });

const actions = {
  audio, tape,
  breathe(on) { breathe = on ? 1 : 0; breatheT = 0; },
  getState: () => state,
};
const ui = initUI(actions);

// ---------- loop ----------
const cur = { tod: params.get('tod') ? +params.get('tod') : lightFromHour(hourNow()), rain: state.rain, winter: winterDefault ? 1 : 0, open: state.open ? 1 : 0, lamp: state.lamp ? 1 : 0, wet: 0.6 };
let last = performance.now(), time = 0, nextBolt = 20, frameAcc = 0, frameN = 0;
const warm = new THREE.Color(1, 0.6, 0.3), tmpV = new THREE.Vector3(), steamCol = new THREE.Color();
let ready = false, lastShadow = -9, frameCount = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;

  // time of day: the real clock, plus any time-lapse from holding the clock
  if (lapse) { state.offset += dt * 0.9; if (Math.random() < dt * 8) audio.tick(); }
  const hour = ((hourNow() + state.offset) % 24 + 24) % 24;
  const todTarget = params.get('tod') ? +params.get('tod') : lightFromHour(hour);
  cur.tod = approach(cur.tod, todTarget, lapse ? 6 : 1.5, dt);
  // the rain breathes on its own around the chosen intensity
  const rainAuto = THREE.MathUtils.clamp(state.rain + Math.sin(time / 170) * 0.12 + Math.sin(time / 53) * 0.06, 0, 1);
  cur.rain = approach(cur.rain, state.rain < 0.04 ? 0 : rainAuto, 0.4, dt);
  cur.open = approach(cur.open, state.open ? 1 : 0, 2.2, dt);
  cur.lamp = approach(cur.lamp, state.lamp ? 1 : 0, 5, dt);
  cur.wet = approach(cur.wet, cur.rain > 0.1 ? 1 : 0, 0.05, dt);
  const winter = cur.winter;
  const rainFall = cur.rain * (1 - winter), snowFall = cur.rain * winter;

  // lightning in a downpour
  if (rainFall > 0.78) {
    nextBolt -= dt;
    if (nextBolt <= 0) { outside.flash = 1; boltRoom = 1; audio.thunder(Math.random() * 1.5); nextBolt = 14 + Math.random() * 40; }
  }
  boltRoom = Math.max(0, boltRoom - dt * 3);

  const e = outside.update({ tod: cur.tod, todLight: cur.tod, rain: rainFall, snow: snowFall, winter, wet: cur.wet, ice: winter, time }, dt);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.55, e.night);

  for (const s of room.sashes) { s.open = cur.open; s.pivot.rotation.y = -s.side * cur.open * 1.15; }
  room.lever.rotation.z = -cur.open * 1.4;

  // camera: tiny head movement, a breath, a knock shake
  mouseS.x = approach(mouseS.x, mouse.x, 1.6, dt); mouseS.y = approach(mouseS.y, mouse.y, 1.6, dt);
  if (breathe) breatheT += dt;
  const bz = breathe ? ss(0, 22, breatheT) : 0;
  camShake = Math.max(0, camShake - dt * 0.03);
  camera.position.set(camHome.x + mouseS.x * 0.07 + Math.sin(time * 0.11) * 0.01, camHome.y - mouseS.y * 0.035 + Math.sin(time * 0.37) * 0.003 + bz * 0.04, camHome.z - bz * 0.55);
  camera.position.x += (Math.random() - 0.5) * camShake; camera.position.y += (Math.random() - 0.5) * camShake;
  camera.lookAt(tmpV.copy(lookHome).add(new THREE.Vector3(mouseS.x * 0.12, -mouseS.y * 0.05 + bz * 0.1, 0)));
  camera.updateMatrixWorld();

  // interior light: daylight through the window, the lamp, the candle
  const sunVis = ss(-0.1, 0.06, e.sunDir.y);
  const dayL = (1 - e.night) * (1 - cur.rain * 0.45);
  room.day.color.copy(e.sun).lerp(e.hor, 0.4);
  room.day.intensity = e.sunI * sunVis * 0.9 * (1 - cur.rain * 0.6) + dayL * 0.4 + boltRoom * 6;
  room.day.position.set(e.sunDir.x * 3 + 0.4, Math.max(0.6, e.sunDir.y * 3) + 1.4, -3.5);
  room.skyFill.color.copy(e.hor).lerp(e.zen, 0.5);
  room.skyFill.intensity = dayL * 2.2 + 0.05 + boltRoom * 8;
  room.hemi.intensity = 0.06 + dayL * 0.35;
  scene.environmentIntensity = 0.06 + dayL * 0.35;
  lampFlick = Math.max(0, lampFlick - dt);
  const lampF = cur.lamp * (0.97 + 0.03 * Math.sin(time * 9.7) * Math.sin(time * 3.1)) * (lampFlick > 0 ? 0.6 + 0.4 * Math.random() : 1);
  if (room.lampLight) {
    room.lampLight.intensity = lampF * 1.6;
    if (room.lampFlame) room.lampFlame.material.opacity = lampF;
    if (room.chimney) room.chimney.emissiveIntensity = lampF * 0.35;
  }
  let cursorBend = 0;
  if (hoverRay) { hoverRay.closestPointToPoint(flame.group.position, tmpV); const d = tmpV.sub(flame.group.position); const dist = d.length(); if (dist < 0.12) cursorBend = -Math.sign(d.x) * (1 - dist / 0.12) * 0.25; }
  flame.update(dt, time, camera, 0.2 + cur.open * 1.4, cursorBend);
  if (room.candleLight) room.candleLight.intensity = flame.flicker * 0.55;

  steamCol.copy(e.hor).multiplyScalar(dayL * 0.9).add(warm.clone().multiplyScalar((cur.lamp * 0.35 + flame.lit * 0.15) * (0.3 + 0.7 * e.night))).addScalar(0.05);
  steam.heat = 1 - cur.open * 0.4;
  steam.update(dt, time, hoverRay, steamCol);

  if (room.props.cup) { sipT = Math.max(0, sipT - dt); const k = sipT > 0 ? Math.sin(Math.min(1, (2.2 - sipT) / 2.2) * Math.PI) : 0; room.props.cup.position.y = SILL_Y + k * 0.03; room.props.cup.rotation.x = -k * 0.15; }
  if (room.props.tape) { tapeBump = Math.max(0, tapeBump - dt * 4); room.props.tape.position.y = SILL_Y - tapeBump * 0.003; }
  if (room.props.plant) { plantRustle = Math.max(0, plantRustle - dt * 0.8); room.props.plant.rotation.z = Math.sin(time * 14) * plantRustle * 0.04 + cur.open * Math.sin(time * 2.1) * 0.01; }
  if (room.hands && room.hands[0]) {
    const sec = (hour * 3600) % 60, min = (hour * 60) % 60;
    const ang = window.__handAngles || [hour % 12 / 12, min / 60, sec / 60].map(f => f * Math.PI * 2);
    // hands turn about the dial's normal (the clock's local +z); the model rests at about 5:50:05
    const REST = [150, 300, 30].map(d => d * Math.PI / 180);
    room.hands.forEach((pv, i) => pv.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(ang[i] - REST[i])));
  }

  // glass: drops, mist, focus
  drops.update(dt, rainFall * (1 - cur.open), e.night > 0.5 ? 0.2 : 0.4);
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
  [[flame.group.position, flame.lit * 0.22, 0.02], [room.lampLight ? room.lampLight.position : null, cur.lamp * 0.3, 0.035]].forEach(([p, k, sz], i) => {
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
  const shadowDue = moving || time - lastShadow > 1 || frameCount < 3;
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

  audio.update({ rain: rainFall, snowFall, night, winter, tod: cur.tod, fireBoost: 0, ice: winter, candle: flame.lit, open: cur.open });

  frameAcc += dt; frameN++;
  if (frameAcc > 4) {
    if (frameAcc / frameN > 0.028 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); resize(); }
    frameAcc = 0; frameN = 0;
  }
  if (!ready) { ready = true; document.body.classList.add('ready'); window.__ready = true; }
  requestAnimationFrame(frame);
}
room.loadProps().then(() => {
  if (!state.lamp) cur.lamp = 0;
  requestAnimationFrame((t) => { last = t; frame(t); });
});
window.__app = { state, cur, room, drops, fog, flame, steam, camera, scene, renderer, outside, audio, tape, glassMats, actions };
