import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { PLATE_ASPECT as A, FIRE, fromGround } from './plate.js';

// Overlay space: X = plateX * A, Y = -plateY (isotropic, plate-height units).
export const toO = (x, y) => new THREE.Vector2(x * A, -y);

const quad = () => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; };
function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const SOFT = softTex();

export class Fire {
  constructor(scene, U) {
    this.U = U;
    this.group = new THREE.Group();
    const base = toO(FIRE.x, FIRE.y - 0.012);
    this.base = base;
    this.group.position.set(base.x, base.y, 0);
    scene.add(this.group);
    this.boost = 0; this.flicker = 1;

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xff7a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.3 }));
    this.glow.scale.set(0.7, 0.5, 1); this.glow.position.y = 0.04;
    this.group.add(this.glow);

    // flames: two layered quads, each a bundle of licking tongues
    this.flames = [];
    const g = quad();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: U.time, uSeed: { value: i * 5.3 }, uInt: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `uniform float uTime, uSeed, uInt; varying vec2 vUv; ${NOISE}
          float tongue(vec2 uv, float x0, float w, float h, float sd, float t){
            float y = uv.y / h;
            if (y > 1.3) return 0.;
            float n = fbm3(vec2(uv.x * 7. + sd, uv.y * 4.5 - t * 3.4 - sd));
            float x = uv.x - x0 - (n - .5) * .22 * y - sin(t * 3.7 + sd * 2. + y * 6.) * .025 * y;
            float wid = w * pow(max(1. - y, 0.), 1.15) * smoothstep(0., .12, y) + w * .12 * smoothstep(1.2, .2, y);
            float m = smoothstep(wid, wid * .15, abs(x));
            return m * (1. - smoothstep(.55, 1.05, y + (n - .5) * .45));
          }
          void main(){
            vec2 uv = vUv; float t = uTime + uSeed;
            float v = 0.;
            uv.y -= 0.06;
            for (int k = 0; k < 6; k++){
              float fk = float(k);
              float sd = fk * 13.7 + uSeed;
              float x0 = .5 + (hash12(vec2(fk, uSeed)) - .5) * .42;
              float h = (.42 + .5 * hash12(vec2(uSeed, fk + 3.))) * (.72 + .45 * vnoise(vec2(t * 1.4 + sd, sd)));
              float w = .07 + .07 * hash12(vec2(fk + 7., uSeed));
              v += tongue(uv, x0, w, h, sd, t) * (.55 + .45 * (1. - abs(x0 - .5) * 2.));
            }
            // glowing bed of embers along the base
            vec2 bp = vec2((uv.x - .5) / .3, (uv.y - .1) / .07);
            float bed = smoothstep(1., .0, length(bp)) * (.6 + .4 * vnoise(vec2(uv.x * 20., t * 2.)));
            v = min(v, 1.6);
            float heat = v * (1.25 - uv.y * 1.1);
            vec3 c = mix(vec3(.38, .04, .0), vec3(1., .26, .02), smoothstep(.0, .4, heat));
            c = mix(c, vec3(1., .58, .14), smoothstep(.4, .85, heat));
            c = mix(c, vec3(1., .86, .58), smoothstep(.95, 1.35, heat));
            float a = smoothstep(0., .45, v) * smoothstep(0.02, 0.16, uv.y);
            vec3 col = c * a + vec3(1., .35, .06) * bed * .7;
            gl_FragColor = vec4(col * uInt, 1.);
          }`,
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      });
      const f = new THREE.Mesh(g, m);
      const s = i === 0 ? 1 : 0.8;
      f.userData.s = s;
      f.scale.set(0.125 * s, 0.17 * s, 1);
      f.position.set(i === 0 ? 0 : 0.012, -0.018, 0);
      this.flames.push(f); this.group.add(f);
    }

    // embers
    this.N = 160;
    this.em = Array.from({ length: this.N }, () => ({ life: 0, p: new THREE.Vector2(), v: new THREE.Vector2(), max: 1, age: 0 }));
    const eg = new THREE.BufferGeometry();
    this.ePos = new Float32Array(this.N * 3); this.eA = new Float32Array(this.N);
    eg.setAttribute('position', new THREE.BufferAttribute(this.ePos, 3));
    eg.setAttribute('aA', new THREE.BufferAttribute(this.eA, 1));
    this.emberPts = new THREE.Points(eg, new THREE.ShaderMaterial({
      uniforms: { uPx: U.px },
      vertexShader: `attribute float aA; uniform float uPx; varying float vA; void main(){ vA = aA; gl_PointSize = (2. + aA * 2.5) * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `varying float vA; void main(){ if (vA <= 0.) discard; float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d) * vA; gl_FragColor = vec4(vec3(1., .55, .2) * 2.2 * a, 1.); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    this.emberPts.frustumCulled = false;
    this.group.add(this.emberPts);

    // smoke
    this.smoke = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xaaaaaa, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
      s.userData = { age: Math.random() * 9, life: 9, ox: 0 };
      this.smoke.push(s); this.group.add(s);
    }
    this.acc = 0;
  }
  hit(x, y) { const dx = (x - FIRE.x) * A, dy = y - (FIRE.y - 0.03); return Math.hypot(dx, dy * 1.2) < 0.06; }
  stoke() { this.boost = 1; for (let i = 0; i < 60; i++) this.spawn(true); }
  spawn(burst) {
    const e = this.em.find(e => e.life <= 0); if (!e) return;
    e.life = e.max = (burst ? 1.2 : 1.4) + Math.random() * 1.8; e.age = 0;
    e.p.set((Math.random() - 0.5) * 0.03, 0.02 + Math.random() * 0.03);
    e.v.set((Math.random() - 0.5) * (burst ? 0.12 : 0.03), (burst ? 0.16 : 0.05) + Math.random() * (burst ? 0.16 : 0.07));
  }
  update(dt, t, env) {
    this.boost = Math.max(0, this.boost - dt * 0.45);
    const f = 0.82 + 0.12 * Math.sin(t * 9.3) * Math.sin(t * 5.1 + 1) + 0.08 * Math.sin(t * 17.7) + (Math.random() - 0.5) * 0.08;
    this.flicker += (f - this.flicker) * Math.min(1, dt * 12);
    const inten = this.flicker * (1 + this.boost * 0.7) * (1 - env.rain * 0.2);
    this.inten = inten;
    const dark = Math.min(1, env.night * 1.2 + 0.1);
    for (const fl of this.flames) {
      fl.material.uniforms.uInt.value = inten * (0.85 + 0.25 * dark) * (fl.userData.s < 1 ? 0.6 : 1);
      fl.scale.y = 0.17 * fl.userData.s * (0.92 + 0.1 * this.flicker + this.boost * 0.45);
    }
    this.glow.material.opacity = (0.015 + dark * 0.11) * inten;
    this.acc += dt * (5 + this.boost * 18);
    while (this.acc > 1) { this.spawn(false); this.acc -= 1; }
    for (let i = 0; i < this.N; i++) {
      const e = this.em[i];
      if (e.life > 0) {
        e.life -= dt; e.age += dt;
        e.v.x += (Math.sin(t * 3 + i) * 0.03 + env.wind * 0.02) * dt; e.v.y -= 0.01 * dt;
        e.v.multiplyScalar(1 - dt * 0.5);
        e.p.addScaledVector(e.v, dt);
        this.ePos[i * 3] = e.p.x; this.ePos[i * 3 + 1] = e.p.y;
        this.eA[i] = Math.max(0, e.life / e.max) * (0.55 + 0.45 * Math.sin(e.age * 23 + i));
      } else this.eA[i] = 0;
    }
    this.emberPts.geometry.attributes.position.needsUpdate = true;
    this.emberPts.geometry.attributes.aA.needsUpdate = true;
    const sa = (0.035 + env.rain * 0.03) * (1 - env.night * 0.55);
    for (const s of this.smoke) {
      const u = s.userData; u.age += dt;
      if (u.age > u.life) { u.age = 0; u.ox = (Math.random() - 0.5) * 0.02; }
      const k = u.age / u.life;
      s.position.set(u.ox + k * k * (0.12 + env.wind * 0.18) + Math.sin(k * 5 + u.ox * 90) * 0.012, 0.1 + k * 0.3, 0);
      s.scale.setScalar(0.04 + k * 0.24);
      s.material.opacity = sa * Math.sin(Math.PI * k) * (1 - k * 0.3);
      s.material.color.copy(env.smokeColor);
    }
  }
}

// Instanced soft streaks / flakes that cover the current view window.
function particleField(count, frag, vert, uniforms, blending = THREE.NormalBlending) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, blending }));
  m.frustumCulled = false;
  return m;
}

export function createRain(count, U) {
  return particleField(count, /* glsl */`
      uniform vec3 uLight; varying vec2 vUv; varying float vA;
      void main(){ float x = abs(vUv.x - .5) * 2.; float a = (1. - x * x) * smoothstep(0., .3, vUv.y) * smoothstep(1., .6, vUv.y) * vA;
        gl_FragColor = vec4(uLight, a); }`, /* glsl */`
      attribute vec4 aSeed; uniform float uTime, uAmt; uniform vec4 uView; uniform float uWind;
      varying vec2 vUv; varying float vA;
      void main(){
        vUv = uv;
        float layer = aSeed.z * aSeed.z;            // most streaks far away
        float speed = mix(0.9, 2.4, layer);
        float len = mix(0.025, 0.11, layer);
        float wid = mix(0.0007, 0.0028, layer);
        float H = uView.w + len + 0.1;
        float y = mod(aSeed.y * H + uTime * speed, H);
        vec2 c = vec2(uView.x + aSeed.x * uView.z, uView.y - y + len);
        float slant = 0.14 + uWind * 0.12;
        c.x += (y) * slant;
        c.x = uView.x + mod(c.x - uView.x, uView.z);
        vec3 p = position;
        vec2 dir = normalize(vec2(-slant, 1.));
        vec2 side = vec2(dir.y, -dir.x);
        vec2 w = c + side * p.x * wid + dir * p.y * len;
        vA = step(aSeed.w, uAmt) * mix(0.22, 0.09, layer);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 0., 1.);
      }`, { uTime: U.time, uAmt: { value: 0 }, uView: U.view, uWind: U.wind, uLight: { value: new THREE.Color(0.8, 0.82, 0.85) } });
}

export function createSnow(count, U) {
  return particleField(count, /* glsl */`
      uniform vec3 uLight; varying vec2 vUv; varying float vA; varying float vL;
      void main(){ float d = length(vUv - .5) * 2.; float a = smoothstep(1., mix(.2, .0, vL), d) * vA;
        gl_FragColor = vec4(uLight, a); }`, /* glsl */`
      attribute vec4 aSeed; uniform float uTime, uAmt, uWind; uniform vec4 uView;
      varying vec2 vUv; varying float vA; varying float vL;
      void main(){
        vUv = uv;
        float layer = pow(aSeed.z, 3.);
        vL = layer;
        float size = mix(0.0035, 0.03, layer);
        float speed = mix(0.025, 0.11, layer);
        float H = uView.w + size * 2.;
        float y = mod(aSeed.y * H + uTime * speed, H);
        vec2 c = vec2(uView.x + aSeed.x * uView.z, uView.y - y + size);
        c.x += sin(uTime * (0.4 + aSeed.w) + aSeed.w * 30.) * 0.02 * (0.3 + layer) - uTime * (0.006 + uWind * 0.02) * (0.5 + layer);
        c.x = uView.x + mod(c.x - uView.x, uView.z);
        vec2 w = c + (position.xy - vec2(0., .5)) * size;
        vA = step(aSeed.w, uAmt) * mix(0.85, 0.35, layer);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 0., 1.);
      }`, { uTime: U.time, uAmt: { value: 0 }, uView: U.view, uWind: U.wind, uLight: { value: new THREE.Color(1, 1, 1) } });
}

export function createFireflies(count, U) {
  return particleField(count, /* glsl */`
      varying vec2 vUv; varying float vA;
      void main(){ float d = length(vUv - .5) * 2.; float a = (smoothstep(1., 0., d) * .45 + smoothstep(.25, 0., d)) * vA;
        gl_FragColor = vec4(vec3(.9, 1., .45) * a * 1.6, 1.); }`, /* glsl */`
      attribute vec4 aSeed; uniform float uTime, uAmt;
      varying vec2 vUv; varying float vA;
      void main(){
        vUv = uv;
        float t = uTime * (0.12 + aSeed.w * 0.1) + aSeed.w * 50.;
        vec2 c = vec2((0.05 + aSeed.x * 0.9) * ${A.toFixed(4)}, -(0.55 + aSeed.y * 0.32));
        c += vec2(sin(t) * 0.03 + sin(t * 2.3) * 0.01, sin(t * 1.7) * 0.012);
        float blink = smoothstep(0.55, 1., sin(uTime * (0.6 + aSeed.z) + aSeed.z * 30.));
        vA = blink * step(aSeed.w, uAmt);
        float s = mix(0.008, 0.016, aSeed.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(c + position.xy * s, 0., 1.);
      }`, { uTime: U.time, uAmt: { value: 0 } }, THREE.AdditiveBlending);
}

// Out-of-focus grass blades along the bottom edge; they sway and part around the cursor.
export function createGrass(count, U) {
  const m = particleField(count, /* glsl */`
      uniform vec3 uBase, uTip; varying vec2 vUv; varying float vA;
      void main(){
        float x = abs(vUv.x - .5) * 2.;
        float w = 1. - vUv.y * 0.85;
        float a = smoothstep(w, w * 0.2, x) * smoothstep(1., .75, vUv.y) * vA;
        vec3 c = mix(uBase, uTip, smoothstep(0., 1., vUv.y));
        gl_FragColor = vec4(c, a);
      }`, /* glsl */`
      attribute vec4 aSeed; uniform float uTime, uWind, uCursorOn, uAmt; uniform vec2 uCursor; uniform vec4 uGust, uView;
      varying vec2 vUv; varying float vA;
      ${NOISE}
      void main(){
        vUv = uv;
        float bx = uView.x + aSeed.x * uView.z;
        float by = uView.y - uView.w - 0.02;
        float h = mix(0.09, 0.26, aSeed.y) * uAmt;
        float wd = mix(0.007, 0.016, aSeed.z);
        float t = position.y + .5;   // 0..1 along blade
        float gust = vnoise(vec2(bx * 2. - uTime * 0.5, uTime * 0.1));
        float bend = (sin(uTime * (1.2 + aSeed.w) + bx * 9.) * 0.5 + 0.5) * (0.25 + gust) * (0.4 + uWind) * 0.06;
        vec2 dc = vec2(bx, by + h * 0.7) - uCursor;
        float cd = length(dc);
        bend += sign(dc.x) * exp(-cd * cd / 0.01) * 0.12 * uCursorOn;
        float gAge = uTime - uGust.z;
        if (gAge > 0. && gAge < 5.){ float gx = abs(bx - uGust.x) - gAge * 0.8; bend += sign(bx - uGust.x) * exp(-gx * gx * 30.) * exp(-gAge * .7) * 0.08; }
        bend += (aSeed.w - .5) * 0.05;
        vec2 p = vec2(bx + position.x * wd * (1. - t * 0.8) + bend * t * t, by + t * h - abs(bend) * t * t * 0.3);
        vA = mix(0.9, 0.65, aSeed.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 0., 1.);
      }`, {
    uTime: U.time, uWind: U.wind, uView: U.view, uCursor: U.cursorO, uCursorOn: U.cursorOn, uGust: U.gustO, uAmt: { value: 1 },
    uBase: { value: new THREE.Color(0.05, 0.07, 0.02) }, uTip: { value: new THREE.Color(0.2, 0.25, 0.08) },
  });
  return m;
}

export class Birds {
  constructor(scene) {
    this.mat = new THREE.LineBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.85, depthTest: false });
    this.birds = Array.from({ length: 7 }, () => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      const l = new THREE.Line(g, this.mat); l.frustumCulled = false; l.visible = false; scene.add(l);
      return { l, ph: Math.random() * 6, off: new THREE.Vector2() };
    });
    this.next = 8 + Math.random() * 12; this.active = false;
  }
  launch() {
    this.active = true; this.t = 0; this.dur = 26 + Math.random() * 14;
    const ltr = Math.random() < 0.5;
    const y = -(0.1 + Math.random() * 0.14);
    this.from = new THREE.Vector2(ltr ? -0.1 : A + 0.1, y);
    this.to = new THREE.Vector2(ltr ? A + 0.1 : -0.1, y + (Math.random() - 0.3) * 0.08);
    this.scale = 0.006 + Math.random() * 0.004;
    this.birds.forEach((b, i) => b.off.set((ltr ? -1 : 1) * i * 0.022 + (Math.random() - 0.5) * 0.01, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.008));
  }
  update(dt, t, allowed, light) {
    this.mat.color.setRGB(0.08 * light, 0.085 * light, 0.1 * light);
    if (!this.active) { this.next -= dt; if (this.next <= 0) { if (allowed) this.launch(); else this.next = 20; } return; }
    this.t += dt; const k = this.t / this.dur;
    if (k >= 1) { this.active = false; this.birds.forEach(b => (b.l.visible = false)); this.next = 40 + Math.random() * 60; return; }
    const lead = this.from.clone().lerp(this.to, k);
    lead.y += Math.sin(k * Math.PI) * 0.03;
    for (const b of this.birds) {
      const p = lead.clone().add(b.off); p.y += Math.sin(t * 0.8 + b.ph) * 0.003;
      const flap = Math.sin(t * 8 + b.ph * 3) * (Math.sin(t * 0.9 + b.ph) > -0.3 ? 1 : 0.1);
      const s = this.scale, a = b.l.geometry.attributes.position.array;
      a.set([p.x - s, p.y + flap * s * 0.7, 0, p.x, p.y - s * 0.15, 0, p.x + s, p.y + flap * s * 0.7, 0]);
      b.l.geometry.attributes.position.needsUpdate = true; b.l.visible = true;
    }
  }
}

// A stone skipped across the lake, simulated on the ground plane and projected into the plate.
export class Stone {
  constructor(scene, hooks) {
    this.hooks = hooks;
    this.s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0x2a2826, transparent: true, depthTest: false }));
    this.s.visible = false; scene.add(this.s);
    this.active = false;
  }
  throw(ice) {
    this.active = true; this.ice = ice; this.sliding = false; this.skips = 0;
    this.X = 0.012 + (Math.random() - 0.5) * 0.01; this.Z = 0.16; this.h = 0.035;
    this.vX = (Math.random() - 0.35) * 0.05; this.vZ = 0.5 + Math.random() * 0.15; this.vh = 0.06;
  }
  update(dt) {
    if (!this.active) return;
    if (this.sliding) {
      const k = Math.max(0, 1 - dt * 0.55); this.vX *= k; this.vZ *= k; this.X += this.vX * dt; this.Z += this.vZ * dt; this.h = 0;
      if (this.vZ < 0.01) { this.active = false; setTimeout(() => (this.s.visible = false), 4000); }
    } else {
      this.vh -= 0.35 * dt;
      this.X += this.vX * dt; this.Z += this.vZ * dt; this.h += this.vh * dt;
      if (this.h <= 0 && this.vh < 0) {
        if (this.ice) {
          this.hooks.ice(this.X, this.Z, Math.min(1, -this.vh / 0.15));
          if (-this.vh > 0.04) { this.vh = -this.vh * 0.3; this.h = 0; } else { this.sliding = true; this.hooks.slide(this.X, this.Z, this.vZ); }
        } else if (this.vZ > 0.13 && this.skips < 12) {
          this.skips++; this.hooks.splash(this.X, this.Z, Math.max(0.4, 1.15 - this.skips * 0.07));
          this.vh = Math.max(0.025, -this.vh * 0.6 + this.vZ * 0.02); this.vZ *= 0.86; this.vX *= 0.86; this.h = 0;
        } else { this.hooks.splash(this.X, this.Z, 1.2, true); this.active = false; this.s.visible = false; return; }
      }
    }
    const p = fromGround(this.X, this.Z, this.h);
    const size = 0.0035 / this.Z;
    this.s.position.set(p.x * A, -p.y, 0); this.s.scale.set(size * 1.4, size * 0.7, 1); this.s.visible = true;
  }
}
