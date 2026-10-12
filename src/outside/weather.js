import * as THREE from 'three';
import { U } from './env.js';
import { height } from './terrain.js';

export function createRain(count) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 2 * 3), end = new Float32Array(count * 2), rnd = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const sx = Math.random(), sy = Math.random(), sz = Math.random(), r = Math.random();
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      seed.set([sx, sy, sz], j * 3); end[j] = k; rnd[j] = r;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uRain: U.rain, uAmbient: U.ambient, uFogColor: U.fogColor, uWind: U.wind, uCam: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      attribute float aEnd, aRnd; uniform float uTime, uRain, uWind; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 box = vec3(46., 24., 46.);
        float speed = 11. + aRnd * 5.;
        vec3 vel = vec3(-1.2 - uWind * 3., -speed, -0.4);
        vec3 p;
        p.xz = uCam.xz + mod(position.xz * box.xz - uCam.xz, box.xz) - box.xz * .5;
        float y = mod(position.y * box.y + vel.y * uTime, box.y);
        p.y = uCam.y - 6. + y;
        p.xz += vel.xz / speed * (box.y - y);
        p += vel * 0.035 * aEnd;
        vA = step(aRnd, uRain) * mix(0.0, 1., aEnd) ;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA *= smoothstep(1.5, 4., -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAmbient, uFogColor; varying float vA;
      void main(){ gl_FragColor = vec4(max(uFogColor * 1.1, uAmbient * 1.4) + 0.05, vA * 0.32);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  return lines;
}

export function createSnow(count) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 3), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) { seed.set([Math.random(), Math.random(), Math.random()], i * 3); rnd[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uSnowFall: { value: 0 }, uAmbient: U.ambient, uFogColor: U.fogColor, uSunColor: U.sunColor, uWind: U.wind, uCam: { value: new THREE.Vector3() }, uScale: { value: innerHeight * 0.5 } },
    vertexShader: /* glsl */`
      attribute float aRnd; uniform float uTime, uSnowFall, uWind, uScale; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 box = vec3(44., 22., 44.);
        float speed = 0.9 + aRnd * 0.8;
        vec3 p;
        float t = uTime;
        vec3 drift = vec3((-0.6 - uWind * 1.6) * t + sin(t * 0.7 + aRnd * 40.) * 0.6, -speed * t, cos(t * 0.5 + aRnd * 23.) * 0.5);
        vec3 q = position * box + drift;
        p.xz = uCam.xz + mod(q.xz - uCam.xz, box.xz) - box.xz * .5;
        p.y = uCam.y - 6. + mod(q.y, box.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA = step(aRnd, uSnowFall) * smoothstep(0.8, 2.5, -mv.z);
        gl_PointSize = (0.05 + aRnd * 0.05) * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAmbient, uSunColor, uFogColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .15, d) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(max(uFogColor * 1.25, uAmbient * 1.4) + 0.06, a * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return pts;
}

export function createFireflies(count) {
  const g = new THREE.BufferGeometry();
  const base = new Float32Array(count * 3), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x, z, y;
    do { x = (Math.random() * 2 - 1) * 22; z = -2 + Math.random() * 18; y = height(x, z); } while (y < -0.3);
    base.set([x, Math.max(y, 0) + 0.3 + Math.random() * 1.6, z], i * 3);
    rnd[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uAmt: { value: 0 }, uScale: { value: innerHeight * 0.5 } },
    vertexShader: /* glsl */`
      attribute float aRnd; uniform float uTime, uAmt, uScale; varying float vA;
      void main(){
        float t = uTime * (0.25 + aRnd * 0.2) + aRnd * 60.;
        vec3 p = position + vec3(sin(t) * 1.4 + sin(t * 2.3) * 0.4, sin(t * 1.7) * 0.35, cos(t * 0.8) * 1.4);
        float blink = smoothstep(0.55, 1., sin(uTime * (0.6 + aRnd * 0.9) + aRnd * 30.));
        vA = blink * step(aRnd, uAmt);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_PointSize = 0.18 * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); float a = (smoothstep(.5, 0., d) * 0.5 + smoothstep(.12, 0., d)) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.85, 1., 0.35) * a * 2.2, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
