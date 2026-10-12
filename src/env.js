import * as THREE from 'three';

// Global uniforms shared by every custom shader in the scene.
export const U = {
  time: { value: 0 },
  wind: { value: 0.35 },
  snow: { value: 0 },        // snow cover on surfaces (winter)
  wet: { value: 0 },         // rain wetness
  rain: { value: 0 },
  ice: { value: 0 },
  night: { value: 0 },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color() },
  ambient: { value: new THREE.Color() },
  zenith: { value: new THREE.Color() },
  horizon: { value: new THREE.Color() },
  fogColor: { value: new THREE.Color() },
  fogDensity: { value: 0.002 },
  cloud: { value: 0.35 },
  waterColor: { value: new THREE.Color() },
  firePos: { value: new THREE.Vector3() },
  fireColor: { value: new THREE.Color(1, 0.45, 0.15) },
  fireInt: { value: 1 },
};

export const LIGHT_NAMES = ['Noon', 'Golden', 'Dusk', 'Night'];

// az: degrees from straight ahead (-z) toward +x; el: elevation degrees.
const KEYS = [
  { az: -140, el: 58, sun: 0xfff1db, sunI: 3.0, zen: 0x2d6cc0, hor: 0xb8d2ea, hemiS: 0xa8c4e4, hemiG: 0x4d5638, hemiI: 1.15, fogD: 0.0015, water: 0x1f4c5e, exp: 0.82, night: 0, glow: 0.35 },
  { az: 20, el: 7, sun: 0xffad62, sunI: 2.5, zen: 0x3e67a6, hor: 0xf2bd86, hemiS: 0x8ea4c6, hemiG: 0x5b4a35, hemiI: 0.85, fogD: 0.0018, water: 0x22404f, exp: 0.9, night: 0, glow: 1 },
  { az: 30, el: -2.5, sun: 0xff7a4c, sunI: 0.55, zen: 0x1c2645, hor: 0xc7785f, hemiS: 0x4a5476, hemiG: 0x2d2530, hemiI: 0.55, fogD: 0.0021, water: 0x131d2b, exp: 1.0, night: 0.4, glow: 1 },
  { az: 24, el: 15, sun: 0xa9bcea, sunI: 0.5, zen: 0x040917, hor: 0x16223d, hemiS: 0x2a3d66, hemiG: 0x0d1018, hemiI: 0.55, fogD: 0.0021, water: 0x07101c, exp: 1.25, night: 1, glow: 0.35 },
];

const _c = (h) => new THREE.Color(h);
const PAL = KEYS.map(k => ({ ...k, sun: _c(k.sun), zen: _c(k.zen), hor: _c(k.hor), hemiS: _c(k.hemiS), hemiG: _c(k.hemiG), water: _c(k.water) }));

const grey = (c, k) => { const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15; return c.lerp(new THREE.Color(l, l, l * 1.05), k); };

/** tod in [0,3]; rain/snowFall/winter in [0,1]. */
export function sampleEnv(tod, rain, snowFall, winter) {
  const t = THREE.MathUtils.clamp(tod, 0, 3);
  const i = Math.min(2, Math.floor(t));
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  const a = PAL[i], b = PAL[i + 1];
  const L = (x, y) => x + (y - x) * s;
  const C = (x, y) => x.clone().lerp(y, s);
  const az = THREE.MathUtils.degToRad(L(a.az, b.az));
  const el = THREE.MathUtils.degToRad(L(a.el, b.el));
  const e = {
    sunDir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize(),
    sun: C(a.sun, b.sun), sunI: L(a.sunI, b.sunI),
    zen: C(a.zen, b.zen), hor: C(a.hor, b.hor),
    hemiS: C(a.hemiS, b.hemiS), hemiG: C(a.hemiG, b.hemiG), hemiI: L(a.hemiI, b.hemiI),
    fogD: L(a.fogD, b.fogD), water: C(a.water, b.water), exp: L(a.exp, b.exp),
    night: L(a.night, b.night), glow: L(a.glow, b.glow),
  };
  // Overcast: rain and falling snow grey everything out.
  const over = Math.max(rain, snowFall * 0.8);
  grey(e.zen, over * 0.85).multiplyScalar(1 - over * 0.35);
  grey(e.hor, over * 0.8).multiplyScalar(1 - over * 0.2);
  grey(e.hemiS, over * 0.6);
  e.sunI *= 1 - over * 0.8;
  e.glow *= 1 - over * 0.85;
  e.hemiI *= 1 + over * 0.15;
  e.zen.lerp(e.hor.clone().multiplyScalar(0.9), over * 0.75);
  e.fogD *= 1 + rain * 1.1 + snowFall * 1.3;
  e.cloud = 0.32 + over * 0.63;
  // Winter: cooler sky, snow bounces light up from the ground.
  e.hor.lerp(new THREE.Color(0xc9d4e2).multiplyScalar(0.25 + 0.75 * (1 - e.night)), winter * 0.25);
  e.hemiG.lerp(new THREE.Color(0x8d97a8).multiplyScalar(1 - e.night * 0.85), winter * 0.6);
  e.fog = e.hor.clone();
  return e;
}
