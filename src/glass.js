import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { WIN } from './room.js';

// Shared glass space: both panes map into one texture covering the whole window (closed).
const GW = WIN.x1 - WIN.x0, GH = WIN.y1 - WIN.y0;
const RES = 1024;
const CELL = 0.012;

// ---------------------------------------------------------------------------
// Rain drops on the glass, simulated on the CPU and splatted as a height field (MAX blend).
export class Drops {
  constructor(renderer, max = 3200) {
    this.renderer = renderer;
    this.max = max;
    this.list = [];
    this.rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
    this.rt.texture.generateMipmaps = false;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, GW, GH, 0, -1, 1);
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position);
    this.inst = new Float32Array(max * 4);
    this.instAttr = new THREE.InstancedBufferAttribute(this.inst, 4); this.instAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aD', this.instAttr);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aD; varying vec2 vP; varying float vR;
        void main(){ vP = position.xy; vR = aD.z;
          vec2 p = aD.xy + position.xy * vec2(aD.z, aD.z * aD.w);
          // the tail of a sliding drop trails upward
          if (aD.w > 1.01 && position.y > 0.) { p.y += aD.z * (aD.w - 1.) * 0.6; p.x = aD.x + position.x * aD.z * 0.55; }
          gl_Position = projectionMatrix * vec4(p, 0., 1.); }`,
      fragmentShader: `varying vec2 vP; varying float vR;
        void main(){ float d = dot(vP, vP); if (d > 1.) discard;
          float h = sqrt(1. - d) * vR * 260.;
          gl_FragColor = vec4(h, 0., 0., 1.); }`,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.grid = new Map();
    this.spawnAcc = 0;
    this.clearStamps = []; // positions where sliding drops cleared the fog this frame
  }
  key(x, y) { return (Math.floor(x / CELL) * 4096 + Math.floor(y / CELL)) | 0; }
  rebuildGrid() {
    this.grid.clear();
    for (const d of this.list) {
      const k = this.key(d.x, d.y);
      let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(d);
    }
  }
  near(x, y, r, fn) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), n = Math.ceil(r / CELL);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const a = this.grid.get(((cx + i) * 4096 + (cy + j)) | 0);
      if (a) for (const d of a) fn(d);
    }
  }
  add(x, y, r) {
    if (this.list.length >= this.max) {
      // recycle the smallest static drop
      let k = 0; for (let i = 0; i < 40; i++) { const j = (Math.random() * this.list.length) | 0; if (!this.list[j].slide && this.list[j].r < this.list[k].r) k = j; }
      this.list.splice(k, 1);
    }
    const d = { x, y, r, slide: false, vy: 0, vx: 0, trail: 0, seed: Math.random(), dead: false, wob: 0 };
    this.list.push(d);
    return d;
  }
  merge(a, b) { a.r = Math.cbrt(a.r ** 3 + b.r ** 3); b.dead = true; }
  /** knock the glass: drops nearby shiver loose */
  knock(x, y, s = 1) {
    this.near(x, y, 0.18, d => {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < 0.18) {
        const k = (1 - dist / 0.18) * s;
        if (d.r > 0.003 && Math.random() < k) { d.slide = true; d.vy = -0.05 - 0.15 * k; }
        d.wob = Math.max(d.wob, k);
      }
    });
  }
  /** wipe: remove everything under a brush segment */
  wipe(ax, ay, bx, by, rad) {
    const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / (rad * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const x = ax + (bx - ax) * s / steps, y = ay + (by - ay) * s / steps;
      this.near(x, y, rad, d => { if (Math.hypot(d.x - x, d.y - y) < rad) d.dead = true; });
    }
    // a wiped stroke leaves a few streaky beads at its lower edge
    if (Math.random() < 0.5) this.add(bx + (Math.random() - 0.5) * rad, by - rad * (0.8 + Math.random() * 0.3), 0.0012 + Math.random() * 0.0015);
  }
  update(dt, rain, wind) {
    // new drops hit the glass
    this.spawnAcc += dt * rain * 260;
    while (this.spawnAcc > 1) {
      this.spawnAcc -= 1;
      const r = Math.random() < 0.8 ? 0.0009 + Math.random() * 0.0022 : 0.0028 + Math.random() * 0.0035;
      const x = Math.random() * GW, y = Math.random() * GH;
      let merged = null;
      this.near(x, y, r + 0.006, d => { if (!merged && !d.dead && Math.hypot(d.x - x, d.y - y) < d.r + r) merged = d; });
      if (merged) merged.r = Math.cbrt(merged.r ** 3 + r ** 3); else this.add(x, y, r);
    }
    this.rebuildGrid();
    this.clearStamps.length = 0;
    for (const d of this.list) {
      if (d.dead) continue;
      d.wob = Math.max(0, d.wob - dt * 3);
      if (!d.slide && d.r > 0.0058 && Math.random() < dt * 3) { d.slide = true; d.vy = -0.02; }
      // slow evaporation of the smallest beads when it is dry
      if (!d.slide && rain < 0.05) d.r -= dt * 0.00001;
      if (d.r < 0.0003) { d.dead = true; continue; }
      if (d.slide) {
        // stick-slip: the speed hesitates, then lurches
        const target = -Math.min(0.3, 0.02 + (d.r - 0.004) * 40) * (0.35 + 0.65 * Math.max(0, Math.sin(d.seed * 40 + d.y * 90)));
        d.vy += (target - d.vy) * Math.min(1, dt * 6);
        d.vx += ((Math.sin(d.y * 140 + d.seed * 9) * 0.02 + wind * 0.004) - d.vx) * Math.min(1, dt * 4);
        const oy = d.y;
        d.x += d.vx * dt; d.y += d.vy * dt;
        // swallow beads in the path
        this.near(d.x, d.y, d.r + 0.004, o => {
          if (o !== d && !o.dead && Math.hypot(o.x - d.x, o.y - d.y) < d.r + o.r * 0.9) {
            if (o.slide && o.r > d.r) return;
            this.merge(d, o);
          }
        });
        // leave a trail of tiny beads, losing a little water
        d.trail += oy - d.y;
        if (d.trail > 0.004 + Math.random() * 0.006) {
          d.trail = 0;
          if (Math.random() < 0.7) { const tr = d.r * (0.18 + Math.random() * 0.22); this.add(d.x + (Math.random() - 0.5) * d.r * 0.6, d.y + d.r * 1.3, tr); d.r = Math.cbrt(Math.max(0, d.r ** 3 - tr ** 3)); }
        }
        if (this.clearStamps.length < 192) this.clearStamps.push(d.x, d.y + d.r * 0.5, d.r * 1.05);
        if (d.r < 0.0042) { d.slide = false; d.vy = 0; }
        if (d.y < -0.01) d.dead = true;
      }
    }
    this.list = this.list.filter(d => !d.dead);
    // upload
    const n = Math.min(this.list.length, this.max);
    for (let i = 0; i < n; i++) {
      const d = this.list[i], j = i * 4;
      const wob = d.wob ? Math.sin(performance.now() * 0.05 + d.seed * 20) * d.wob * 0.25 : 0;
      this.inst[j] = d.x; this.inst[j + 1] = d.y; this.inst[j + 2] = d.r * (1 + wob);
      this.inst[j + 3] = d.slide ? 1.15 + Math.min(1.8, -d.vy * 9) : 1 - wob * 0.5;
    }
    this.geo.instanceCount = n;
    this.instAttr.needsUpdate = true;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }
}

// ---------------------------------------------------------------------------
// Condensation: R = mist on the glass (regrows to 1), G = breath haze (decays to 0).
export class Fog {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
    this.cam = new THREE.OrthographicCamera(0, GW, GH, 0, -1, 1);
    this.scene = new THREE.Scene();
    const quad = new THREE.PlaneGeometry(GW, GH); quad.translate(GW / 2, GH / 2, 0);
    // regrow: f' = f + k(1 - f) on R; breath decays: g' = g (1 - kb)
    this.grow = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      color: 0x000000, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor, depthTest: false, depthWrite: false,
    }));
    this.decay = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcColorFactor, depthTest: false, depthWrite: false,
    }));
    // brush stamps
    const circ = new THREE.CircleGeometry(1, 24);
    this.stampGeo = new THREE.InstancedBufferGeometry();
    this.stampGeo.index = circ.index; this.stampGeo.setAttribute('position', circ.attributes.position);
    this.stampData = new Float32Array(256 * 4);
    this.stampAttr = new THREE.InstancedBufferAttribute(this.stampData, 4); this.stampAttr.setUsage(THREE.DynamicDrawUsage);
    this.stampGeo.setAttribute('aS', this.stampAttr);
    const vert = `attribute vec4 aS; varying float vD; varying float vK;
      void main(){ vD = length(position.xy); vK = aS.w; gl_Position = projectionMatrix * vec4(aS.xy + position.xy * aS.z, 0., 1.); }`;
    // wipe: dst *= 1 - a (both channels)
    this.wipeMat = new THREE.ShaderMaterial({ vertexShader: vert,
      fragmentShader: `varying float vD; varying float vK; void main(){ float a = smoothstep(1., 0.45, vD) * vK; gl_FragColor = vec4(a, a, 0., a); }`,
      blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcColorFactor, depthTest: false, depthWrite: false });
    // breath: g' = g + a(1 - g), r' = r + a(1 - r)
    this.breathMat = new THREE.ShaderMaterial({ vertexShader: vert,
      fragmentShader: `varying float vD; varying float vK; void main(){ float a = smoothstep(1., 0.0, vD) * vK; gl_FragColor = vec4(a * .6, a, 0., 1.); }`,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor, depthTest: false, depthWrite: false });
    this.stampMesh = new THREE.Mesh(this.stampGeo, this.wipeMat); this.stampMesh.frustumCulled = false;
    this.wipes = []; this.breaths = [];
    renderer.setRenderTarget(this.rt); renderer.setClearColor(new THREE.Color(1, 0, 0), 1); renderer.clear(); renderer.setRenderTarget(null);
  }
  wipe(x, y, r, k = 1) { if (this.wipes.length < 1000) this.wipes.push(x, y, r, k); }
  breath(x, y, r, k) { if (this.breaths.length < 400) this.breaths.push(x, y, r, k); }
  flush(list, mat) {
    let n = 0;
    while (list.length && n < 256) { this.stampData.set(list.splice(0, 4), n * 4); n++; }
    if (!n) return;
    this.stampGeo.instanceCount = n; this.stampAttr.needsUpdate = true;
    this.stampMesh.material = mat;
    this.renderer.render(this.stampMesh, this.cam);
  }
  update(dt, growRate, decayRate, dropStamps) {
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.autoClear = false;
    const k = 1 - Math.exp(-growRate * dt);
    this.grow.material.color.setRGB(k, 0, 0);
    r.render(this.grow, this.cam);
    const kb = 1 - Math.exp(-decayRate * dt);
    this.decay.material.color.setRGB(0, kb, 0);
    r.render(this.decay, this.cam);
    for (let i = 0; i < dropStamps.length; i += 3) this.wipes.push(dropStamps[i], dropStamps[i + 1], dropStamps[i + 2], 0.35);
    while (this.wipes.length) this.flush(this.wipes, this.wipeMat);
    while (this.breaths.length) this.flush(this.breaths, this.breathMat);
    r.autoClear = true;
    r.setRenderTarget(prev);
  }
}

// ---------------------------------------------------------------------------
export function createGlassMaterial(drops, fog, outside) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDrops: { value: drops.rt.texture }, tFog: { value: fog.rt.texture },
      tOut: { value: outside.sharp }, tBlur: { value: outside.blur },
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
      uFogLevel: { value: 0.8 }, uDefocus: { value: 0.5 }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uWarm: { value: new THREE.Color(1, 0.6, 0.3) }, uWarmAmt: { value: 0 }, uSky: { value: new THREE.Color(0.6, 0.65, 0.7) },
      uGlow: { value: [new THREE.Vector4(-9, -9, 0, 0), new THREE.Vector4(-9, -9, 0, 0)] }, uNight: { value: 0 },
      uFrost: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform vec4 uRect; varying vec2 vG; varying vec2 vL;
      void main(){
        vL = uv;
        // glass-space coordinate (metres from the window's lower-left corner)
        vG = vec2(mix(uRect.x, uRect.z, uv.x), mix(uRect.y, uRect.w, uv.y));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDrops, tFog, tOut, tBlur;
      uniform vec2 uRes; uniform float uTime, uFogLevel, uDefocus, uWarmAmt, uNight, uFrost;
      uniform vec3 uWarm, uSky; uniform vec4 uGlow[2];
      varying vec2 vG; varying vec2 vL;
      ${NOISE}
      const vec2 GS = vec2(${GW.toFixed(4)}, ${GH.toFixed(4)});
      void main(){
        vec2 suv = gl_FragCoord.xy / uRes;
        vec2 t = vG / GS;
        vec2 px = 1. / vec2(${RES}.);
        float h = texture2D(tDrops, t).r;
        float hx = texture2D(tDrops, t + vec2(px.x, 0.)).r - texture2D(tDrops, t - vec2(px.x, 0.)).r;
        float hy = texture2D(tDrops, t + vec2(0., px.y)).r - texture2D(tDrops, t - vec2(0., px.y)).r;
        vec2 grad = vec2(hx, hy);
        float drop = smoothstep(0.02, 0.25, h);

        // condensation, broken into a dewy speckle as it forms
        vec2 fg = texture2D(tFog, t).rg;
        float dew = vnoise(vG * 900.) * 0.6 + vnoise(vG * 260.) * 0.4;
        float mist = smoothstep(dew * 0.55, dew * 0.55 + 0.45, fg.r) * uFogLevel;
        mist = max(mist, fg.g * 0.95);
        mist *= 1. - drop;
        // edges of the glass fog up first
        vec2 e = min(vL, 1. - vL);
        mist = max(mist, smoothstep(0.08, 0.0, min(e.x, e.y)) * uFogLevel * 0.6 * (1. - drop));

        // frost creeping in from the corners in winter
        float fr = 0.;
        if (uFrost > 0.01){
          float edge = min(e.x * 1.4, e.y);
          float fn = fbm(vG * 22.) * 0.6 + fbm(vG * 90.) * 0.4;
          fr = smoothstep(0.02, 0.0, edge - (fn - 0.25) * 0.22 * uFrost) * uFrost;
        }

        // refraction: drops act as tiny lenses (inverted, magnified view), sharp
        vec2 off = -grad * 0.022;
        vec3 sharp = texture2D(tOut, clamp(suv + off * (1. + drop * 2.), 0.001, 0.999)).rgb;
        vec3 soft = texture2D(tBlur, clamp(suv + off * 0.3, 0.001, 0.999)).rgb;
        vec3 view = mix(sharp, soft, clamp(uDefocus * (1. - drop * 0.85), 0., 1.));
        // drops: darker rims, bright cores
        float rim = smoothstep(0.1, 0.9, length(grad) * 5.) * drop;
        view *= 1. - rim * 0.3;
        view += soft * drop * (1. - rim) * 0.12;
        // light from inside caught by the drops (lamp/candle) and sky glints
        vec3 n = normalize(vec3(-grad * 6., 1.));
        float spec = pow(max(dot(n, normalize(vec3(-0.35, 0.5, 0.8))), 0.), 40.) * drop;
        view += uWarm * spec * uWarmAmt * 1.8 + uSky * pow(max(dot(n, normalize(vec3(0.2, 0.7, 0.6))), 0.), 18.) * drop * 0.9;

        // warm room light reaching the glass: strongest near the lamp and the candle
        float warmNear = 0.;
        for (int i = 0; i < 2; i++){
          vec4 G = uGlow[i];
          vec2 d = (suv - G.xy) * vec2(uRes.x / uRes.y, 1.);
          warmNear += exp(-dot(d, d) / (G.z * G.z * 25.)) * G.w * 0.35;
        }
        // the mist scatters the outside light and whatever light reaches it from the room
        float sl = dot(soft, vec3(.3, .59, .11));
        vec3 mistCol = soft * 0.7 + sl * 0.35 + uSky * 0.16 * (1. - uNight * 0.7) + uWarm * (warmNear + uWarmAmt * 0.012);
        vec3 col = mix(view, mistCol, mist * 0.93);
        // faint reflection of the flames in the glass
        for (int i = 0; i < 2; i++){
          vec4 G = uGlow[i];
          vec2 d = (suv - G.xy) * vec2(uRes.x / uRes.y, 1.);
          float gl = exp(-dot(d, d) / (G.z * G.z)) * G.w;
          col += uWarm * gl * (0.35 + mist * 0.9);
        }
        vec3 frostCol = mix(soft, vec3(0.9, 0.94, 1.0) * (soft * 0.6 + uSky * 0.25 + uWarm * warmNear * 0.6), 0.8);
        col = mix(col, frostCol, fr);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

export const GLASS = { GW, GH };
