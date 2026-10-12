import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLATE_ASPECT as A, HORIZON, SUMMER, WINTER, WEATHER, PlateLibrary, createPlateMaterial, toGround } from './plate.js';
import { Fire, createRain, createSnow, createFireflies, Birds, Stone } from './overlay.js';
import { PLATE_COLORS } from './platecolors.js';
import { Ambience } from './audio.js';
import { initUI } from './ui.js';

export const LIGHT_NAMES = ['Noon', 'Golden', 'Dusk', 'Night'];
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;

// ---------- state ----------
const store = (() => { try { return JSON.parse(localStorage.getItem('stillwater') || '{}'); } catch { return {}; } })();
const state = {
  tod: +(params.get('tod') ?? store.tod ?? 1),
  season: params.get('season') ?? store.season ?? 'summer',
  weather: params.get('weather') ?? store.weather ?? 'clear',
};
const W0 = state.season === 'winter' ? 1 : 0;
const cur = { tod: state.tod, season: W0, rain: state.weather === 'rain' ? 1 : 0, snow: state.weather === 'snow' ? 1 : 0, ice: W0 };
const save = () => { try { localStorage.setItem('stillwater', JSON.stringify(state)); } catch { } };

// ---------- renderer ----------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let dpr = Math.min(devicePixelRatio, mobile ? 1.5 : 2);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, A, 0, -1, -10, 10);
camera.position.z = 5;

const U = {
  time: { value: 0 }, wind: { value: 0.3 }, px: { value: dpr },
  view: { value: new THREE.Vector4(0, 0, A, 1) },
  cursorO: { value: new THREE.Vector2(-9, -9) }, cursorOn: { value: 0 },
  gustO: { value: new THREE.Vector4(0, 0, -100, 0) },
};

const lib = new PlateLibrary(mobile);
const plateMat = createPlateMaterial(lib);
const plate = new THREE.Mesh(new THREE.PlaneGeometry(A, 1), plateMat);
plate.position.set(A / 2, -0.5, -1);
plate.renderOrder = -10;
scene.add(plate);
const P = plateMat.uniforms;

const fire = new Fire(scene, U);
const rain = createRain(mobile ? 700 : 1600, U); rain.renderOrder = 5; scene.add(rain);
const snow = createSnow(mobile ? 450 : 900, U); snow.renderOrder = 5; scene.add(snow);
const flies = createFireflies(40, U); flies.renderOrder = 3; scene.add(flies);
const birds = new Birds(scene);
const audio = new Ambience();
const pan = (x) => THREE.MathUtils.clamp((x - 0.5) * 2, -0.9, 0.9);
let rippleN = 0;
const ripple = (X, Z, s) => { rippleN = (rippleN + 1) % plateMat.ripples.length; plateMat.ripples[rippleN].set(X, Z, U.time.value, s); };
const gx = (X, Z) => 0.5 + X / (A * Z);
const stone = new Stone(scene, {
  splash: (X, Z, s, sink) => { ripple(X, Z, s); audio.plop(s * (sink ? 0.9 : 0.6) / (1 + Z), pan(gx(X, Z))); },
  ice: (X, Z, s) => audio.iceSkip((0.3 + s * 0.7) / (1 + Z * 0.5), pan(gx(X, Z))),
  slide: (X, Z, v) => audio.scrape(Math.min(4, v * 8), pan(gx(X, Z))),
});

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.78);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: U.time, uRes: { value: new THREE.Vector2() }, uGrain: { value: 0.045 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = c * (1.02 - 0.06 * c) + 0.008;
      vec2 v = vUv - .5; v.x *= uRes.x / uRes.y;
      c *= 1. - smoothstep(0.45, 1.25, length(v)) * 0.42;
      float g = h(vUv * uRes + fract(uTime * 7.3) * 100.) - .5;
      c += g * uGrain * (0.6 + 0.4 * (1. - dot(c, vec3(.33))));
      gl_FragColor = vec4(c, 1.);
    }`,
});
composer.addPass(finish);

// ---------- view window (cover fit + overscan + breathing zoom) ----------
const view = { x0: 0, y0: 0, w: 1, h: 1 };
let breathe = 0, breatheT = 0, zoomS = 1;
function updateView() {
  const s = innerWidth / innerHeight;
  let w, h;
  if (s > A) { w = 1; h = A / s; } else { h = 1; w = s / A; }
  const ov = 1.035 * zoomS;
  w /= ov; h /= ov;
  const portrait = s < 0.9;
  const fx = portrait ? 0.6 : 0.5, fy = portrait ? 0.6 : 0.52;
  view.w = w; view.h = h;
  view.x0 = THREE.MathUtils.clamp(fx - w / 2, 0, 1 - w);
  view.y0 = THREE.MathUtils.clamp(fy - h / 2, 0, 1 - h);
  camera.left = view.x0 * A; camera.right = (view.x0 + w) * A;
  camera.top = -view.y0; camera.bottom = -(view.y0 + h);
  camera.updateProjectionMatrix();
  U.view.value.set(view.x0 * A, -view.y0, w * A, h);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  finish.uniforms.uRes.value.set(innerWidth * dpr, innerHeight * dpr);
  U.px.value = dpr;
  updateView();
}
addEventListener('resize', resize);
resize();

const toPlate = (cx, cy) => ({ x: view.x0 + (cx / innerWidth) * view.w, y: view.y0 + (cy / innerHeight) * view.h });

// ---------- lake mask on the CPU (click routing) ----------
const maskData = {};
(() => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    Object.assign(maskData, { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data });
  };
  img.src = 'assets/plates/mask.png';
})();
function isLake(x, y) {
  if (!maskData.d) return y > HORIZON + 0.01 && y < 0.72;
  const i = (Math.floor(y * maskData.h) * maskData.w + Math.floor(x * maskData.w)) * 4;
  return maskData.d[i + (cur.season > 0.5 ? 1 : 0)] > 128;
}

// ---------- interaction ----------
const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
let lastMove = 0, gustBoost = 0;
let ui = null;
function onMove(cx, cy) {
  mouse.set((cx / innerWidth) * 2 - 1, (cy / innerHeight) * 2 - 1);
  const p = toPlate(cx, cy);
  P.uCursor.value.set(p.x, p.y);
  U.cursorO.value.set(p.x * A, -p.y);
  lastMove = performance.now();
}
function onTap(cx, cy) {
  if (!audio.on) ui.maybeAutoSound();
  const p = toPlate(cx, cy);
  if (fire.hit(p.x, p.y)) { fire.stoke(); audio.sparks(); return; }
  if (isLake(p.x, p.y) && p.y > HORIZON + 0.004) {
    if (cur.ice > 0.5) { audio.iceSkip(0.3, pan(p.x)); return; }
    const g = toGround(p.x, p.y);
    ripple(g.X, g.Z, 1);
    audio.plop(0.7 / (1 + g.Z * 0.5), pan(p.x));
  } else if (p.y > HORIZON) {
    P.uGust.value.set(p.x, p.y, U.time.value, 1);
    U.gustO.value.set(p.x * A, -p.y, U.time.value, 1);
    gustBoost = 1; audio.gust();
  }
}
canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', (e) => onMove(e.clientX, e.clientY));
canvas.addEventListener('click', (e) => onTap(e.clientX, e.clientY));
addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('.panel, .mixer')) return;
  setTod(state.tod + e.deltaY * 0.0011);
}, { passive: true });

function setTod(v) { state.tod = THREE.MathUtils.clamp(v, 0, 3); ui && ui.syncLight(state.tod); save(); }
const actions = {
  setTod,
  setSeason(s) { state.season = s; save(); preload(); },
  setWeather(w) { state.weather = w; save(); preload(); },
  skip() { if (!audio.on) ui.maybeAutoSound(); stone.throw(cur.ice > 0.5); },
  breathe(on) { breathe = on ? 1 : 0; breatheT = 0; },
  audio,
};
ui = initUI(state, actions, LIGHT_NAMES);

// ---------- plate loading: what is on screen first, the rest in the background ----------
function preload() {
  const set = state.season === 'winter' ? WINTER : SUMMER;
  const i = Math.min(3, Math.round(state.tod));
  const first = [set[i], set[Math.min(3, i + 1)], set[Math.max(0, i - 1)]];
  if (state.weather !== 'clear') first.push(WEATHER[state.season]);
  return Promise.all(first.map(n => lib.load(n))).then(() => {
    [...set, WEATHER[state.season]].forEach(n => lib.load(n));
    setTimeout(() => [...SUMMER, ...WINTER, WEATHER.summer, WEATHER.winter].forEach(n => lib.load(n)), 2500);
  });
}
const firstPaint = preload();

// ---------- grading keyframes per light ----------
const lerp = THREE.MathUtils.lerp;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const K = [
  { night: 0, fireVis: 0.18, sparkle: 0.9, wtint: [1, 1, 1], mist: 0.25, rainLight: [0.75, 0.78, 0.8], smoke: [0.75, 0.75, 0.75] },
  { night: 0, fireVis: 0.3, sparkle: 1.2, wtint: [0.95, 0.82, 0.68], mist: 0.3, rainLight: [0.8, 0.7, 0.58], smoke: [0.7, 0.62, 0.55] },
  { night: 0.55, fireVis: 0.75, sparkle: 0.5, wtint: [0.42, 0.4, 0.5], mist: 0.38, rainLight: [0.42, 0.42, 0.5], smoke: [0.32, 0.32, 0.38] },
  { night: 1, fireVis: 1, sparkle: 0.8, wtint: [0.13, 0.16, 0.24], mist: 0.32, rainLight: [0.22, 0.26, 0.36], smoke: [0.16, 0.18, 0.24] },
];
const mixK = (t, key) => {
  const i = Math.min(2, Math.floor(Math.max(0, t))), f = ss(0, 1, t - i);
  const a = K[i][key], b = K[i + 1][key];
  return Array.isArray(a) ? a.map((v, j) => lerp(v, b[j], f)) : lerp(a, b, f);
};
const mixCol = (names, key, f) => { const a = PLATE_COLORS[names[0]][key], b = PLATE_COLORS[names[1]][key]; return a.map((v, j) => lerp(v, b[j], f)); };

// ---------- loop ----------
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
let last = performance.now(), time = +(params.get('t') ?? 0);
let frameAcc = 0, frameN = 0;
const smokeColor = new THREE.Color();
const ready = (n) => !!lib.tex[n]?.ready;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  time += dt; U.time.value = time; P.uTime.value = time;

  cur.tod = approach(cur.tod, state.tod, 2.0, dt);
  cur.season = approach(cur.season, state.season === 'winter' ? 1 : 0, 0.55, dt);
  cur.ice = approach(cur.ice, state.season === 'winter' ? 1 : 0, 0.5, dt);
  cur.rain = approach(cur.rain, state.weather === 'rain' ? 1 : 0, 0.5, dt);
  cur.snow = approach(cur.snow, state.weather === 'snow' ? 1 : 0, 0.5, dt);
  gustBoost = Math.max(0, gustBoost - dt * 0.4);

  // plates: adjacent light keys cross-fade quickly so in-between states stay crisp
  const t = THREE.MathUtils.clamp(cur.tod, 0, 2.9999);
  const i = Math.floor(t), f = ss(0.12, 0.88, t - i);
  const fb = [SUMMER[i], SUMMER[i + 1], ...SUMMER], wb = [WINTER[i], WINTER[i + 1], ...WINTER];
  P.tA.value = lib.get(SUMMER[i], fb); P.tB.value = lib.get(SUMMER[i + 1], fb);
  P.tC.value = lib.get(WINTER[i], wb); P.tD.value = lib.get(WINTER[i + 1], wb);
  P.tWs.value = lib.get(WEATHER.summer, fb); P.tWw.value = lib.get(WEATHER.winter, wb);
  const wReady = ready(WINTER[i]) && ready(WINTER[i + 1]), sReady = ready(SUMMER[i]) && ready(SUMMER[i + 1]);
  P.uF.value = f;
  P.uSeason.value = !wReady ? 0 : !sReady ? 1 : cur.season;
  const wx = Math.max(cur.rain, cur.snow);
  P.uWx.value = ready(state.season === 'winter' ? WEATHER.winter : WEATHER.summer) ? wx * 0.92 : 0;
  P.uWTint.value.setRGB(...mixK(cur.tod, 'wtint'));
  const night = mixK(cur.tod, 'night');
  P.uNight.value = night * (1 - wx * 0.7);
  P.uRain.value = cur.rain * (1 - cur.ice);
  P.uIce.value = cur.ice;
  P.uWind.value = U.wind.value = 0.3 + cur.rain * 0.3 + cur.snow * 0.2 + gustBoost * 0.6 + Math.sin(time * 0.05) * 0.08;
  P.uSparkle.value = mixK(cur.tod, 'sparkle') * (1 - wx * 0.85);
  const sNames = [SUMMER[i], SUMMER[i + 1]], wNames = [WINTER[i], WINTER[i + 1]];
  const mS = mixCol(sNames, 'mist', f), mW = mixCol(wNames, 'mist', f);
  P.uMistColor.value.setRGB(...mS.map((v, j) => lerp(v, mW[j], cur.season))).convertSRGBToLinear();
  P.uMist.value = mixK(cur.tod, 'mist') + cur.season * 0.08 + wx * 0.15;
  P.uFireVis.value = mixK(cur.tod, 'fireVis') * (0.7 + 0.3 * (1 - wx));

  rain.material.uniforms.uAmt.value = cur.rain;
  rain.material.uniforms.uLight.value.setRGB(...mixK(cur.tod, 'rainLight'));
  snow.material.uniforms.uAmt.value = cur.snow;
  snow.material.uniforms.uLight.value.setRGB(...mixK(cur.tod, 'rainLight')).multiplyScalar(1.25);
  flies.material.uniforms.uAmt.value = (1 - cur.season) * ss(1.4, 2.4, cur.tod) * (1 - cur.rain);
  smokeColor.setRGB(...mixK(cur.tod, 'smoke'));
  U.cursorOn.value = P.uCursorOn.value = approach(P.uCursorOn.value, now - lastMove < 1500 ? 1 : 0, 3, dt);

  // depth parallax with a slow idle drift; breathing zoom
  mouseS.x = approach(mouseS.x, mouse.x, 1.4, dt);
  mouseS.y = approach(mouseS.y, mouse.y, 1.4, dt);
  P.uMouse.value.set(mouseS.x + Math.sin(time * 0.05) * 0.25, mouseS.y + Math.sin(time * 0.037) * 0.15);
  if (breathe) breatheT += dt;
  const z = 1 + (breathe ? ss(0, 25, breatheT) * 0.07 : 0);
  if (Math.abs(z - zoomS) > 1e-5) { zoomS = approach(zoomS, z, 1.5, dt); updateView(); }
  // overlay fire follows the plate's parallax at the fire's depth (~0.45)
  fire.group.position.x = fire.base.x - P.uMouse.value.x * 0.3 * 0.011 * A;
  fire.group.position.y = fire.base.y + P.uMouse.value.y * 0.3 * 0.006;

  fire.update(dt, time, { night, rain: cur.rain, wind: U.wind.value, smokeColor });
  P.uFireInt.value = fire.inten;
  stone.update(dt);
  birds.update(dt, time, night < 0.3 && wx < 0.5, lerp(1, 0.6, wx));
  audio.update({ rain: cur.rain, snowFall: cur.snow, night, winter: cur.season, tod: cur.tod, fireBoost: fire.boost, ice: cur.ice });

  composer.render();

  frameAcc += dt; frameN++;
  if (frameAcc > 4) {
    if (frameAcc / frameN > 0.026 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); }
    frameAcc = 0; frameN = 0;
  }
  requestAnimationFrame(frame);
}
firstPaint.then(() => {
  requestAnimationFrame((t) => { last = t; frame(t); requestAnimationFrame(() => document.body.classList.add('ready')); window.__ready = true; });
});
window.__app = { state, cur, P, U, camera, scene, renderer, actions, audio, fire, birds, view, lib };
