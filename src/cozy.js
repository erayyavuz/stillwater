import * as THREE from 'three';
import { NOISE } from './glsl.js';

function softTex(noise) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  if (noise) {
    const d = x.getImageData(0, 0, 128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % 128, py = Math.floor(i / 4 / 128);
      const n = 0.55 + 0.45 * Math.sin(px * 0.21 + Math.sin(py * 0.17) * 2.2) * Math.sin(py * 0.13 + Math.sin(px * 0.11) * 1.7);
      d.data[i + 3] *= n;
    }
    x.putImageData(d, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
export const SOFT = softTex(false);
const WISP = softTex(true);

// A candle flame: camera-facing (around Y), bends with drafts and the cursor.
export class CandleFlame {
  constructor(pos) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.lit = 1; this.target = 1; this.bend = new THREE.Vector2();
    const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBend: { value: new THREE.Vector2() }, uLit: { value: 1 } },
      vertexShader: `uniform vec2 uBend; varying vec2 vUv;
        void main(){ vUv = uv; vec3 p = position; float k = uv.y * uv.y;
          p.x += uBend.x * k * 0.9; p.y *= 1. - abs(uBend.x) * 0.25 * k;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
      fragmentShader: `uniform float uTime, uLit; varying vec2 vUv; ${NOISE}
        void main(){
          vec2 p = vUv - vec2(.5, .0);
          float n = vnoise(vec2(p.y * 6. - uTime * 6., uTime * 1.3));
          p.x += (n - .5) * .06 * vUv.y;
          // teardrop: round base, tapering tip
          float y = vUv.y;
          float w = .26 * sqrt(max(y, 0.)) * (1. - y) * 1.9 + .01;
          float d = abs(p.x) / w;
          float body = smoothstep(1., .55, d) * smoothstep(.0, .12, y) * smoothstep(1., .72, y);
          float core = smoothstep(.75, .1, d) * smoothstep(.08, .3, y) * smoothstep(.75, .3, y);
          float blue = smoothstep(.7, .2, d) * smoothstep(.22, .05, y) * smoothstep(0., .05, y);
          vec3 c = vec3(1., .42, .08) * body * 1.6 + vec3(1., .86, .55) * core * 2.4 + vec3(.15, .3, 1.) * blue * .9;
          gl_FragColor = vec4(c * uLit, 1.);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flame = new THREE.Mesh(g, this.mat);
    this.flame.scale.set(0.022, 0.05, 1);
    this.flame.position.y = 0.004;
    this.group.add(this.flame);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xff9a4a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.35 }));
    this.halo.scale.set(0.16, 0.16, 1); this.halo.position.y = 0.025;
    this.group.add(this.halo);
    // wick ember after blowing out
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0 }));
    this.group.add(this.ember);
    // smoke wisp
    this.smoke = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: WISP, color: 0xb8b2aa, transparent: true, opacity: 0, depthWrite: false }));
      s.userData = { life: 0 };
      this.smoke.push(s); this.group.add(s);
    }
    this.smokeAcc = 0; this.smokeLeft = 0;
  }
  toggle() {
    this.target = this.target > 0.5 ? 0 : 1;
    if (this.target === 0) this.smokeLeft = 4.5;
    return this.target;
  }
  update(dt, t, camera, draft, cursorDir) {
    this.lit += (this.target - this.lit) * Math.min(1, dt * (this.target ? 3 : 14));
    // bend: drafts from the open window plus a push away from a nearby cursor
    const bx = Math.sin(t * 2.3) * 0.08 * draft + Math.sin(t * 7.1) * 0.03 * draft + cursorDir * 0.5 + Math.sin(t * 1.3) * 0.02;
    this.bend.x += (bx - this.bend.x) * Math.min(1, dt * 5);
    this.mat.uniforms.uBend.value.copy(this.bend);
    this.mat.uniforms.uTime.value = t;
    const flick = 0.92 + 0.06 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1) + 0.04 * (Math.random() - 0.5) + Math.abs(this.bend.x) * -0.2;
    this.flicker = flick * this.lit;
    this.mat.uniforms.uLit.value = this.lit * (0.95 + 0.05 * flick);
    this.flame.scale.y = 0.05 * (0.9 + 0.12 * flick) * (0.6 + 0.4 * this.lit);
    this.flame.rotation.y = Math.atan2(camera.position.x - this.group.position.x, camera.position.z - this.group.position.z);
    this.halo.material.opacity = 0.32 * this.flicker;
    this.ember.material.opacity = this.target ? 0 : Math.max(0, this.smokeLeft / 4.5) * 0.9;
    // smoke
    if (this.smokeLeft > 0) {
      this.smokeLeft -= dt;
      this.smokeAcc += dt * 14;
      while (this.smokeAcc > 1) {
        this.smokeAcc -= 1;
        const s = this.smoke.find(s => s.userData.life <= 0);
        if (s) Object.assign(s.userData, { life: 3.2, age: 0, ph: Math.random() * 6, str: Math.min(1, this.smokeLeft / 3) });
      }
    }
    for (const s of this.smoke) {
      const u = s.userData;
      if (u.life <= 0) { s.material.opacity = 0; continue; }
      u.life -= dt; u.age += dt;
      const a = u.age;
      s.position.set(Math.sin(a * 2.2 + u.ph) * 0.012 * a + this.bend.x * 0.3 * a, 0.01 + a * 0.085, Math.cos(a * 1.7 + u.ph) * 0.008 * a);
      s.scale.setScalar(0.008 + a * 0.03);
      s.material.opacity = Math.sin(Math.min(1, a / 3.2) * Math.PI) * 0.22 * u.str;
      s.material.rotation = u.ph + a * 0.4;
    }
  }
}

// Steam curling off the tea; the cursor stirs it.
export class Steam {
  constructor(pos, count = 34) {
    this.origin = pos.clone();
    this.parts = [];
    this.group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: WISP, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      s.userData = { age: Math.random() * 4, life: 4, p: new THREE.Vector3(), v: new THREE.Vector3(), ph: Math.random() * 6 };
      this.reset(s.userData, true);
      this.parts.push(s); this.group.add(s);
    }
    this.heat = 1; this.puff = 0;
  }
  reset(u, scatter) {
    u.age = scatter ? Math.random() * u.life : 0;
    u.p.copy(this.origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03));
    u.v.set(0, 0.03 + Math.random() * 0.02, 0);
  }
  update(dt, t, ray, light) {
    const tmp = new THREE.Vector3();
    for (const s of this.parts) {
      const u = s.userData;
      u.age += dt;
      if (u.age > u.life) this.reset(u, false);
      u.v.y += dt * 0.01;
      u.v.x += Math.sin(t * 0.9 + u.ph + u.p.y * 30) * dt * 0.02;
      u.v.z += Math.cos(t * 0.7 + u.ph + u.p.y * 25) * dt * 0.015;
      // cursor stirs the steam: push away from the mouse ray
      if (ray) {
        ray.closestPointToPoint(u.p, tmp);
        const d = tmp.sub(u.p); const dist = d.length();
        if (dist < 0.05) u.v.addScaledVector(d.normalize(), -dt * 1.2 * (1 - dist / 0.05));
      }
      u.v.multiplyScalar(1 - dt * 0.8);
      u.p.addScaledVector(u.v, dt);
      s.position.copy(u.p);
      const k = u.age / u.life;
      s.scale.setScalar(0.012 + k * 0.05);
      s.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.07 * this.heat * (1 + this.puff);
      s.material.color.copy(light);
      s.material.rotation = u.ph + k * 1.5;
    }
    this.puff = Math.max(0, this.puff - dt * 0.8);
  }
}
