import * as THREE from 'three';
import { U } from './env.js';
import { NOISE } from './glsl.js';
import { height } from './terrain.js';

export const GRASS_LAYER = 1; // excluded from the water reflection pass

export const interact = {
  cursor: { value: new THREE.Vector3(0, -100, 0) },
  cursorOn: { value: 0 },
  gust: { value: new THREE.Vector4(0, 0, -100, 0) },
};

function bladeGeometry(segs) {
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pos.push(-0.5, t, 0, 0.5, t, 0);
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function grassMaterial({ base, tip, winterBase, winterTip, stiff = 1 }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: U.time, uWind: U.wind, uSnow: U.snow, uWet: U.wet, uSunDir: U.sunDir, uSunColor: U.sunColor, uAmbient: U.ambient,
      uFogColor: U.fogColor, uFogDensity: U.fogDensity, uFirePos: U.firePos, uFireColor: U.fireColor, uFireInt: U.fireInt,
      uCursor: interact.cursor, uCursorOn: interact.cursorOn, uGust: interact.gust,
      uBase: { value: new THREE.Color(base) }, uTip: { value: new THREE.Color(tip) },
      uWBase: { value: new THREE.Color(winterBase) }, uWTip: { value: new THREE.Color(winterTip) },
      uStiff: { value: stiff },
    },
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute vec4 iP;
      uniform float uTime, uWind, uSnow, uCursorOn, uStiff;
      uniform vec3 uCursor; uniform vec4 uGust;
      varying float vT, vVar; varying vec3 vW;
      ${NOISE}
      void main(){
        float t = position.y;
        float h = iP.x * (1. - 0.45 * uSnow) * step(iP.w, 1. - 0.65 * uSnow);
        float w = iP.y;
        vec3 p = vec3(position.x * w * (1. - t * 0.9), t * h, 0.);
        float c = cos(iP.z), s = sin(iP.z);
        p = vec3(c * p.x, p.y, s * p.x);
        vec3 wp = iPos + p;
        vec2 wd = normalize(vec2(1., 0.3));
        float gn = vnoise(iPos.xz * 0.09 - wd * uTime * 0.9);
        float bend = (0.12 + 0.88 * gn * gn) * (0.25 + uWind * 1.3);
        bend += sin(uTime * (2.2 + iP.w * 1.5) + iP.w * 31.) * 0.06 * (0.4 + uWind);
        vec2 disp = wd * bend;
        vec2 dc = iPos.xz - uCursor.xz; float dd = length(dc);
        disp += dc / (dd + 1e-3) * smoothstep(2.4, 0.2, dd) * 1.1 * uCursorOn;
        float age = uTime - uGust.z;
        if (age > 0. && age < 6.){
          vec2 dg = iPos.xz - uGust.xy; float rg = length(dg);
          float x = rg - age * 7.;
          disp += dg / (rg + 1e-3) * exp(-x * x * 0.15) * exp(-age * 0.5) * uGust.w * 1.3;
        }
        disp /= uStiff;
        float k = t * t;
        float L = length(disp);
        wp.xz += disp * k * h * 0.9;
        wp.y -= min(L, 1.2) * k * h * 0.38;
        vT = t; vVar = iP.w; vW = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uSunColor, uAmbient, uFogColor, uFirePos, uFireColor, uBase, uTip, uWBase, uWTip;
      uniform float uFogDensity, uSnow, uWet, uFireInt;
      varying float vT, vVar; varying vec3 vW;
      void main(){
        vec3 base = mix(uBase, uWBase, uSnow);
        vec3 tip = mix(uTip, uWTip, uSnow);
        vec3 col = mix(base, tip, smoothstep(0., 1., vT)) * (0.75 + 0.5 * vVar);
        col = mix(col, vec3(0.9, 0.92, 0.96), uSnow * smoothstep(0.55, 1., vT) * step(0.55, vVar) * 0.6);
        col *= 1. - uWet * 0.25;
        float ao = 0.35 + 0.65 * vT;
        float sun = max(uSunDir.y, 0.) * 0.75 + 0.15;
        vec3 light = uAmbient * 0.95 + uSunColor * sun * 0.75;
        // translucency when backlit by a low sun
        vec3 V = normalize(cameraPosition - vW);
        light += uSunColor * pow(max(dot(-V, uSunDir), 0.), 6.) * 0.35 * vT * smoothstep(-0.05, 0.08, uSunDir.y);
        vec3 fd = uFirePos - vW; float fdist = length(fd);
        light += uFireColor * uFireInt * 1.1 / (1. + fdist * fdist * 0.45);
        col *= light * ao;
        float d = length(cameraPosition - vW);
        col = mix(col, uFogColor, 1. - exp(-uFogDensity * uFogDensity * d * d));
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function build(count, segs, mat, sampler) {
  const base = bladeGeometry(segs);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const iPos = new Float32Array(count * 3), iP = new Float32Array(count * 4);
  let n = 0, guard = 0;
  while (n < count && guard < count * 20) {
    guard++;
    const s = sampler();
    if (!s) continue;
    iPos.set([s.x, s.y, s.z], n * 3);
    iP.set([s.h, s.w, Math.random() * Math.PI, Math.random()], n * 4);
    n++;
  }
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(iP, 4));
  g.instanceCount = n;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(GRASS_LAYER);
  return mesh;
}

export function createGrass(quality, avoid) {
  const group = new THREE.Group();
  const grassMat = grassMaterial({ base: 0x1a2c10, tip: 0x5f7a32, winterBase: 0x5a4c33, winterTip: 0xb7a376 });
  const reedMat = grassMaterial({ base: 0x23331a, tip: 0x7c8445, winterBase: 0x6a5a3c, winterTip: 0xcbb98d, stiff: 1.6 });

  const grass = build(quality.grass, 4, grassMat, () => {
    // denser near the camera
    const r = Math.pow(Math.random(), 1.6);
    const x = (Math.random() * 2 - 1) * (8 + r * 40);
    const z = 19.6 - r * 23.5 - Math.random() * 2;
    const y = height(x, z);
    if (y < 0.12) return null;
    if (avoid(x, z)) return null;
    if (Math.hypot(x, z - 18.6) < 0.9) return null; // keep the lens clear
    return { x, y: y - 0.02, z, h: (0.22 + Math.random() * 0.33) * (0.6 + 0.4 * Math.min(1, Math.hypot(x, z - 17) / 6)) + (y < 0.4 ? 0.15 : 0), w: 0.045 + Math.random() * 0.03 };
  });
  group.add(grass);

  const reeds = build(quality.reeds, 5, reedMat, () => {
    const x = (Math.random() * 2 - 1) * 45;
    const z = -12 + Math.random() * 26;
    const y = height(x, z);
    if (y < -0.45 || y > 0.25) return null;
    if (avoid(x, z)) return null;
    if (Math.abs(x - 1) < 7 && z > 4) return null; // keep the view to the water open
    // clumps
    const clump = Math.sin(x * 0.7) * Math.sin(z * 0.9 + 1.3);
    if (clump < 0.15) return null;
    return { x, y: Math.max(y, -0.45), z, h: 0.7 + Math.random() * 0.8 - Math.min(y, 0) * 0.5, w: 0.03 + Math.random() * 0.02 };
  });
  group.add(reeds);
  return group;
}
