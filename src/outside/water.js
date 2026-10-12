import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { U } from './env.js';
import { NOISE } from './glsl.js';

const MAX_RIPPLES = 10;

export function createWater(quality) {
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  const shader = {
    name: 'LakeWater',
    uniforms: {
      color: { value: new THREE.Color(1, 1, 1) },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uTime: U.time, uSunDir: U.sunDir, uSunColor: U.sunColor, uWaterColor: U.waterColor,
      uAmbient: U.ambient, uFogColor: U.fogColor, uFogDensity: U.fogDensity, uRain: U.rain, uIce: U.ice,
      uWind: U.wind, uNight: U.night, uSnow: U.snow, uFirePos: U.firePos, uFireColor: U.fireColor, uFireInt: U.fireInt,
      uRipples: { value: ripples },
    },
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vUvR; varying vec3 vW;
      void main(){
        vUvR = textureMatrix * vec4(position, 1.);
        vec4 w = modelMatrix * vec4(position, 1.);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uTime, uFogDensity, uRain, uIce, uWind, uNight, uSnow;
      uniform vec3 uSunDir, uSunColor, uWaterColor, uAmbient, uFogColor, uFirePos, uFireColor; uniform float uFireInt;
      uniform vec4 uRipples[${MAX_RIPPLES}];
      varying vec4 vUvR; varying vec3 vW;
      ${NOISE}
      float wh(vec2 p){
        float t = uTime;
        return fbm3(p * 0.28 + vec2(t * 0.045, t * 0.018)) * 0.55
             + vnoise(p * 1.2 - vec2(t * 0.12, t * 0.04)) * 0.25
             + vnoise(p * 3.4 + vec2(t * 0.05, -t * 0.16)) * 0.1;
      }
      vec2 rainLayer(vec2 p, float sc, float sp, float seed){
        vec2 q = p * sc + seed;
        vec2 cell = floor(q); vec2 f = fract(q);
        float rnd = hash12(cell + seed);
        float tt = uTime * sp + rnd;
        float ph = fract(tt);
        vec2 c = 0.25 + 0.5 * hash22(cell + floor(tt) * 3.17 + seed);
        vec2 d = f - c; float r = length(d);
        float x = r - ph * 0.55;
        float amp = (1. - ph) * (1. - ph) * step(hash12(cell + floor(tt) * 1.7), uRain * 1.05);
        float ring = sin(x * 55.) * exp(-x * x * 500.) * amp;
        return d / (r + 1e-3) * ring;
      }
      vec2 cellular(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float d1 = 9., d2 = 9.;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
          vec2 g = vec2(float(x), float(y));
          vec2 o = hash22(i + g);
          float d = length(g + o - f);
          if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return vec2(d1, d2);
      }
      void main(){
        vec2 p = vW.xz;
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float liquid = 1. - uIce;

        // base waves via finite differences
        float e = 0.06;
        float h0 = wh(p);
        vec2 g = vec2(wh(p + vec2(e, 0.)) - h0, wh(p + vec2(0., e)) - h0) / e;
        g *= (0.16 + uWind * 0.5 + uRain * 0.45) / (1. + dist * 0.025);

        // rain rings
        float near = smoothstep(45., 8., dist);
        if (uRain > 0.01 && near > 0.){
          vec2 rg = rainLayer(p, 1.7, 1.15, 0.) + rainLayer(p, 2.3, 1.4, 7.3) + rainLayer(p, 1.25, 0.95, 3.1);
          g += rg * 0.9 * near;
        }
        // interactive ripples
        for (int i = 0; i < ${MAX_RIPPLES}; i++){
          vec4 R = uRipples[i];
          float age = uTime - R.z;
          if (age < 0. || age > 9.) continue;
          vec2 d = p - R.xy; float r = length(d);
          float front = age * 1.35;
          float x = r - front;
          float env = exp(-x * x * 0.9) * exp(-age * 0.42) * R.w / (1. + r * 0.35);
          env *= smoothstep(0., 0.25, front - r + 1.2);
          g += d / (r + 1e-3) * sin(x * 7.5) * env * 1.4;
        }
        g *= liquid;

        vec3 n = normalize(vec3(-g.x, 1., -g.y));

        // reflection
        vec2 ruv = vUvR.xy / vUvR.w + n.xz * mix(0.03, 0.006, uIce) * (1. + uRain * 0.5) * smoothstep(2., 14., dist);
        vec3 refl = texture2D(tDiffuse, ruv).rgb;

        float cosT = clamp(dot(V, n), 0., 1.);
        float F = 0.025 + 0.975 * pow(1. - cosT, 5.);
        vec3 body = uWaterColor * (0.6 + 0.4 * uAmbient) + uAmbient * 0.02;
        vec3 col = mix(body, refl, clamp(F * 1.05 + 0.08, 0., 1.));

        // sun / moon glints
        vec3 Rv = reflect(-V, n);
        float sd = max(dot(Rv, uSunDir), 0.);
        float sunVis = smoothstep(-0.04, 0.04, uSunDir.y);
        col += uSunColor * (pow(sd, 700.) * 9. + pow(sd, 70.) * 0.25) * sunVis * liquid * mix(1., 3., uNight);

        // campfire glint (the flames are kept out of the reflection pass)
        {
          vec3 fp = uFirePos + vec3(0., 0.15, 0.);
          vec3 tf = fp - vW; float fd = length(tf);
          float fs = max(dot(Rv, tf / fd), 0.);
          float glint = pow(fs, 900.) * 3. + pow(fs, 90.) * 0.35;
          col += uFireColor * vec3(1., 0.9, 0.8) * glint * uFireInt * (0.25 + 0.75 * uNight) * 6. / (1. + fd * 0.6) * mix(1., 0.4, uIce);
        }
        // ice
        if (uIce > 0.001){
          vec2 c1 = cellular(p * 0.35);
          vec2 c2 = cellular(p * 1.4 + 3.);
          float crack = smoothstep(0.05, 0.0, c1.y - c1.x) * 0.8 + smoothstep(0.035, 0.0, c2.y - c2.x) * 0.35;
          vec3 ice = mix(vec3(0.42, 0.55, 0.64), vec3(0.72, 0.8, 0.86), fbm3(p * 0.12));
          float frost = smoothstep(0.45, 0.75, fbm(p * 0.07 + 2.)) * uSnow;
          ice = mix(ice, vec3(0.92, 0.94, 0.97), frost * 0.85);
          ice *= 1. - crack * 0.35 * (1. - frost);
          vec3 lit = ice * (uAmbient * 0.9 + uSunColor * max(uSunDir.y, 0.) * 0.9);
          vec3 iceCol = mix(lit, refl, F * 0.55 * (1. - frost) + 0.06);
          float sp = pow(max(dot(reflect(-V, vec3(0., 1., 0.)), uSunDir), 0.), 40.);
          iceCol += uSunColor * sp * 0.6 * sunVis * (1. - frost);
          col = mix(col, iceCol, uIce);
        }

        float f = 1. - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, f);
        float alpha = mix(mix(0.72, 1., smoothstep(0.1, 0.6, F) ), 1., max(uIce, smoothstep(20., 60., dist)));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };
  const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  const w = Math.round(window.innerWidth * quality.reflScale * Math.min(devicePixelRatio, 2));
  const h = Math.round(window.innerHeight * quality.reflScale * Math.min(devicePixelRatio, 2));
  const water = new Reflector(geo, { shader, textureWidth: w, textureHeight: h, clipBias: 0.002 });
  // Reflector clones uniforms; re-link the shared ones so they stay live.
  const mu = water.material.uniforms;
  for (const k of Object.keys(shader.uniforms)) if (!['color', 'tDiffuse', 'textureMatrix'].includes(k)) mu[k] = shader.uniforms[k];
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.material.transparent = true;
  water.renderOrder = 1;
  let next = 0;
  water.addRipple = (x, z, strength = 1) => {
    ripples[next].set(x, z, U.time.value, strength);
    next = (next + 1) % MAX_RIPPLES;
  };
  water.resizeReflection = (q) => {
    const rt = water.getRenderTarget();
    rt.setSize(Math.round(innerWidth * q.reflScale * Math.min(devicePixelRatio, 2)), Math.round(innerHeight * q.reflScale * Math.min(devicePixelRatio, 2)));
  };
  return water;
}
