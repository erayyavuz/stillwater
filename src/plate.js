import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Photographic plates (2816x1472) + depth/lake masks. Plate space: x,y in [0,1], y down.
export const PLATE_ASPECT = 2816 / 1472;
export const HORIZON = 0.401;       // waterline of the far shore
export const FIRE = { x: 0.562, y: 0.79 };
export const MAX_RIPPLES = 12;

export const SUMMER = ['noon', 'golden', 'dusk', 'night'];
export const WINTER = ['w_noon', 'w_golden', 'w_dusk', 'w_night'];
export const WEATHER = { summer: 'rain', winter: 'w_snow' };

// ground-plane mapping shared by the water shader, ripples and the skipping stone
export const G = 0.06; // = focal * camera height, in plate-height units
export function toGround(x, y) { const Z = G / Math.max(y - HORIZON, 0.002); return { X: (x - 0.5) * PLATE_ASPECT * Z, Z }; }
export function fromGround(X, Z, h = 0) { return { x: 0.5 + X / (PLATE_ASPECT * Z), y: HORIZON + G / Z - h * 1.25 / Z }; }

export class PlateLibrary {
  constructor(small) {
    this.small = small;
    this.tex = {};
    this.loader = new THREE.TextureLoader();
    this.blank = new THREE.DataTexture(new Uint8Array([20, 24, 30, 255]), 1, 1);
    this.blank.needsUpdate = true;
  }
  load(name) {
    if (this.tex[name]) return this.tex[name].promise;
    const entry = { ready: false };
    entry.promise = new Promise((res) => {
      entry.t = this.loader.load(`assets/plates/${name}${this.small ? '_sm' : ''}.webp`, (t) => { entry.ready = true; res(t); }, undefined, () => res(null));
      entry.t.colorSpace = THREE.SRGBColorSpace;
      entry.t.generateMipmaps = false;
      entry.t.minFilter = THREE.LinearFilter;
      entry.t.anisotropy = 1;
    });
    this.tex[name] = entry;
    return entry.promise;
  }
  get(name, fallback) {
    const e = this.tex[name];
    if (e && e.ready) return e.t;
    if (fallback) for (const f of fallback) { const g = this.tex[f]; if (g && g.ready) return g.t; }
    return this.blank;
  }
  data(name) {
    const t = this.loader.load(`assets/plates/${name}.png`);
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    return t;
  }
}

export function createPlateMaterial(lib) {
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  const u = {
    tA: { value: lib.blank }, tB: { value: lib.blank }, tC: { value: lib.blank }, tD: { value: lib.blank },
    tWs: { value: lib.blank }, tWw: { value: lib.blank },
    tDepth: { value: lib.data('depth') }, tMask: { value: lib.data('mask') },
    uF: { value: 0 }, uSeason: { value: 0 }, uWx: { value: 0 }, uWTint: { value: new THREE.Color(1, 1, 1) },
    uTime: { value: 0 }, uRain: { value: 0 }, uIce: { value: 0 }, uNight: { value: 0 }, uWind: { value: 0.3 },
    uMist: { value: 0.3 }, uMistColor: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uFire: { value: new THREE.Vector2(FIRE.x, FIRE.y) }, uFireInt: { value: 1 }, uFireVis: { value: 0.3 }, uFireColor: { value: new THREE.Color(1, 0.42, 0.12) },
    uMouse: { value: new THREE.Vector2() }, uCursor: { value: new THREE.Vector2(-1, -1) }, uCursorOn: { value: 0 },
    uGust: { value: new THREE.Vector4(0, 0, -100, 0) }, uSparkle: { value: 0.5 },
    uRipples: { value: ripples },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tA, tB, tC, tD, tWs, tWw, tDepth, tMask;
      uniform float uF, uSeason, uWx, uTime, uRain, uIce, uNight, uWind, uMist, uFireInt, uFireVis, uCursorOn, uSparkle;
      uniform vec3 uWTint, uMistColor, uFireColor;
      uniform vec2 uFire, uMouse, uCursor;
      uniform vec4 uGust;
      uniform vec4 uRipples[${MAX_RIPPLES}];
      varying vec2 vUv;
      ${NOISE}
      const float A = ${PLATE_ASPECT.toFixed(5)};
      const float HZ = ${HORIZON.toFixed(4)};
      vec4 T(sampler2D t, vec2 p){ return texture2D(t, vec2(p.x, 1. - p.y)); }
      vec3 scene(vec2 p){
        p = clamp(p, vec2(0.001), vec2(0.999));
        vec3 s = mix(T(tA, p).rgb, T(tB, p).rgb, uF);
        vec3 w = mix(T(tC, p).rgb, T(tD, p).rgb, uF);
        vec3 c = mix(s, w, uSeason);
        if (uWx > 0.002){
          vec3 x = mix(T(tWs, p).rgb, T(tWw, p).rgb, uSeason) * uWTint;
          c = mix(c, x, uWx);
        }
        return c;
      }
      vec2 ground(vec2 p){ float gy = max(p.y - HZ, 0.002); float Z = ${G.toFixed(3)} / gy; return vec2((p.x - .5) * A * Z, Z); }
      vec2 rainLayer(vec2 g, float sc, float sp, float seed){
        vec2 q = g * sc + seed;
        vec2 cell = floor(q); vec2 f = fract(q);
        float tt = uTime * sp + hash12(cell + seed);
        float ph = fract(tt);
        vec2 c = .25 + .5 * hash22(cell + floor(tt) * 3.17 + seed);
        vec2 d = f - c; float r = length(d);
        float x = r - ph * .5;
        float on = step(hash12(cell + floor(tt) * 1.7), uRain * 0.9);
        float ring = sin(x * 50.) * exp(-x * x * 420.) * (1. - ph) * (1. - ph) * on;
        return d / (r + 1e-3) * ring;
      }
      void main(){
        vec2 p = vec2(vUv.x, 1. - vUv.y);
        vec2 dm = T(tDepth, p).rg, mm = T(tMask, p).rg;
        float d = mix(dm.r, dm.g, uSeason);
        float lake = mix(mm.r, mm.g, uSeason);
        float t = uTime;

        // depth parallax
        vec2 q = p + uMouse * (d - 0.15) * vec2(0.011, 0.006);

        // foreground grass in the wind, parted by the cursor and by gusts
        float fg = smoothstep(0.55, 0.82, d) * (1. - lake);
        float gust = vnoise(vec2(q.x * 3. - t * 0.4, t * 0.13));
        float sway = (sin(t * 1.5 + q.x * 37. + q.y * 9.) * .6 + sin(t * 2.6 + q.x * 73.) * .4) * (.35 + gust * .9) * (.55 + uWind);
        float tip = smoothstep(0.62, 1.0, q.y);
        q.x += sway * 0.0022 * fg * (0.4 + tip);
        vec2 dc = (q - uCursor) * vec2(A, 1.);
        float cd = length(dc);
        q -= normalize(dc + 1e-5) / vec2(A, 1.) * 0.014 * exp(-cd * cd / 0.006) * fg * uCursorOn;
        float gAge = t - uGust.z;
        if (gAge > 0. && gAge < 5.){
          vec2 gd = (q - uGust.xy) * vec2(A, 1.); float gr = length(gd);
          float gx = gr - gAge * 0.45;
          q.x += sign(gd.x) * 0.006 * exp(-gx * gx * 40.) * exp(-gAge * 0.7) * fg;
        }

        vec3 col;
        float water = lake * (1. - uIce);
        float gy = q.y - HZ;
        if (water > 0.01 && gy > 0.){
          vec2 g = ground(q);
          float Z = g.y;
          vec2 wp = vec2(g.x * 13., Z * 30.);
          vec2 drift = vec2(t * 0.05, -t * 0.16);
          float e = 0.05;
          float h0 = fbm3(wp + drift), hx = fbm3(wp + vec2(e, 0.) + drift), hz = fbm3(wp + vec2(0., e) + drift);
          vec2 n = vec2(hx - h0, hz - h0) / e;
          n *= (0.35 + uWind * 0.9 + uRain * 0.5);
          float shade = 0.;
          if (uRain > 0.01){
            float near = smoothstep(3.5, 0.5, Z);
            n += (rainLayer(g, 110., 1.1, 0.) + rainLayer(g, 150., 1.35, 7.3) + rainLayer(g, 80., 0.9, 3.1)) * near * 1.6;
          }
          for (int i = 0; i < ${MAX_RIPPLES}; i++){
            vec4 R = uRipples[i];
            float age = t - R.z;
            if (age < 0. || age > 8.) continue;
            vec2 dv = g - R.xy; float r = length(dv);
            float x = r - age * 0.04;
            float env = exp(-x * x * 2600.) * exp(-age * 0.42) * R.w;
            env *= smoothstep(0., 0.02, age * 0.04 - r + 0.03);
            float wv = sin(x * 330.);
            n += dv / (r + 1e-4) * wv * env * 5.;
            shade += wv * env;
          }
          vec2 off = vec2(n.x * 0.35, n.y) * (0.0012 + gy * 0.016);
          col = scene(q + off * water);
          // slopes facing the viewer catch more sky: makes rings readable on flat colour
          col *= 1. + (n.y * 0.05 + shade * 0.22) * water * smoothstep(0., 0.05, gy);
          col += max(shade, 0.) * 0.05 * water;
          // sun / moon sparkle on the brightest reflections
          float lum = dot(col, vec3(.3, .59, .11));
          float sp = pow(vnoise(vec2(g.x * 420., Z * 900.) + vec2(t * 1.3, -t * 2.)), 14.);
          col += sp * smoothstep(0.35, 0.9, lum) * uSparkle * 2.5 * water * smoothstep(0.0, 0.03, gy);
          // rain splashes
          if (uRain > 0.01){
            vec2 sq = g * 140.; vec2 sc = floor(sq);
            float ph = fract(t * 2.2 + hash12(sc));
            float hit = step(0.93, hash12(sc + floor(t * 2.2 + hash12(sc)))) * smoothstep(0.12, 0., ph) * smoothstep(0.35, 0.05, length(fract(sq) - .5));
            col += hit * uRain * 0.25 * smoothstep(3., 0.4, Z) * (0.4 + lum);
          }
        } else {
          col = scene(q);
        }

        // ice glints
        if (uIce > 0.01 && lake > 0.1 && gy > 0.){
          vec2 g = ground(q);
          float lum = dot(col, vec3(.3, .59, .11));
          float sp = pow(vnoise(vec2(g.x * 600., g.y * 1200.)), 22.) * (0.6 + 0.4 * sin(t * 3. + g.x * 50.));
          col += sp * uIce * lake * smoothstep(0.4, 0.9, lum) * uSparkle * 1.4;
        }

        // campfire light
        vec2 fd = (q - uFire) * vec2(A, 1.7);
        float L = uFireInt * uFireVis * 0.0045 / (0.0012 + dot(fd, fd));
        L *= 1. - lake * 0.6 * (1. - uIce);
        col += col * uFireColor * L * 1.6 + uFireColor * L * 0.012;

        // mist hugging the far shore and the water
        float mBand = smoothstep(0.31, 0.395, q.y) * (1. - smoothstep(0.41, 0.6, q.y));
        float mN = fbm(vec2(q.x * 5. - t * 0.012, q.y * 22. + t * 0.004)) * 0.7 + fbm(vec2(q.x * 13. + t * 0.02, q.y * 40.)) * 0.3;
        float mist = smoothstep(0.35, 0.75, mN) * mBand * uMist * (1. - fg);
        col = mix(col, uMistColor, mist);

        // stars twinkle
        if (uNight > 0.05 && q.y < 0.37){
          float sky = 1. - smoothstep(0.015, 0.05, d);
          float lum = dot(col, vec3(.3, .59, .11));
          float tw = 0.55 + 0.9 * vnoise(q * vec2(1400., 730.) + t * 1.7);
          col *= mix(1., tw, sky * uNight * smoothstep(0.12, 0.45, lum));
        }
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  mat.ripples = ripples;
  return mat;
}
