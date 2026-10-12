import * as THREE from 'three';
import { U, sampleEnv } from './env.js';
import { createSky } from './sky.js';
import { createTerrain, createForest, createRocks, height } from './terrain.js';
import { createWater } from './water.js';
import { createGrass, GRASS_LAYER } from './grass.js';
import { createRain, createSnow, createFireflies } from './weather.js';
import { createDock, dockAvoid } from './props.js';
import { createMist, Birds } from './life.js';

// The world outside the cabin window. It has its own scene and camera; the cabin
// renders it into a target and shows it through (and refracted by) the glass.
export const CABIN = new THREE.Vector3(0.6, 0, 21.2); // where the window sits in the world (xz)
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Outside {
  constructor(Q) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.002);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3500);
    this.camera.layers.enable(GRASS_LAYER);
    // window floor offset: the cabin floor sits a little above the shore
    this.offset = new THREE.Vector3(CABIN.x, height(CABIN.x, CABIN.z) + 0.35, CABIN.z);

    const s = this.scene;
    this.sky = createSky(); s.add(this.sky);
    s.add(createTerrain(Q));
    const avoid = (x, z) => dockAvoid(x, z) || Math.hypot(x - CABIN.x, z - CABIN.z) < 3;
    s.add(createForest(Q, avoid));
    s.add(createRocks());
    s.add(createDock());
    this.water = createWater(Q); s.add(this.water);
    s.add(createGrass(Q, avoid));
    this.rain = createRain(Q.rain); s.add(this.rain);
    this.snow = createSnow(Q.snow); s.add(this.snow);
    this.flies = createFireflies(Q.fireflies); s.add(this.flies);
    this.mist = createMist(); s.add(this.mist);
    this.birds = new Birds(s);

    // distant cabin lights across the lake, only at night
    const lg = new THREE.BufferGeometry();
    const lp = [];
    for (const [x, z] of [[-60, -205], [-52, -212], [38, -226], [95, -180], [-120, -150]]) lp.push(x, height(x, z) + 1.5, z);
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.lightsMat = new THREE.PointsMaterial({ color: 0xffb46a, size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    // (distant cabin lights removed: at this distance they read as a stray orange bar)

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = false; // seen through misted glass; not worth the pass
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 });
    this.sun.shadow.bias = -0.0005;
    this.sun.target.position.set(4, 0, 0);
    s.add(this.sun, this.sun.target);
    this.flash = 0;
    this.env = null;
  }

  /** st: {tod, rain, snow, winter, wet, ice, time, lightning} */
  update(st, dt) {
    const e = sampleEnv(st.tod, st.rain, st.snow, st.winter);
    this.env = e;
    const sunVis = ss(-0.1, 0.06, e.sunDir.y);
    U.time.value = st.time;
    U.sunDir.value.copy(e.sunDir);
    U.sunColor.value.copy(e.sun).multiplyScalar(e.sunI * 0.42 * (0.25 + 0.75 * sunVis));
    U.ambient.value.copy(e.hemiS).lerp(e.hemiG, 0.3).multiplyScalar(e.hemiI * 0.62);
    U.zenith.value.copy(e.zen); U.horizon.value.copy(e.hor);
    U.fogColor.value.copy(e.fog); U.fogDensity.value = e.fogD;
    this.scene.fog.color.copy(e.fog); this.scene.fog.density = e.fogD;
    U.waterColor.value.copy(e.water);
    U.night.value = e.night; U.cloud.value = e.cloud;
    U.rain.value = st.rain; U.wet.value = st.wet; U.snow.value = st.winter; U.ice.value = st.ice;
    U.wind.value = 0.3 + st.rain * 0.45 + st.snow * 0.2 + Math.sin(st.time * 0.05) * 0.08;
    U.fireInt.value = 0;
    // lightning: brief flat flash over everything
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const fl = this.flash * (0.6 + 0.4 * Math.sin(st.time * 60));
    if (fl > 0.01) {
      U.zenith.value.lerp(new THREE.Color(0.75, 0.8, 1.0), fl * 0.8);
      U.horizon.value.lerp(new THREE.Color(0.8, 0.85, 1.0), fl * 0.7);
      U.ambient.value.addScalar(fl * 0.5);
    }
    this.sky.material.uniforms.uGlow.value = e.glow;
    this.hemi.color.copy(e.hemiS); this.hemi.groundColor.copy(e.hemiG); this.hemi.intensity = e.hemiI + fl * 2.5;
    this.sun.color.copy(e.sun); this.sun.intensity = e.sunI * sunVis;
    this.sun.position.copy(this.sun.target.position).addScaledVector(e.sunDir, 120);
    this.snow.material.uniforms.uSnowFall.value = st.snow;
    this.flies.material.uniforms.uAmt.value = (1 - st.winter) * ss(1.3, 2.3, st.todLight) * (1 - st.rain);
    this.mist.material.uniforms.uAmt.value = 0.14 + e.night * 0.22 + st.winter * 0.2 + st.rain * 0.2;
    this.birds.update(dt, st.time, e.night < 0.3 && st.rain < 0.45 && st.snow < 0.5);
    this.lightsMat.opacity = ss(0.4, 0.9, e.night) * (0.75 + 0.25 * Math.sin(st.time * 0.7));
    const cp = this.camera.position;
    this.sky.position.copy(cp);
    this.rain.material.uniforms.uCam.value.copy(cp);
    this.snow.material.uniforms.uCam.value.copy(cp);
    return e;
  }

  /** follow the cabin camera: same orientation, offset into the world */
  syncCamera(cam) {
    this.camera.position.copy(cam.position).add(this.offset);
    this.camera.quaternion.copy(cam.quaternion);
    this.camera.fov = cam.fov; this.camera.aspect = cam.aspect;
    this.camera.updateProjectionMatrix();
  }
}
