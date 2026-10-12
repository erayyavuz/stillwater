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
        // a candle flame: a narrow teardrop that sways gently from the wick
        float tear(vec2 p, float w, float h){
          float y = p.y / h;
          if (y < 0. || y > 1.) return 1e3;
          float r = w * pow(sin(3.14159 * pow(y, 0.62)), 1.25) * (1. - 0.25 * y);
          return abs(p.x) / max(r, 1e-4);
        }
        void main(){
          vec2 uv = vUv;
          float t = uTime;
          // slow sway, faster at the tip; a little flutter
          float sw = (vnoise(vec2(t * 0.9, 1.7)) - .5) * .09 + (vnoise(vec2(t * 4.1, 3.2)) - .5) * .025;
          vec2 p = vec2(uv.x - .5 - sw * uv.y * uv.y, uv.y - .1);
          float h = .78 + (vnoise(vec2(t * 2.3, 7.1)) - .5) * .08;
          float d = tear(p, .17, h);           // outer envelope
          float di = tear(p - vec2(0., .03), .1, h * .62); // inner dark cone
          float y = clamp(p.y / h, 0., 1.);
          float outer = smoothstep(1.05, .6, d);
          float edge = smoothstep(1.15, .85, d) - smoothstep(.85, .5, d);
          float cone = smoothstep(1., .45, di) * smoothstep(.0, .15, y);
          // colours: white-yellow body, warmer edge and tip, a dimmer amber cone above the wick
          vec3 body = mix(vec3(1., .93, .74), vec3(1., .66, .26), smoothstep(.45, 1., y));
          vec3 col = body * outer * 2.1;
          col = mix(col, vec3(.95, .5, .14) * 1.5 * outer, cone * .55);
          col += vec3(1., .48, .12) * edge * .5;
          // blue at the root
          float blue = smoothstep(1.2, .5, tear(p + vec2(0., .02), .15, .2)) * smoothstep(.25, .0, y);
          col = mix(col, vec3(.18, .35, 1.) * .9, blue * .75);
          // soft bloom-like glow kept tight around the flame
          vec2 gq = (uv - vec2(.5, .42)) * vec2(1., .55);
          col += vec3(1., .55, .2) * exp(-dot(gq, gq) * 26.) * .18;
          gl_FragColor = vec4(col * uLit, 1.);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flame = new THREE.Mesh(g, this.mat);
    this.flame.scale.set(0.03, 0.062, 1);
    this.flame.position.y = -0.002;
    this.group.add(this.flame);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xff9a4a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.35 }));
    this.halo.scale.set(0.075, 0.09, 1); this.halo.position.y = 0.03;
    this.group.add(this.halo);
    // wick ember after blowing out
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0 }));
    this.group.add(this.ember);
    // the wick, glowing where it meets the flame, and the pool of molten wax lit from within
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0009, 0.009, 6), new THREE.MeshBasicMaterial({ color: 0x1a0d06 }));
    wick.position.y = 0.0015; wick.rotation.z = 0.15;
    this.wickTip = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7020 }));
    this.wickTip.position.set(0.0006, 0.0055, 0);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(0.0105, 24), new THREE.MeshBasicMaterial({ color: 0xff9a50, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = -0.0042;
    this.group.add(wick, this.wickTip, this.pool);
    // smoke: thin ribbons through a rising, curling field
    this.MAXS = 240;
    this.emits = [];            // {t, k}
    this.strands = [0, 1].map(si => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.MAXS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aUV', new THREE.BufferAttribute(new Float32Array(this.MAXS * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(this.MAXS * 2), 1).setUsage(THREE.DynamicDrawUsage));
      const idx = []; for (let i = 0; i < this.MAXS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx); g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color(0.75, 0.75, 0.78) }, uTime: { value: 0 }, uSeed: { value: si * 7.3 } },
        vertexShader: `attribute vec2 aUV; attribute float aA; varying vec2 vUV; varying float vA; void main(){ vUV = aUV; vA = aA; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform vec3 uCol; uniform float uTime, uSeed; varying vec2 vUV; varying float vA;
          float h(float x){ return fract(sin(x * 91.7 + uSeed) * 43758.5); }
          float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.), f * f * (3. - 2. * f)); }
          void main(){
            float across = clamp(1. - abs(vUV.x * 2. - 1.), 0., 1.);
            float core = pow(across, 1.6);
            // fine wisps along the stream
            float w = 0.55 + 0.45 * n1(vUV.y * 40. - uTime * 2.) * n1(vUV.y * 13. + vUV.x * 3.);
            float a = clamp(vA * core * w, 0., 1.);
            if (a < 0.002) discard;
            gl_FragColor = vec4(uCol, a);
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.frustumCulled = false;
      m.renderOrder = 6;
      return m;
    });
    this.smokeLeft = 0;
  }
  attachSmoke(scene) { this.strands.forEach(m => scene.add(m)); }

  toggle() {
    this.target = this.target > 0.5 ? 0 : 1;
    if (this.target === 0) this.smokeLeft = 5;
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
    this.halo.material.opacity = 0.13 * this.flicker;
    this.pool.material.opacity = 0.28 * this.flicker;
    this.wickTip.visible = this.lit > 0.2;
    this.ember.material.opacity = this.target ? 0 : Math.max(0, this.smokeLeft / 5) * 0.9;
    // smoke ribbons
    if (this.smokeLeft > 0) { this.smokeLeft -= dt; this.emits.push({ t, k: Math.min(1, this.smokeLeft / 3.5) }); }
    const LIFE = 4.5;
    while (this.emits.length && (t - this.emits[0].t > LIFE || this.emits.length > this.MAXS)) this.emits.shift();
    this.updateSmoke(t, camera, LIFE);
  }
}

CandleFlame.prototype.updateSmoke = function (t, camera, LIFE) {
  const base = this.group.position;
  const E = this.emits, n = E.length;
  const cam = camera.position;
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), T = new THREE.Vector3(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const pt = (age, si, out) => {
    // rises, slowly accelerating; laminar near the wick, then breaking into curls
    const hgt = 0.004 + 0.07 * age + 0.012 * age * age;
    const k = Math.min(1, Math.max(0, (hgt - 0.025) / 0.17)); const A = 0.0006 + 0.28 * k * k * (3 - 2 * k) * hgt;
    const ph = si * 2.1 + Math.sin(t * 0.37 + si) * 1.4 + Math.sin(hgt * 13 + t * 0.6) * 0.8;
    const x = A * (Math.sin(hgt * 38 - t * 2.3 + ph) * 0.7 + Math.sin(hgt * 91 - t * 4.1 + ph * 2) * 0.3) + this.bend.x * hgt * 0.4;
    const z = A * 0.8 * Math.sin(hgt * 29 - t * 1.7 + ph + 1.3);
    return out.set(base.x + x + si * 0.0006, base.y + hgt, base.z + z);
  };
  this.strands.forEach((m, si) => {
    const g = m.geometry, pos = g.attributes.position.array, uv = g.attributes.aUV.array, al = g.attributes.aA.array;
    m.material.uniforms.uTime.value = t;
    let c = 0;
    for (let i = n - 1; i >= 0; i--) {   // newest (at the wick) first
      const e = E[i], age = t - e.t;
      pt(age, si, P); pt(age + 0.03, si, Q);
      T.subVectors(Q, P); if (T.lengthSq() < 1e-12) T.set(0, 1, 0); T.normalize(); V.subVectors(cam, P).normalize();
      S.crossVectors(T, V); if (S.lengthSq() < 1e-12) S.set(1, 0, 0); S.normalize();
      const w = 0.0007 + age * 0.0022 + age * age * 0.0008;
      pos.set([P.x - S.x * w, P.y - S.y * w, P.z - S.z * w, P.x + S.x * w, P.y + S.y * w, P.z + S.z * w], c * 6);
      const v = age / LIFE;
      uv.set([0, v, 1, v], c * 4);
      const a = e.k * Math.min(1, age * 6) * Math.pow(1 - v, 1.6) * (si ? 0.22 : 0.42) / (1 + age * 0.9);
      al[c * 2] = al[c * 2 + 1] = a;
      c++;
    }
    g.setDrawRange(0, Math.max(0, (c - 1) * 6));
    g.attributes.position.needsUpdate = g.attributes.aUV.needsUpdate = g.attributes.aA.needsUpdate = true;
  });
};

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
