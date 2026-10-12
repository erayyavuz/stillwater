import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seasonal, height } from './terrain.js';

export const DOCK = { x: 8.2, z0: 13, z1: -3.5, w: 1.7 };

export function createDock() {
  const g = new THREE.Group();
  const wood = seasonal(new THREE.MeshStandardMaterial({ color: 0x7a5a3e, roughness: 0.85 }), { key: 'wood', detail: 1, snowMin: 0.8, snowMax: 0.95 });
  const post = seasonal(new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }), { key: 'post', snowMin: 0.85, snowMax: 0.98 });
  const planks = [];
  const len = DOCK.z0 - DOCK.z1;
  const n = Math.floor(len / 0.24);
  for (let i = 0; i < n; i++) {
    const b = new THREE.BoxGeometry(DOCK.w * (0.97 + Math.random() * 0.06), 0.05, 0.21);
    b.rotateY((Math.random() - 0.5) * 0.02);
    b.translate((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.008, DOCK.z0 - i * 0.24 - 0.12);
    planks.push(b);
  }
  // stringers
  for (const sx of [-0.65, 0.65]) { const s = new THREE.BoxGeometry(0.1, 0.14, len); s.translate(sx, -0.09, (DOCK.z0 + DOCK.z1) / 2); planks.push(s); }
  const deck = new THREE.Mesh(mergeGeometries(planks), wood);
  const deckY = 0.62;
  deck.position.set(DOCK.x, deckY, 0);
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);
  const posts = [];
  for (let z = DOCK.z0 - 0.4; z > DOCK.z1; z -= 2.1) {
    for (const sx of [-0.72, 0.72]) {
      const gy = Math.min(height(DOCK.x + sx, z), -0.1);
      const top = deckY + 0.06 + (Math.abs(z - DOCK.z1) < 0.6 ? 0.45 : 0);
      const c = new THREE.CylinderGeometry(0.075, 0.085, top - gy + 0.4, 8);
      c.translate(sx, (top + gy - 0.4) / 2, z);
      posts.push(c);
    }
  }
  const ps = new THREE.Mesh(mergeGeometries(posts), post);
  ps.position.x = DOCK.x;
  ps.castShadow = true;
  g.add(ps);
  return g;
}

export function dockAvoid(x, z) {
  return Math.abs(x - DOCK.x) < DOCK.w * 0.6 && z < DOCK.z0 + 0.3 && z > DOCK.z1 - 0.5;
}

// A stone thrown from the shore. Skips on water, slides on ice.
export class SkipStone {
  constructor(scene, hooks) {
    this.hooks = hooks;
    const geo = new THREE.SphereGeometry(0.06, 12, 8); geo.scale(1, 0.38, 0.85);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5f5c58, roughness: 0.7 }));
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.active = false;
  }
  throw(from, ice) {
    this.active = true;
    this.mesh.visible = true;
    this.p = from.clone();
    const ang = (Math.random() - 0.5) * 0.35 + 0.08;
    const sp = 15 + Math.random() * 4;
    this.v = new THREE.Vector3(Math.sin(ang) * sp, 2.6 + Math.random() * 0.8, -Math.cos(ang) * sp);
    this.ice = ice;
    this.sliding = false;
    this.skips = 0;
    this.spin = 0;
  }
  update(dt) {
    if (!this.active) return;
    const p = this.p, v = this.v;
    this.spin += dt * 30;
    if (this.sliding) {
      const s = Math.hypot(v.x, v.z);
      const ns = Math.max(0, s - dt * 1.1);
      v.x *= ns / (s || 1); v.z *= ns / (s || 1);
      p.x += v.x * dt; p.z += v.z * dt; p.y = 0.02;
      if (ns < 0.05) { this.active = false; this.hooks.rest(p.clone()); }
    } else {
      v.y -= 9.8 * dt;
      p.addScaledVector(v, dt);
      const gh = height(p.x, p.z);
      if (gh > 0.02 && p.y <= gh) { this.active = false; this.mesh.visible = false; return; }
      if (p.y <= 0.02 && v.y < 0) {
        const hs = Math.hypot(v.x, v.z);
        if (this.ice) {
          this.hooks.iceHit(p.clone(), Math.min(1, -v.y / 4));
          if (-v.y > 1.5) { v.y = -v.y * 0.25; p.y = 0.02; }
          else { this.sliding = true; v.y = 0; p.y = 0.02; v.multiplyScalar(0.8); this.hooks.slide(p.clone(), hs); }
        } else if (hs > 4 && this.skips < 14) {
          this.skips++;
          this.hooks.splash(p.clone(), Math.max(0.35, 1.2 - this.skips * 0.07), this.skips);
          v.y = Math.max(0.6, -v.y * 0.62 + hs * 0.03);
          v.x *= 0.86; v.z *= 0.86;
          p.y = 0.02;
        } else {
          this.hooks.splash(p.clone(), 1.1, -1);
          this.active = false; this.mesh.visible = false;
          return;
        }
      }
    }
    this.mesh.position.copy(p);
    this.mesh.rotation.set(0, this.spin, 0);
  }
}
