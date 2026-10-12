import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from './env.js';
import { NOISE } from './glsl.js';

export const LAKE = { cx: 0, cz: -112, rx: 170, rz: 121 };
export const CAM_BASE = new THREE.Vector3(0, 0, 18.6);

const fract = (x) => x - Math.floor(x);
const hash = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, o = 5) {
  let s = 0, a = 0.5;
  for (let i = 0; i < o; i++) { s += a * vnoise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.3; a *= 0.5; }
  return s;
}
function ridged(x, z, o = 5) {
  let s = 0, a = 0.5;
  for (let i = 0; i < o; i++) { const n = 1 - Math.abs(vnoise(x, z) * 2 - 1); s += a * n * n; x = x * 2.07 + 5.3; z = z * 2.07 + 1.7; a *= 0.5; }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function lakeD(x, z) {
  const dx = (x - LAKE.cx) / LAKE.rx, dz = (z - LAKE.cz) / LAKE.rz;
  return Math.sqrt(dx * dx + dz * dz) + (fbm(x * 0.012, z * 0.012, 3) - 0.5) * 0.08;
}

export function height(x, z) {
  const d = lakeD(x, z);
  let h = d < 1 ? -0.15 - Math.min(1, (1 - d) * 16) * 3.4 : -0.15 + (d - 1) * 13;
  h += (fbm(x * 0.09, z * 0.09, 3) - 0.5) * 0.5 * smooth(0.98, 1.04, d);
  h += smooth(1.06, 1.5, d) * ridged(x * 0.007, z * 0.007, 4) * 26;
  h += smooth(1.6, 2.6, d) * ridged(x * 0.0022 + 3, z * 0.0022, 5) * 170;
  return h;
}

// Patch a MeshStandardMaterial with snow cover, rain wetness, optional wind sway and ground detail.
export function seasonal(mat, { key, snowMin = 0.55, snowMax = 0.85, sway = 0, detail = 0 } = {}) {
  mat.customProgramCacheKey = () => 'seasonal-' + key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = U.snow; sh.uniforms.uWet = U.wet; sh.uniforms.uTime = U.time; sh.uniforms.uWind = U.wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway ? `{
          vec3 io = vec3(0.);
          #ifdef USE_INSTANCING
            io = instanceMatrix[3].xyz;
          #endif
          float k = position.y * position.y;
          float ph = io.x * 0.07 + io.z * 0.05;
          float g = 0.35 + uWind * 1.2;
          transformed.x += (sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.7 + ph * 3.)) * ${sway.toFixed(3)} * k * g;
          transformed.z += cos(uTime * 0.9 + ph * 1.3) * ${(sway * 0.6).toFixed(3)} * k * g;
        }` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPos = (modelMatrix * wp).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnow; uniform float uWet; varying vec3 vWPos;
        ${NOISE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wN = normalize((vec4(normal, 0.) * viewMatrix).xyz);
          float n = fbm3(vWPos.xz * 0.35);
          ${detail ? `diffuseColor.rgb *= 0.8 + 0.4 * fbm3(vWPos.xz * 1.9) + 0.12 * (vnoise(vWPos.xz * 9.) - .5);` : ''}
          float s = uSnow * smoothstep(${snowMin.toFixed(3)}, ${snowMax.toFixed(3)}, wN.y + (n - .5) * .45) * smoothstep(-0.06, 0.04, vWPos.y);
          vec3 snowCol = vec3(0.9, 0.93, 0.97) * (0.92 + 0.08 * vnoise(vWPos.xz * 6.));
          diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, s);
          roughnessFactor = mix(roughnessFactor, 0.75, s);
          float w = uWet * (1. - s);
          diffuseColor.rgb *= 1. - 0.38 * w;
          roughnessFactor = mix(roughnessFactor, 0.3, w * 0.8);
        }`);
  };
  return mat;
}

export function createTerrain(quality) {
  const N = quality.terrainSeg;
  const geo = new THREE.PlaneGeometry(2, 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const R = 1400, a = 0.07;
  const cx = 0, cz = 6;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getZ(i);
    const x = cx + R * (a * u + (1 - a) * u * u * u);
    const z = cz + R * (a * v + (1 - a) * v * v * v);
    pos.setXYZ(i, x, height(x, z), z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const mud = new THREE.Color(0x4a4134), sand = new THREE.Color(0x8b7b5c), grass = new THREE.Color(0x4c6a2c),
    grass2 = new THREE.Color(0x667a33), forest = new THREE.Color(0x26381f), rock = new THREE.Color(0x67625a),
    snow = new THREE.Color(0xeef1f5);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = fbm(x * 0.05, z * 0.05, 3);
    if (y < -0.05) c.copy(mud).lerp(sand, smooth(-1.5, -0.05, y) * 0.5).multiplyScalar(0.75 + 0.25 * smooth(-3, 0, y));
    else if (y < 0.35) c.copy(sand).lerp(grass, smooth(0.05, 0.35, y + (n - 0.5) * 0.3));
    else {
      c.copy(grass).lerp(grass2, n);
      const d = lakeD(x, z);
      c.lerp(forest, smooth(1.03, 1.15, d) * (0.6 + 0.4 * fbm(x * 0.02, z * 0.02, 3)));
      c.lerp(rock, smooth(0.25, 0.5, slope + (n - 0.5) * 0.2));
      c.lerp(rock, smooth(95, 135, y + n * 20));
      c.lerp(snow, smooth(125, 150, y + n * 30) * (1 - smooth(0.55, 0.75, slope)));
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = seasonal(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { key: 'terrain', detail: 1, snowMin: 0.6, snowMax: 0.88 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// --- Trees -----------------------------------------------------------------
function pineGeometry(seed) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.018, 0.035, 0.3, 6, 1);
  trunk.translate(0, 0.15, 0);
  paint(trunk, 0x3b2a1e);
  parts.push(trunk);
  const tiers = 8;
  let r = Math.random;
  let s = seed * 9301 + 49297;
  r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y0 = 0.12 + f * 0.74;
    const radius = 0.24 * (1 - f * 0.82) + 0.02;
    const hgt = 0.2 - f * 0.06;
    const seg = 11;
    const cone = new THREE.ConeGeometry(radius, hgt, seg, 1, true);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0) { // bottom ring: jag + droop
        const k = 0.75 + r() * 0.5;
        p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
        p.setY(i, y - r() * 0.03);
      }
    }
    cone.computeVertexNormals();
    cone.rotateY(r() * 6.28);
    cone.translate(0, y0 + hgt / 2, 0);
    paint(cone, new THREE.Color(0x1f3a22).lerp(new THREE.Color(0x2e4d2a), f * 0.6 + r() * 0.2));
    parts.push(cone);
  }
  return mergeGeometries(parts);
}
function paint(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.index) g.toNonIndexed && null;
  return g;
}

export function createForest(quality, avoid) {
  const geos = [pineGeometry(1), pineGeometry(2), pineGeometry(3)];
  const mat = seasonal(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), { key: 'pine', sway: 0.012, snowMin: 0.25, snowMax: 0.55 });
  const group = new THREE.Group();
  const lists = [[], [], []];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let tries = 0, count = 0;
  const target = quality.trees;
  const place = (x, z, scale) => {
    const y = height(x, z);
    p.set(x, y - 0.2, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    sc.set(scale * (0.38 + Math.random() * 0.14), scale, scale * (0.38 + Math.random() * 0.14));
    m.compose(p, q, sc);
    lists[count % 3].push(m.clone());
    count++;
  };
  while (count < target && tries < target * 30) {
    tries++;
    const x = (Math.random() * 2 - 1) * 520;
    const z = -620 + Math.random() * 660;
    const d = lakeD(x, z);
    if (d < 1.045) continue;
    const y = height(x, z);
    if (y < 0.5 || y > 115) continue;
    const dc = Math.hypot(x - CAM_BASE.x, z - CAM_BASE.z);
    if (dc < 24) continue;
    if (z > -8 && Math.abs(x) < 14) continue;
    if (z > 4 && Math.abs(x) < 70) continue; // nothing behind the viewer (it shows up as noise in the reflection)
    const e = 0.6;
    const sl = Math.abs(height(x + e, z) - height(x - e, z)) + Math.abs(height(x, z + e) - height(x, z - e));
    if (sl > 1.4) continue;
    const dens = fbm(x * 0.012, z * 0.012, 3) + smooth(1.05, 1.35, d) * 0.3;
    if (dens < 0.5 + Math.random() * 0.12) continue;
    if (avoid && avoid(x, z)) continue;
    place(x, z, (10 + Math.random() * 9) * (1 + smooth(150, 400, -z) * 0.4));
  }
  // a framing stand on the right shore
  for (let i = 0; i < quality.frameTrees; i++) {
    const x = 17 + Math.random() * 16, z = -6 + Math.random() * 20;
    if (height(x, z) < 0.4) continue;
    place(x, z, 9 + Math.random() * 6);
  }
  const col = new THREE.Color();
  lists.forEach((list, gi) => {
    const im = new THREE.InstancedMesh(geos[gi], mat, list.length);
    list.forEach((mm, i) => {
      im.setMatrixAt(i, mm);
      col.setHSL(0.27 + Math.random() * 0.06, 0.25 + Math.random() * 0.2, 0.42 + Math.random() * 0.18);
      im.setColorAt(i, col.multiplyScalar(2.2));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });
  return group;
}

export function rockGeometry(seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.78 + 0.4 * fbm(x * 1.3 + seed * 3.1, z * 1.3 + y * 0.9 + seed, 3);
    p.setXYZ(i, x * n, y * n * 0.7, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export function createRocks() {
  const mat = seasonal(new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.92, flatShading: true }), { key: 'rock', detail: 1, snowMin: 0.5, snowMax: 0.8 });
  const group = new THREE.Group();
  const spots = [[-9, 7.6, 1.1], [-7.4, 8.4, 0.6], [-13, 6.4, 1.6], [12.5, 6.2, 0.9], [-4.2, 8.9, 0.35], [14.6, 4.6, 1.4], [-18, 3.5, 1.8], [-2.2, 9.6, 0.28], [10.3, 8.6, 0.4]];
  spots.forEach(([x, z, s], i) => {
    const m = new THREE.Mesh(rockGeometry(i + 1), mat);
    m.position.set(x, height(x, z) - s * 0.15, z);
    m.scale.setScalar(s);
    m.rotation.y = i * 1.7;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  });
  return group;
}
