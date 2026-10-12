import * as THREE from 'three';
import { U } from './env.js';
import { NOISE } from './glsl.js';

// Low mist drifting over the water; thicker at dawn-ish light, night and in winter.
export function createMist() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uFogColor: U.fogColor, uAmbient: U.ambient, uAmt: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uAmt; uniform vec3 uFogColor, uAmbient; varying vec3 vW; ${NOISE}
      void main(){
        vec2 p = vW.xz * 0.018 + vec2(uTime * 0.004, uTime * 0.0015);
        float n = fbm(p + fbm(p * 1.7 - uTime * 0.003));
        float d = length(cameraPosition.xz - vW.xz);
        float a = smoothstep(0.42, 0.8, n) * smoothstep(6., 30., d) * (1. - smoothstep(250., 420., d)) * uAmt;
        vec3 c = mix(uFogColor, uAmbient * 1.6 + uFogColor * 0.4, 0.4);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const g = new THREE.Group();
  for (const [y, s] of [[0.35, 1], [1.1, 0.7]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(0, y, -230);
    m.renderOrder = 2;
    m.material = mat;
    g.add(m);
  }
  g.material = mat;
  return g;
}

// A small flock that crosses the sky now and then during the day.
export class Birds {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.birds = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1e, side: THREE.DoubleSide, fog: true });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
      this.birds.push({ m, ph: Math.random() * 6, off: new THREE.Vector3() });
    }
    this.next = 6 + Math.random() * 10;
    this.active = false;
  }
  update(dt, t, allowed) {
    if (!this.active) {
      this.next -= dt;
      if (this.next <= 0 && allowed) this.launch();
      if (this.next <= 0 && !allowed) this.next = 20;
      return;
    }
    this.t += dt;
    const k = this.t / this.dur;
    if (k >= 1) { this.active = false; this.birds.forEach(b => (b.m.visible = false)); this.next = 45 + Math.random() * 70; return; }
    const lead = this.from.clone().lerp(this.to, k);
    lead.y += Math.sin(k * Math.PI) * 6;
    this.birds.forEach((b, i) => {
      const p = lead.clone().add(b.off);
      p.y += Math.sin(t * 0.7 + b.ph) * 0.6;
      const flap = Math.sin(t * 9 + b.ph * 3) * (Math.sin(t * 0.8 + b.ph) > -0.2 ? 1 : 0.15);
      const span = 1.1, a = this.dir;
      const side = new THREE.Vector3(-a.z, 0, a.x);
      const fwd = a.clone().multiplyScalar(0.35);
      const tip = flap * 0.5;
      const P = b.m.geometry.attributes.position.array;
      const set = (j, v) => { P[j * 3] = v.x; P[j * 3 + 1] = v.y; P[j * 3 + 2] = v.z; };
      const c0 = p.clone().add(fwd), c1 = p.clone().sub(fwd);
      set(0, c0); set(1, c1); set(2, p.clone().addScaledVector(side, span).add(new THREE.Vector3(0, tip, 0)).sub(fwd));
      set(3, c0); set(4, c1); set(5, p.clone().addScaledVector(side, -span).add(new THREE.Vector3(0, tip, 0)).sub(fwd));
      b.m.geometry.attributes.position.needsUpdate = true;
      b.m.visible = true;
    });
  }
  launch() {
    this.active = true; this.t = 0;
    const left = Math.random() < 0.5;
    const z = -90 - Math.random() * 120, y = 22 + Math.random() * 25;
    this.from = new THREE.Vector3(left ? -260 : 260, y, z);
    this.to = new THREE.Vector3(left ? 260 : -260, y + (Math.random() - 0.5) * 20, z - 40 + Math.random() * 80);
    this.dir = this.to.clone().sub(this.from).setY(0).normalize();
    this.dur = 38 + Math.random() * 20;
    this.birds.forEach((b, i) => b.off.set(-this.dir.x * i * 2.6 + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, -this.dir.z * i * 2.6 + (i % 2 ? 2.5 : -2.5) * (i > 0)));
  }
}
