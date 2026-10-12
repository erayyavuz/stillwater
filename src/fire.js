import * as THREE from 'three';
import { U } from './env.js';
import { NOISE } from './glsl.js';
import { height, seasonal, rockGeometry } from './terrain.js';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}

export class Campfire {
  constructor(pos, quality) {
    this.group = new THREE.Group();
    this.pos = pos.clone();
    this.pos.y = height(pos.x, pos.z);
    this.group.position.copy(this.pos);
    this.boost = 0;
    this.flicker = 1;
    U.firePos.value.copy(this.pos).add(new THREE.Vector3(0, 0.5, 0));

    // stone ring
    const stoneMat = seasonal(new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.9, flatShading: true }), { key: 'stone', snowMin: 0.45, snowMax: 0.75 });
    const sg = rockGeometry(7);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + Math.random() * 0.2;
      const s = new THREE.Mesh(sg, stoneMat);
      const r = 0.62 + Math.random() * 0.06;
      s.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      s.scale.set(0.17 + Math.random() * 0.06, 0.15 + Math.random() * 0.05, 0.15 + Math.random() * 0.05);
      s.rotation.y = Math.random() * 6;
      s.castShadow = s.receiveShadow = true;
      this.group.add(s);
    }
    // logs: teepee
    // logs are shaded by hand (bark lit by sky + an ember glow toward the base) so the
    // point light right next to them cannot blow them out
    this.logMat = new THREE.ShaderMaterial({
      uniforms: { uAmbient: U.ambient, uSunColor: U.sunColor, uInt: U.fireInt, uTime: U.time, uFogColor: U.fogColor, uFogDensity: U.fogDensity },
      vertexShader: `varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uAmbient, uSunColor; uniform float uInt, uTime; varying vec3 vN; varying vec3 vW; varying float vY;
        ${NOISE}
        void main(){
          float bark = 0.6 + 0.4 * vnoise(vec2(vY * 18., atan(vN.z, vN.x) * 3.));
          vec3 c = vec3(0.16, 0.11, 0.075) * bark * (uAmbient * 1.4 + uSunColor * max(vN.y, 0.) * 0.6);
          float hot = smoothstep(0.0, 0.34, vY) * smoothstep(0.35, 0.75, vnoise(vec2(vY * 14., atan(vN.z, vN.x) * 4.) + uTime * 0.3));
          c = mix(c, c * 0.35, smoothstep(0.05, 0.3, vY));
          c += vec3(1.4, 0.38, 0.06) * hot * uInt * 0.9;
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const logMat = this.logMat;
    const logGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.72, 8);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3 + (Math.random() - 0.5) * 0.3;
      const lg = new THREE.Mesh(logGeo, logMat);
      const dir = new THREE.Vector3(-Math.cos(a), 0.32, -Math.sin(a)).normalize();
      lg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      lg.position.set(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3);
      lg.castShadow = true;
      this.group.add(lg);
    }
    // ember bed
    this.bedMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uInt: U.fireInt },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uTime, uInt; varying vec2 vUv; ${NOISE}
        void main(){ vec2 p = vUv - .5; float r = length(p) * 2.;
          float n = fbm(vUv * 9. + vec2(uTime * .3, -uTime * .2));
          float glow = smoothstep(1., .1, r) * smoothstep(.35, .75, n);
          vec3 c = mix(vec3(.08,.02,.01), vec3(1.6,.45,.08), glow) * (0.6 + 0.6 * uInt);
          gl_FragColor = vec4(c, smoothstep(1., .7, r));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const bed = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), this.bedMat);
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.025; bed.renderOrder = 5;
    this.group.add(bed);

    // flames: camera-facing (around Y) quads
    this.flames = [];
    const flameGeo = new THREE.PlaneGeometry(1, 1);
    flameGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: U.time, uSeed: { value: i * 3.7 }, uInt: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uTime, uSeed, uInt; varying vec2 vUv; ${NOISE}
          void main(){
            vec2 uv = vUv;
            float t = uTime;
            float n = fbm(vec2(uv.x * 3.5 + uSeed, uv.y * 3. - t * 2.8));
            float n2 = vnoise(vec2(uv.x * 8. - uSeed, uv.y * 7. - t * 5.));
            vec2 q = vec2(uv.x - .5, uv.y);
            q.x += (n - .5) * .45 * q.y + (n2 - .5) * .05;
            float lo = q.y < .2 ? 3.2 : 0.95;
            float r = length(vec2(q.x * 2.6, (q.y - .2) * lo));
            float f = (1. - r) * 1.7 - n * (0.55 + q.y * 0.9) - n2 * 0.15;
            float m = smoothstep(0., .35, f);
            float v = clamp(f, 0., 1.2);
            vec3 c = mix(vec3(.45, .05, .01), vec3(1., .28, .03), smoothstep(.0, .35, v));
            c = mix(c, vec3(1., .62, .16), smoothstep(.35, .75, v));
            c = mix(c, vec3(1., .85, .55), smoothstep(.85, 1.15, v));
            gl_FragColor = vec4(c * m * 0.7 * uInt, 1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const f = new THREE.Mesh(flameGeo, m);
      const s = i === 0 ? 1 : 0.65 + Math.random() * 0.25;
      f.scale.set(0.75 * s, 1.15 * s, 1);
      f.position.set((Math.random() - 0.5) * 0.16, 0.0, (Math.random() - 0.5) * 0.16);
      f.userData.s = s;
      f.layers.set(1);
      f.renderOrder = 6;
      this.flames.push(f);
      this.group.add(f);
    }

    // halo
    this.tex = softTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xff7a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    this.halo.scale.set(3.2, 3.2, 1); this.halo.position.y = 0.6;
    this.halo.layers.set(1);
    this.halo.renderOrder = 5;
    this.group.add(this.halo);

    // light
    this.light = new THREE.PointLight(0xff8a3c, 6, 16, 2);
    this.light.position.set(0, 1.35, 0.25);
    this.group.add(this.light);

    // embers
    this.maxEmbers = 220;
    this.embers = Array.from({ length: this.maxEmbers }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0 }));
    const eg = new THREE.BufferGeometry();
    this.ePos = new Float32Array(this.maxEmbers * 3);
    this.eA = new Float32Array(this.maxEmbers);
    eg.setAttribute('position', new THREE.BufferAttribute(this.ePos, 3));
    eg.setAttribute('aA', new THREE.BufferAttribute(this.eA, 1));
    this.emberPts = new THREE.Points(eg, new THREE.ShaderMaterial({
      uniforms: { uScale: { value: innerHeight * 0.5 } },
      vertexShader: `attribute float aA; uniform float uScale; varying float vA;
        void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = (0.035 + aA * 0.02) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (vA <= 0.) discard;
        float a = smoothstep(.5, 0., d) * vA; gl_FragColor = vec4(vec3(1., .55, .18) * 3. * a, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.emberPts.frustumCulled = false;
    this.emberPts.layers.set(1);
    this.emberPts.renderOrder = 7;
    this.group.add(this.emberPts);

    // smoke
    this.smoke = [];
    const smokeMat = new THREE.SpriteMaterial({ map: this.tex, color: 0x9a9a9a, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < quality.smoke; i++) {
      const s = new THREE.Sprite(smokeMat.clone());
      s.userData = { age: Math.random() * 8, life: 8 };
      s.layers.set(1);
      s.renderOrder = 4;
      this.smoke.push(s); this.group.add(s);
    }
    this.emitAcc = 0;
  }

  get hitCenter() { return this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)); }

  stoke() {
    this.boost = 1;
    for (let i = 0; i < 70; i++) this.spawn(true);
  }

  spawn(burst) {
    const e = this.embers.find(e => e.life <= 0);
    if (!e) return;
    e.life = burst ? 1.4 + Math.random() * 1.8 : 1.2 + Math.random() * 2.2; e.age = 0; e.max = e.life;
    e.p.set((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
    const sp = burst ? 2.2 + Math.random() * 2.8 : 0.7 + Math.random() * 1.2;
    e.v.set((Math.random() - 0.5) * (burst ? 1.6 : 0.4), sp, (Math.random() - 0.5) * (burst ? 1.6 : 0.4));
  }

  update(dt, t, camera, env) {
    this.boost = Math.max(0, this.boost - dt * 0.45);
    const f = 0.82 + 0.12 * Math.sin(t * 9.3) * Math.sin(t * 5.1 + 1) + 0.08 * Math.sin(t * 17.7) + (Math.random() - 0.5) * 0.08;
    this.flicker += (f - this.flicker) * Math.min(1, dt * 12);
    const inten = this.flicker * (1 + this.boost * 0.8) * (1 - env.rain * 0.25);
    U.fireInt.value = inten;
    const dark = Math.min(1, env.night * 1.25 + 0.15);
    this.light.intensity = inten * (0.6 + dark * 4.2) * (1 - env.winter * 0.4);
    this.halo.material.opacity = (0.04 + dark * 0.32) * inten;

    // face flames toward camera around Y
    const cp = camera.position;
    for (const fl of this.flames) {
      const wp = this.group.position;
      fl.rotation.y = Math.atan2(cp.x - wp.x, cp.z - wp.z);
      fl.material.uniforms.uInt.value = inten * (0.42 + 0.5 * dark);
      fl.scale.y = 1.15 * fl.userData.s * (0.9 + 0.15 * this.flicker + this.boost * 0.5);
    }
    // embers
    this.emitAcc += dt * (6 + this.boost * 20);
    while (this.emitAcc > 1) { this.spawn(false); this.emitAcc -= 1; }
    for (let i = 0; i < this.maxEmbers; i++) {
      const e = this.embers[i];
      if (e.life > 0) {
        e.life -= dt; e.age += dt;
        e.v.y -= dt * 0.25; e.v.x += Math.sin(t * 3 + i) * dt * 0.6 + env.windX * dt * 0.8; e.v.z += Math.cos(t * 2.3 + i) * dt * 0.6;
        e.v.multiplyScalar(1 - dt * 0.6);
        e.p.addScaledVector(e.v, dt);
        this.ePos[i * 3] = e.p.x; this.ePos[i * 3 + 1] = e.p.y; this.ePos[i * 3 + 2] = e.p.z;
        this.eA[i] = Math.max(0, e.life / e.max) * (0.6 + 0.4 * Math.sin(e.age * 25 + i));
      } else this.eA[i] = 0;
    }
    this.emberPts.geometry.attributes.position.needsUpdate = true;
    this.emberPts.geometry.attributes.aA.needsUpdate = true;
    // smoke
    const smokeA = (0.12 + env.rain * 0.12) * (1 - env.night * 0.6);
    for (const s of this.smoke) {
      const u = s.userData;
      u.age += dt;
      if (u.age > u.life) { u.age = 0; u.ox = (Math.random() - 0.5) * 0.3; }
      const k = u.age / u.life;
      s.position.set((u.ox || 0) + k * k * (1.5 + env.windX * 2.5), 0.9 + k * 4.5, k * 0.8);
      s.scale.setScalar(0.5 + k * 3.2);
      s.material.opacity = smokeA * Math.sin(Math.PI * k) * (1 - k * 0.3);
      s.material.color.copy(env.smokeColor);
    }
  }
}
