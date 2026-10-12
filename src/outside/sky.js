import * as THREE from 'three';
import { U } from './env.js';
import { NOISE } from './glsl.js';

// Sky dome: gradient, sun/moon, drifting clouds, stars. Follows the camera.
export function createSky() {
  const geo = new THREE.SphereGeometry(1500, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: U.time, uSunDir: U.sunDir, uSunColor: U.sunColor, uZenith: U.zenith, uHorizon: U.horizon,
      uCloud: U.cloud, uNight: U.night, uGlow: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        gl_Position = p.xyww; gl_Position.z = p.w * 0.99995;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uCloud, uNight, uGlow;
      uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
      varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.);
        vec3 col = mix(uHorizon, uZenith, pow(y, mix(0.55, 1.1, uCloud)));
        float sd = dot(d, uSunDir);
        float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
        float day = 1. - uNight;
        // atmospheric glow around the sun / moon
        col += uSunColor * (pow(max(sd, 0.), 6.) * 0.45 + pow(max(sd, 0.), 60.) * 0.6) * uGlow * mix(1., 0.25, uNight) * sunUp;
        // horizon band warmth
        col += uSunColor * pow(1. - y, 6.) * 0.18 * uGlow * day * sunUp;

        // stars
        vec3 sp = d * 220.;
        vec2 cell = floor(sp.xz / (abs(sp.y) * 0.02 + 1.) );
        float st = 0.;
        {
          vec2 q = d.xz / (d.y + 0.35) * 160.;
          vec2 c = floor(q); vec2 f = fract(q) - 0.5;
          float h = hash12(c);
          if (h > 0.985) {
            float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.) + h * 40.);
            st = smoothstep(0.18, 0.0, length(f + (hash22(c) - .5) * .6)) * tw * (h - 0.985) * 66.;
          }
        }
        float starMask = uNight * smoothstep(0.02, 0.25, d.y);

        // moon / sun disc
        float disc = smoothstep(mix(0.99955, 0.99935, uNight), mix(0.99975, 0.99955, uNight), sd);
        vec3 discCol = mix(uSunColor * 14., vec3(1.6, 1.65, 1.8), uNight);

        // clouds (planar projection)
        vec2 uv = d.xz / (d.y + 0.08) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fbm(uv * 1.1) * 0.7 + fbm(uv * 3.3 + 4.) * 0.3;
        float cov = smoothstep(0.86 - uCloud * 0.6, 1.1 - uCloud * 0.5, n + 0.1);
        cov *= smoothstep(0.0, 0.18, d.y);
        float lit = clamp(0.5 + 0.6 * sd, 0., 1.);
        vec3 cloudBase = mix(uZenith * 1.35 + 0.06 * day, uHorizon, 0.45);
        vec3 cloudCol = cloudBase + uSunColor * lit * 0.35 * uGlow * day;
        // undersides darker when heavy
        cloudCol *= 1. - uCloud * 0.35 * smoothstep(0.5, 1., n);
        cloudCol = mix(cloudCol, uZenith * 1.6 + vec3(0.012, 0.014, 0.02), uNight * 0.85);
        // heavy overcast: a flat, soft lid that matches the fog at the horizon
        float oc = smoothstep(0.6, 0.95, uCloud);
        cloudCol = mix(cloudCol, mix(uHorizon, uZenith, 0.35) * (0.92 + 0.12 * n), oc);

        col += vec3(st) * starMask * (1. - cov);
        col += discCol * disc * smoothstep(-0.01, 0.02, d.y) * (1. - cov * 0.9);
        col = mix(col, cloudCol, cov * 0.92);
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
