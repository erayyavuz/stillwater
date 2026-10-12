import * as THREE from 'three';
import { SILL_Y } from './room.js';

// Tea: a full cup that can be knocked over, a teapot that refills it, and tea that runs
// across the sill (shallow-water on a grid), pools around things, stains and drips off the edge.
const GX0 = -0.95, GX1 = 0.95, GZ0 = 0.05, GZ1 = 0.42, CELL = 0.0065;
const NX = Math.round((GX1 - GX0) / CELL), NZ = Math.round((GZ1 - GZ0) / CELL);
const HMIN = 0.0011;       // a film thinner than this no longer spreads
const CUP_ML = 140e-6;     // m^3
const TEA = new THREE.Color(0x5a2a0c);

function recenter(o, center) {
  const g = new THREE.Group();
  o.updateMatrixWorld(true);
  const m = o.matrixWorld.clone();
  o.removeFromParent();
  o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
  o.applyMatrix4(m);
  o.position.sub(center);
  g.add(o);
  return g;
}
function bboxOf(o) { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); }

export class Tea {
  constructor(scene, teaScene, audio) {
    this.scene = scene; this.audio = audio;
    const get = (n) => teaScene.getObjectByName(n);
    teaScene.updateMatrixWorld(true);
    // cup: bowl centre is a rim-radius in from the side away from the handle
    const cupO = get('tea_set_01_cup_small_01'), cb = bboxOf(cupO);
    const cupC = new THREE.Vector3((cb.min.x + cb.max.x) / 2, cb.min.y, cb.max.z - 0.0535);
    const sauO = get('tea_set_01_saucer_circular_04'), sb = bboxOf(sauO);
    const sauC = new THREE.Vector3((sb.min.x + sb.max.x) / 2, sb.min.y, (sb.min.z + sb.max.z) / 2);
    const potO = get('tea_set_01_teapot_01'), pb = bboxOf(potO);
    const potC = new THREE.Vector3((pb.min.x + pb.max.x) / 2, pb.min.y, pb.min.z + 0.129);
    const lidO = get('tea_set_01_teapot_01_lid');
    this.cup = recenter(cupO, cupC);
    this.saucer = recenter(sauO, sauC);
    this.pot = recenter(potO, potC);
    this.pot.add(recenter(lidO, potC).children[0]);
    this.spoutLocal = new THREE.Vector3(0, 0.114 - pb.min.y + 0.004, pb.max.z - potC.z - 0.004);
    this.rimY = cb.max.y - cb.min.y - 0.003;
    this.samples = [];
    this.cup.traverse(m => { if (m.isMesh) { const p = m.geometry.attributes.position; m.updateMatrix(); const step = Math.max(1, Math.floor(p.count / 300)); for (let i = 0; i < p.count; i += step) this.samples.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrix)); } });

    // tea surface in the cup (stays level)
    this.surfMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSky: { value: new THREE.Color() }, uWarm: { value: new THREE.Color(1, 0.6, 0.3) }, uWarmAmt: { value: 0 }, uLights: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uStir: { value: 0 } },
      vertexShader: `varying vec3 vW; varying vec2 vP; void main(){ vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime, uWarmAmt, uStir; uniform vec3 uSky, uWarm; uniform vec3 uLights[2]; varying vec3 vW; varying vec2 vP;
        void main(){
          float r = length(vP);
          vec3 n = normalize(vec3(sin(r * 60. - uTime * 6.) * 0.03 * uStir + vP.x * 0.4 * smoothstep(.7, 1., r), 1., vP.y * 0.4 * smoothstep(.7, 1., r)));
          vec3 v = normalize(cameraPosition - vW);
          float f = 0.02 + 0.98 * pow(1. - max(dot(n, v), 0.), 5.);
          vec3 base = vec3(.16, .06, .015) * (0.6 + 0.4 * smoothstep(1., .5, r));
          vec3 col = base + uSky * f * 0.9;
          for (int i = 0; i < 2; i++){ vec3 l = normalize(uLights[i] - vW); vec3 h = normalize(l + v); col += uWarm * pow(max(dot(n, h), 0.), 180.) * uWarmAmt * 3.; }
          col = mix(col, base * 0.5, smoothstep(.9, 1., r));
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.surf = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.surfMat);
    this.surf.rotation.x = -Math.PI / 2;
    this.scene.add(this.surf);

    // falling tea: instanced drops stretched along their velocity
    this.MAXP = 700;
    this.parts = [];
    this.dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3a1806, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 3 }), this.MAXP);
    this.dropMesh.frustumCulled = false; this.dropMesh.count = 0;
    scene.add(this.dropMesh);

    // the puddle grid
    this.h = new Float32Array(NX * NZ);
    this.b = new Float32Array(NX * NZ);
    this.stain = new Float32Array(NX * NZ);
    this.block = new Uint8Array(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = GX0 + (i + 0.5) * CELL, z = GZ0 + (j + 0.5) * CELL;
      // the stool runs a few millimetres downhill toward the room, with an uneven worn surface
      this.b[j * NX + i] = -(z - GZ0) * 0.006 + (Math.sin(x * 37 + z * 11) * 0.5 + Math.sin(x * 91 - z * 53) * 0.3 + Math.sin(x * 13) * 0.4) * 0.00022;
    }
    this.texData = new Uint8Array(NX * NZ * 4);
    this.tex = new THREE.DataTexture(this.texData, NX, NZ, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.puddleMat = new THREE.ShaderMaterial({
      uniforms: { tH: { value: this.tex }, uTexel: { value: new THREE.Vector2(1 / NX, 1 / NZ) }, uSky: { value: new THREE.Color() }, uWarm: { value: new THREE.Color(1, 0.6, 0.3) }, uWarmAmt: { value: 0 }, uLights: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uLightK: { value: [0, 0] }, uWin: { value: new THREE.Vector3(0, 1.55, 0) } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D tH; uniform vec2 uTexel; uniform vec3 uSky, uWarm, uWin; uniform float uWarmAmt; uniform vec3 uLights[2]; uniform float uLightK[2];
        varying vec2 vUv; varying vec3 vW;
        float H(vec2 p){ return texture2D(tH, p).r; }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        void main(){
          vec4 t = texture2D(tH, vUv);
          float h = t.r, stain = t.g;
          float nz = noise(vW.xz * 160.) * 0.6 + noise(vW.xz * 420.) * 0.4;
          float wet = smoothstep(0.035, 0.09, h + (nz - 0.5) * 0.06);
          float dx = H(vUv + vec2(uTexel.x, 0.)) - H(vUv - vec2(uTexel.x, 0.));
          float dz = H(vUv + vec2(0., uTexel.y)) - H(vUv - vec2(0., uTexel.y));
          // a meniscus at the edge bends the surface; the middle is flat as glass
          vec3 n = normalize(vec3(-dx * 3.5, 1., -dz * 3.5));
          vec3 v = normalize(cameraPosition - vW);
          float f = 0.02 + 0.98 * pow(1. - max(dot(n, v), 0.), 5.);
          vec3 r = reflect(-v, n);
          vec3 tw = normalize(uWin - vW);
          float win = smoothstep(0.82, 0.96, dot(r, tw));
          vec3 spec = uSky * (f * 1.2 + win * (0.5 + f * 2.)) ;
          for (int i = 0; i < 2; i++){ vec3 l = normalize(uLights[i] - vW); vec3 hh = normalize(l + v); spec += uWarm * pow(max(dot(n, hh), 0.), 400.) * uLightK[i] * 6.; }
          float depth = smoothstep(0.05, 0.6, h);
          vec3 tea = mix(vec3(.10, .04, .012), vec3(.05, .018, .005), depth);
          vec3 col = tea * (0.6 + uWarmAmt * 0.6) + spec;
          float a = wet * (0.5 + 0.42 * depth);
          // a darker line where the edge meets the wood
          float edge = wet * (1. - smoothstep(0.06, 0.16, h + (nz - 0.5) * 0.06));
          col *= 1. - edge * 0.35; a = max(a, edge * 0.75);
          // a dried ring stays behind
          float st = (1. - wet) * smoothstep(0.05, 0.6, stain);
          col = mix(col, vec3(.09, .035, .012), st * (1. - wet));
          a = max(a, st * 0.32);
          if (a < 0.003) discard;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    const pg = new THREE.PlaneGeometry(GX1 - GX0, GZ1 - GZ0);
    pg.rotateX(-Math.PI / 2);
    this.puddle = new THREE.Mesh(pg, this.puddleMat);
    this.puddle.position.set((GX0 + GX1) / 2, SILL_Y + 0.0004, (GZ0 + GZ1) / 2);
    this.puddle.renderOrder = 2;
    // uv v runs from +z (0) to -z (1) after rotation; flip so row j maps to z ascending
    const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    scene.add(this.puddle);

    this.fill = 1; this.state = 'full';       // full | tipping | tipped | righting | pouring
    this.tip = 0; this.tipT = 0; this.potT = 0;
    this.active = false; this.dirty = true;
    this.hang = new Map();
  }

  place(cupX, cupZ, potX, potZ) {
    this.base = new THREE.Vector3(cupX, SILL_Y, cupZ);
    this.saucer.position.set(cupX, SILL_Y, cupZ); this.saucer.rotation.y = -0.4;
    this.cupHome = new THREE.Vector3(cupX, SILL_Y + 0.0135, cupZ);
    this.cup.position.copy(this.cupHome); this.cup.rotation.set(0, -0.4 + Math.PI, 0);
    this.pot.position.set(potX, SILL_Y, potZ);
    this.pot.rotation.y = Math.PI / 2; // spout toward +x, the cup
    this.potHome = this.pot.position.clone();
    this.scene.add(this.saucer, this.cup, this.pot);
    for (const o of [this.saucer, this.cup, this.pot]) o.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
    this.cup.traverse(m => (m.userData.prop = 'cup'));
    this.saucer.traverse(m => (m.userData.prop = 'cup'));
    this.pot.traverse(m => (m.userData.prop = 'pot'));
    // things the tea has to flow around
    this.addBlock(potX, potZ, 0.085);
  }
  addBlock(x, z, r) {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const cx = GX0 + (i + 0.5) * CELL, cz = GZ0 + (j + 0.5) * CELL;
      if (Math.hypot(cx - x, cz - z) < r) this.block[j * NX + i] = 1;
    }
  }
  addBlockRect(x, z, w, d, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const dx = GX0 + (i + 0.5) * CELL - x, dz = GZ0 + (j + 0.5) * CELL - z;
      const u = dx * c - dz * s, v = dx * s + dz * c;
      if (Math.abs(u) < w / 2 && Math.abs(v) < d / 2) this.block[j * NX + i] = 1;
    }
  }

  // ---------------------------------------------------------------- actions
  click(what) {
    if (this.state === 'full' && what === 'cup' && this.fill > 0.25) { this.knock(); return 'spill'; }
    if (this.state === 'tipped') { this.state = 'righting'; this.tipT = 0; this.audio.clatter && this.audio.clatter(0.5); return 'right'; }
    if ((this.state === 'full' || this.state === 'empty') && this.fill < 0.95) { this.state = 'pouring'; this.potT = 0; return 'pour'; }
    if (what === 'pot') return 'full';
    return null;
  }
  knock() {
    this.state = 'tipping'; this.tipT = 0;
    // fall toward the room, a little to the right
    this.tipDir = new THREE.Vector3(1, 0, 0.55).normalize();
    this.axis = new THREE.Vector3(0, 1, 0).cross(this.tipDir).normalize();
    this.spillLeft = this.fill * CUP_ML;
  }

  emit(p, v, vol) {
    if (this.parts.length >= this.MAXP) return;
    this.parts.push({ p: p.clone(), v: v.clone(), vol, r: Math.min(0.0028, Math.cbrt(vol * 0.75 / Math.PI) * 0.8) });
  }

  cell(x, z) {
    const i = Math.floor((x - GX0) / CELL), j = Math.floor((z - GZ0) / CELL);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1;
    return j * NX + i;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, t, env) {
    const A = this.audio;
    // cup animation
    if (this.state === 'tipping' || this.state === 'tipped' || this.state === 'righting') {
      this.tipT += dt;
      let ang;
      if (this.state === 'tipping') {
        const k = Math.min(1, this.tipT / 0.42);
        ang = k * k * 1.68; // accelerating fall
        if (k >= 1) { this.state = 'tipped'; this.tipT = 0; A.clatter && A.clatter(1); A.splash && A.splash(1); }
      } else if (this.state === 'tipped') {
        ang = 1.68 + Math.sin(Math.min(1, this.tipT / 0.25) * Math.PI) * -0.06;
      } else {
        const k = Math.min(1, this.tipT / 0.7);
        ang = 1.68 * (1 - (k * k * (3 - 2 * k)));
        if (k >= 1) { this.state = 'empty'; setTimeout(() => { if (this.state === 'empty') { this.state = 'pouring'; this.potT = 0; } }, 500); }
      }
      this.tip = ang;
      // pivot about the bottom edge in the tip direction
      const pivot = this.cupHome.clone().addScaledVector(this.tipDir, 0.026);
      const q = new THREE.Quaternion().setFromAxisAngle(this.axis, ang);
      const off = this.cupHome.clone().sub(pivot).applyQuaternion(q);
      this.cup.position.copy(pivot).add(off);
      // it slides off the saucer as it goes over
      const slide = Math.min(1, ang / 1.68);
      this.cup.position.addScaledVector(this.tipDir, slide * 0.045);
      this.cup.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.4 + Math.PI));
      // rest on whatever is lowest: never through the sill (or the saucer, early on)
      this.cup.updateMatrixWorld();
      let lo = 1e9; const w = new THREE.Vector3();
      for (const sp of this.samples) { w.copy(sp).applyMatrix4(this.cup.matrixWorld); if (w.y < lo) lo = w.y; }
      const floorY = SILL_Y + (slide < 0.5 ? 0.0135 * (1 - slide * 2) : 0) + 0.0004;
      this.cup.position.y += floorY - lo;
      // tea pours from the lowest point of the rim once the cup leans far enough
      if (this.spillLeft > 0 && ang > 0.75) {
        const rate = Math.max(CUP_ML * 0.12, this.spillLeft * 2.2) * dt;
        const vol = Math.min(this.spillLeft, rate);
        this.spillLeft -= vol; this.fill = this.spillLeft / CUP_ML;
        const lip = this.lowestRim();
        const n = Math.max(1, Math.round(vol / 1.2e-7));
        for (let i = 0; i < n; i++) {
          const v = this.tipDir.clone().multiplyScalar(0.04 + Math.random() * 0.1).add(new THREE.Vector3((Math.random() - 0.5) * 0.05, -0.05, (Math.random() - 0.5) * 0.05));
          this.emit(lip.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.012, 0, (Math.random() - 0.5) * 0.012)), v, vol / n);
        }
        if (A.gush) A.gush(vol / dt / CUP_ML);
      }
    } else {
      this.cup.position.copy(this.cupHome);
      this.cup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.4 + Math.PI);
    }

    // teapot pour
    if (this.state === 'pouring') {
      this.potT += dt;
      const T = this.potT;
      const lift = Math.min(1, T / 0.5) * (T > 3.4 ? Math.max(0, 1 - (T - 3.4) / 0.6) : 1);
      const tilt = (T < 0.5 ? 0 : Math.min(1, (T - 0.5) / 0.6)) * (T > 3.0 ? Math.max(0, 1 - (T - 3.0) / 0.5) : 1);
      this.pot.position.copy(this.potHome).add(new THREE.Vector3(0.03 * lift, 0.07 * lift, 0));
      this.pot.rotation.set(0, Math.PI / 2, 0);
      this.pot.rotateX(0.62 * tilt);
      if (tilt > 0.55 && T < 3.1 && this.fill < 1) {
        const spout = this.pot.localToWorld(this.spoutLocal.clone());
        const dir = this.cupHome.clone().add(new THREE.Vector3(0, this.rimY + 0.02, 0)).sub(spout);
        const flight = 0.16;
        const v = new THREE.Vector3(dir.x / flight, (dir.y + 4.9 * flight * flight) / flight, dir.z / flight);
        const vol = CUP_ML * 0.45 * dt;
        const n = 4;
        for (let i = 0; i < n; i++) this.emit(spout, v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02)), vol / n);
        if (A.pour) A.pour(this.fill);
      }
      if (T > 4.1) { this.state = this.fill > 0.25 ? 'full' : 'empty'; this.pot.position.copy(this.potHome); this.pot.rotation.set(0, Math.PI / 2, 0); A.pourEnd && A.pourEnd(); }
    }

    // tea surface
    const upright = this.state === 'full' || this.state === 'pouring' || this.state === 'empty';
    this.surf.visible = upright && this.fill > 0.04;
    if (this.surf.visible) {
      const y = 0.012 + this.fill * (this.rimY - 0.018);
      const r = 0.031 + (0.0485 - 0.031) * Math.min(1, y / (this.rimY - 0.004));
      this.surf.position.copy(this.cupHome).add(new THREE.Vector3(0, y, 0));
      this.surf.scale.setScalar(r);
    }
    this.surfMat.uniforms.uTime.value = t;
    this.surfMat.uniforms.uStir.value = this.state === 'pouring' ? 1 : Math.max(0, this.surfMat.uniforms.uStir.value - dt * 0.4);

    // falling tea
    const G = 9.8;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    let n = 0;
    const keep = [];
    for (const P of this.parts) {
      P.v.y -= G * dt;
      P.p.addScaledVector(P.v, dt);
      // caught by the cup while pouring
      if (this.state === 'pouring' || this.state === 'full' || this.state === 'empty') {
        const dx = P.p.x - this.cupHome.x, dz = P.p.z - this.cupHome.z;
        if (P.v.y < 0 && P.p.y < this.cupHome.y + this.rimY && P.p.y > this.cupHome.y && dx * dx + dz * dz < 0.045 * 0.045) { this.fill = Math.min(1, this.fill + P.vol / CUP_ML); continue; }
      }
      const c = this.cell(P.p.x, P.p.z);
      const floor = c >= 0 && !this.block[c] ? SILL_Y + this.h[c] : (P.p.z > GZ1 || P.p.x < GX0 || P.p.x > GX1 ? SILL_Y - 0.9 : SILL_Y + 0.02);
      if (P.p.y <= floor) {
        if (c >= 0 && !this.block[c]) {
          this.h[c] += P.vol / (CELL * CELL); this.active = true;
          if (Math.random() < 0.08 && A.plink) A.plink(0.3);
        } else if (P.p.y < SILL_Y - 0.5) { if (A.drip && Math.random() < 0.5) A.drip(0.5); }
        continue;
      }
      keep.push(P);
      if (n < this.MAXP) {
        const sp = P.v.length();
        q.setFromUnitVectors(up, sp > 1e-4 ? P.v.clone().divideScalar(sp) : up);
        sc.set(P.r, P.r * (1 + Math.min(6, sp * 0.012 / P.r)), P.r);
        m4.compose(P.p, q, sc);
        this.dropMesh.setMatrixAt(n++, m4);
      }
    }
    this.parts = keep;
    this.dropMesh.count = n;
    this.dropMesh.instanceMatrix.needsUpdate = true;

    // the puddle
    if (this.active) this.flow(dt);
    // shading inputs
    const pu = this.puddleMat.uniforms, su = this.surfMat.uniforms;
    pu.uSky.value.copy(env.sky); su.uSky.value.copy(env.sky);
    pu.uWarmAmt.value = env.warm; su.uWarmAmt.value = env.warm;
    pu.uLights.value[0].copy(env.lamp); pu.uLights.value[1].copy(env.candle);
    su.uLights.value[0].copy(env.lamp); su.uLights.value[1].copy(env.candle);
    pu.uLightK.value[0] = env.lampK; pu.uLightK.value[1] = env.candleK;
  }

  lowestRim() {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const p = this.cup.localToWorld(new THREE.Vector3(Math.cos(a) * 0.05, this.rimY, Math.sin(a) * 0.05));
      if (!best || p.y < best.y) best = p;
    }
    return best;
  }

  flow(dt) {
    const { h, b, block, stain } = this;
    const steps = Math.min(8, Math.ceil(dt * 240));
    const q = 0.22;
    let any = false, edgeLoss = 0;
    for (let s = 0; s < steps; s++) {
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        const hk = h[k];
        if (hk < HMIN || block[k]) continue;
        any = true;
        const lk = hk + b[k];
        // push to lower neighbours, never thinner than the film can sustain
        let avail = (hk - HMIN * 0.6) * q;
        const nb = [i > 0 ? k - 1 : -1, i < NX - 1 ? k + 1 : -1, j > 0 ? k - NX : -1, j < NZ - 1 ? k + NX : -2];
        for (const m of nb) {
          if (m === -2) {
            // front edge: tea runs over the nosing and gathers into a hanging drop
            const over = Math.max(0, hk - HMIN * 1.1) * 0.12;
            if (over > 0) { h[k] -= over; edgeLoss += over; const hv = (this.hang.get(i) || 0) + over * CELL * CELL; this.hang.set(i, hv); }
            continue;
          }
          if (m < 0 || block[m]) continue;
          const d = lk - (h[m] + b[m]);
          if (d <= 0) continue;
          const f = Math.min(avail, d * q * 0.5);
          if (f <= 0) continue;
          h[k] -= f; h[m] += f; avail -= f;
        }
      }
    }
    // hanging drops let go when heavy enough
    for (const [i, v] of this.hang) {
      if (v > 0.06e-6) {
        this.hang.delete(i);
        this.emit(new THREE.Vector3(GX0 + (i + 0.5) * CELL, SILL_Y - 0.052, GZ1 + 0.004), new THREE.Vector3(0, -0.2, 0.02), v);
      }
    }
    // slow drying, leaving a stain where it sat
    let wetCells = 0;
    for (let k = 0; k < h.length; k++) {
      if (h[k] > 0) {
        h[k] = Math.max(0, h[k] - dt * 0.6e-6);
        stain[k] = Math.min(1, stain[k] + dt * 0.02 * Math.min(1, h[k] / HMIN));
        if (h[k] > 0) wetCells++;
      }
    }
    this.active = wetCells > 0 || this.parts.length > 0;
    // upload: R = height (0..6 mm), G = stain
    const d = this.texData;
    for (let k = 0; k < h.length; k++) { d[k * 4] = Math.min(255, h[k] / 0.006 * 255); d[k * 4 + 1] = stain[k] * 255; }
    this.tex.needsUpdate = true;
    return any;
  }
}
