import * as THREE from 'three';
import { U, sampleEnv, LIGHT_NAMES } from './env.js';
import { createSky } from './sky.js';
import { createTerrain, createForest, createRocks, height, CAM_BASE } from './terrain.js';
import { createWater } from './water.js';
import { createGrass, interact, GRASS_LAYER } from './grass.js';
import { Campfire } from './fire.js';
import { createRain, createSnow, createFireflies } from './weather.js';
import { createDock, dockAvoid, SkipStone } from './props.js';
import { Ambience } from './audio.js';
import { initUI } from './ui.js';
import { createMist, Birds } from './life.js';

const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const Q = mobile
  ? { terrainSeg: 220, trees: 1500, frameTrees: 10, grass: 16000, reeds: 2600, rain: 5000, snow: 3000, smoke: 10, reflScale: 0.35, dpr: 1.5, shadow: 1024, fireflies: 50 }
  : { terrainSeg: 320, trees: 3400, frameTrees: 16, grass: 46000, reeds: 6500, rain: 9000, snow: 6000, smoke: 16, reflScale: 0.5, dpr: 1.75, shadow: 2048, fireflies: 90 };

// ---------- state ----------
const store = (() => { try { return JSON.parse(localStorage.getItem('stillwater') || '{}'); } catch { return {}; } })();
export const state = {
  tod: +(params.get('tod') ?? store.tod ?? 1.05),
  season: params.get('season') ?? store.season ?? 'summer',
  weather: params.get('weather') ?? store.weather ?? 'clear',
};
const cur = { tod: state.tod, rain: state.weather === 'rain' ? 1 : 0, snowFall: state.weather === 'snow' ? 1 : 0, winter: state.season === 'winter' ? 1 : 0, wet: state.weather === 'rain' ? 1 : 0 };
cur.ice = cur.winter;
export function save() { try { localStorage.setItem('stillwater', JSON.stringify(state)); } catch { } }

// ---------- renderer ----------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(devicePixelRatio, Q.dpr);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xffffff, 0.002);
const camera = new THREE.PerspectiveCamera(mobile ? 58 : 46, innerWidth / innerHeight, 0.1, 3500);
camera.layers.enable(GRASS_LAYER);

const sky = createSky();
scene.add(sky);

const firePos = new THREE.Vector3(0.9, 0, 13.4);
const avoid = (x, z) => Math.hypot(x - firePos.x, z - firePos.z) < 1.25 || dockAvoid(x, z);
scene.add(createTerrain(Q));
scene.add(createForest(Q, avoid));
scene.add(createRocks());
scene.add(createDock());
const water = createWater(Q);
scene.add(water);
scene.add(createGrass(Q, avoid));
const fire = new Campfire(firePos, Q);
scene.add(fire.group);
const rain = createRain(Q.rain); scene.add(rain);
const snow = createSnow(Q.snow); scene.add(snow);
const flies = createFireflies(Q.fireflies); scene.add(flies);
const mist = createMist(); scene.add(mist);
const birds = new Birds(scene);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow, Q.shadow);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 220 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
sun.target.position.set(3, 0, 6);
scene.add(sun, sun.target);

const audio = new Ambience();
const stone = new SkipStone(scene, {
  splash: (p, s) => { water.addRipple(p.x, p.z, s); audio.plop(s * 0.8, pan(p)); },
  iceHit: (p, s) => audio.iceSkip(0.4 + s, pan(p)),
  slide: (p, sp) => audio.scrape(Math.min(4, sp / 1.2), pan(p)),
  rest: () => { },
});
const pan = (p) => THREE.MathUtils.clamp((p.x - camera.position.x) / 18, -0.9, 0.9);

// ---------- camera ----------
const groundY = height(CAM_BASE.x, CAM_BASE.z);
const camHome = new THREE.Vector3(CAM_BASE.x, groundY + 1.45, CAM_BASE.z);
const lookHome = new THREE.Vector3(2.6, -2.6, -40);
const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
let breathe = 0, breatheT = 0;

// ---------- interaction ----------
const ray = new THREE.Raycaster();
function pick(cx, cy) {
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let prev = 0;
  for (let t = 0.5; t < 160; t += t < 20 ? 0.15 : 0.6) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const g = height(x, z);
    if (y <= Math.max(g, 0)) {
      // refine
      let a = prev, b = t;
      for (let i = 0; i < 8; i++) { const m = (a + b) / 2; const yy = o.y + d.y * m, xx = o.x + d.x * m, zz = o.z + d.z * m; if (yy <= Math.max(height(xx, zz), 0)) b = m; else a = m; }
      const p = new THREE.Vector3(o.x + d.x * b, 0, o.z + d.z * b);
      const gh = height(p.x, p.z);
      p.y = Math.max(gh, 0);
      return { p, water: gh < 0, dist: b };
    }
    prev = t;
  }
  return null;
}
function hitsFire(cx, cy) {
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.distanceToPoint(fire.hitCenter) < 0.75;
}
let lastMove = 0, gustBoost = 0;
let ui = null;
function onMove(cx, cy) {
  mouse.set((cx / innerWidth) * 2 - 1, (cy / innerHeight) * 2 - 1);
  const h = pick(cx, cy);
  if (h && h.dist < 30) { interact.cursor.value.copy(h.p); lastMove = performance.now(); }
}
function onTap(cx, cy) {
  audio.on || ui.maybeAutoSound();
  if (hitsFire(cx, cy)) { fire.stoke(); audio.sparks(); return; }
  const h = pick(cx, cy);
  if (!h) return;
  if (h.water) {
    if (cur.ice > 0.5) audio.iceSkip(0.35, pan(h.p));
    else { water.addRipple(h.p.x, h.p.z, 1); audio.plop(0.7, pan(h.p)); }
  } else {
    interact.gust.value.set(h.p.x, h.p.z, U.time.value, 1);
    gustBoost = 1;
    audio.gust();
  }
}

canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', (e) => { onMove(e.clientX, e.clientY); });
canvas.addEventListener('click', (e) => onTap(e.clientX, e.clientY));
addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('.panel, .mixer')) return;
  setTod(state.tod + e.deltaY * 0.0011);
}, { passive: true });

export function setTod(v) { state.tod = THREE.MathUtils.clamp(v, 0, 3); ui && ui.syncLight(state.tod); save(); }
export function setSeason(s) { state.season = s; save(); }
export function setWeather(w) { state.weather = w; save(); }

const actions = {
  setTod, setSeason, setWeather,
  skip() { audio.on || ui.maybeAutoSound(); const from = camera.position.clone().add(new THREE.Vector3(0.35, -0.45, -0.6)); stone.throw(from, cur.ice > 0.5); },
  breathe(on) { breathe = on ? 1 : 0; breatheT = 0; },
  audio,
};
ui = initUI(state, actions, LIGHT_NAMES);

// ---------- resize ----------
function resize() {
  camera.aspect = innerWidth / innerHeight;
  // portrait: swing the view toward the fire, look a little further down
  const portrait = camera.aspect < 0.8;
  lookHome.set(portrait ? 5 : 2.6, portrait ? -9 : -2.6, -40);
  camera.fov = innerWidth / innerHeight < 0.8 ? 62 : (mobile ? 56 : 46);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  water.resizeReflection(Q);
  const sc = innerHeight * dpr * 0.5;
  for (const m of [fire.emberPts.material, snow.material, flies.material]) m.uniforms.uScale.value = sc;
}
addEventListener('resize', resize);
resize();

// ---------- loop ----------
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
let last = performance.now(), time = +(params.get('t') ?? 0);
let frameAcc = 0, frameN = 0;
const camTarget = new THREE.Vector3();
const smokeColor = new THREE.Color();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  time += dt;
  U.time.value = time;

  // smooth state transitions
  cur.tod = approach(cur.tod, state.tod, 2.2, dt);
  cur.rain = approach(cur.rain, state.weather === 'rain' ? 1 : 0, 0.5, dt);
  cur.snowFall = approach(cur.snowFall, state.weather === 'snow' ? 1 : 0, 0.5, dt);
  cur.winter = approach(cur.winter, state.season === 'winter' ? 1 : 0, 0.45, dt);
  cur.ice = approach(cur.ice, state.season === 'winter' ? 1 : 0, cur.ice < (state.season === 'winter' ? 1 : 0) ? 0.3 : 0.6, dt);
  cur.wet = approach(cur.wet, state.weather === 'rain' ? 1 : 0, state.weather === 'rain' ? 0.25 : 0.06, dt);
  gustBoost = Math.max(0, gustBoost - dt * 0.4);

  const e = sampleEnv(cur.tod, cur.rain, cur.snowFall, cur.winter);
  const sunVis = ss(-0.1, 0.06, e.sunDir.y);
  U.sunDir.value.copy(e.sunDir);
  U.sunColor.value.copy(e.sun).multiplyScalar(e.sunI * 0.42 * (0.25 + 0.75 * sunVis));
  U.ambient.value.copy(e.hemiS).lerp(e.hemiG, 0.3).multiplyScalar(e.hemiI * 0.62);
  U.zenith.value.copy(e.zen); U.horizon.value.copy(e.hor);
  U.fogColor.value.copy(e.fog); U.fogDensity.value = e.fogD;
  scene.fog.color.copy(e.fog); scene.fog.density = e.fogD;
  U.waterColor.value.copy(e.water);
  U.night.value = e.night; U.cloud.value = e.cloud;
  U.rain.value = cur.rain; U.wet.value = cur.wet; U.snow.value = cur.winter; U.ice.value = cur.ice;
  U.wind.value = 0.28 + cur.rain * 0.35 + cur.snowFall * 0.15 + gustBoost * 0.6 + Math.sin(time * 0.05) * 0.08;
  sky.material.uniforms.uGlow.value = e.glow;
  renderer.toneMappingExposure = e.exp;
  hemi.color.copy(e.hemiS); hemi.groundColor.copy(e.hemiG); hemi.intensity = e.hemiI;
  sun.color.copy(e.sun); sun.intensity = e.sunI * sunVis;
  sun.position.copy(sun.target.position).addScaledVector(e.sunDir, 100);
  snow.material.uniforms.uSnowFall.value = cur.snowFall;
  flies.material.uniforms.uAmt.value = (1 - cur.winter) * ss(1.3, 2.3, cur.tod) * (1 - cur.rain);
  interact.cursorOn.value = approach(interact.cursorOn.value, now - lastMove < 1500 ? 1 : 0, 3, dt);

  // camera
  mouseS.x = approach(mouseS.x, mouse.x, 1.6, dt);
  mouseS.y = approach(mouseS.y, mouse.y, 1.6, dt);
  if (breathe) breatheT += dt;
  const bz = breathe ? ss(0, 20, breatheT) : 0;
  const drift = Math.sin(time * 0.07) * 0.25;
  camera.position.set(camHome.x + mouseS.x * 0.45 + drift, camHome.y - mouseS.y * 0.18 + Math.sin(time * 0.31) * 0.02 - bz * 0.15, camHome.z - bz * 2.2);
  camTarget.copy(lookHome).add(new THREE.Vector3(mouseS.x * 4 + drift * 2, -mouseS.y * 2 - bz * 2, 0));
  if (params.get('cam')) { const c = params.get('cam').split(',').map(Number); camera.position.set(c[0], c[1], c[2]); camTarget.set(c[3], c[4], c[5]); }
  camera.lookAt(camTarget);
  sky.position.copy(camera.position);
  rain.material.uniforms.uCam.value.copy(camera.position);
  snow.material.uniforms.uCam.value.copy(camera.position);

  smokeColor.copy(U.ambient.value).multiplyScalar(1.6).addScalar(0.05);
  fire.update(dt, time, camera, { night: e.night, rain: cur.rain, winter: cur.winter, windX: U.wind.value, smokeColor });
  stone.update(dt);
  birds.update(dt, time, e.night < 0.3 && cur.rain < 0.5 && cur.snowFall < 0.5);
  mist.material.uniforms.uAmt.value = 0.12 + e.night * 0.22 + cur.winter * 0.2 + cur.rain * 0.15 + ss(1.2, 2, cur.tod) * (1 - ss(2, 3, cur.tod)) * 0.15;

  audio.update({ rain: cur.rain, snowFall: cur.snowFall, night: e.night, winter: cur.winter, tod: cur.tod, fireBoost: fire.boost, ice: cur.ice });

  renderer.render(scene, camera);

  // adaptive resolution for weaker GPUs
  frameAcc += dt; frameN++;
  if (frameAcc > 4) {
    const avg = frameAcc / frameN;
    if (avg > 0.024 && dpr > 0.9) { dpr = Math.max(0.85, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); }
    frameAcc = 0; frameN = 0;
  }
  if (!window.__ready) { window.__ready = true; document.body.classList.add('ready'); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__app = { state, cur, U, camera, scene, renderer, actions, audio, water, fire, birds, mist, setTime: (t) => (time = t) };
