import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Cabin interior, in metres. The glass sits in the plane z = 0, the room is z > 0.
export const WIN = { x0: -0.6, x1: 0.6, y0: 0.97, y1: 2.13 }; // glass extents (both sashes)
export const SILL_Y = 0.95;

const texLoader = new THREE.TextureLoader();
function pbr(name, repeat = [1, 1], opts = {}) {
  const load = (f, srgb) => {
    const t = texLoader.load(`assets/tex/${name}/${f}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const arm = load('arm');
  return new THREE.MeshStandardMaterial({
    map: load('Diffuse', true), normalMap: load('nor_gl'), roughnessMap: arm, metalnessMap: arm, aoMap: arm,
    metalness: 0, roughness: 1, ...opts,
  });
}
// box whose UVs are scaled to metres so textures keep a constant density
function box(w, h, d, mat, r = 0.004) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const su = ax > 0.5 ? d : w, sv = ay > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  g.setAttribute('uv1', g.attributes.uv);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export class Room {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const wallMat = pbr('wood_plank_wall', [0.8, 0.8], { color: 0xb8a690 });
    const sillMat = pbr('wood_table_worn', [1.2, 1.2]);
    const frameMat = pbr('wood_cabinet_worn_long', [2, 2], { color: 0xd2c2ad });
    this.frameMat = frameMat;

    // wall with a window hole (inner face at z = 0.12)
    const T = 0.24, zc = 0.12 - T / 2;
    const { x0, x1, y0, y1 } = WIN;
    const ox0 = x0 - 0.02, ox1 = x1 + 0.02, oy0 = SILL_Y, oy1 = y1 + 0.02;
    const add = (m, x, y, z) => { m.position.set(x, y, z); this.group.add(m); return m; };
    add(box(4, oy0, T, wallMat, 0), 0, oy0 / 2, zc);
    add(box(4, 3.2 - oy1, T, wallMat, 0), 0, oy1 + (3.2 - oy1) / 2, zc);
    add(box(2 - ox1, oy1 - oy0, T, wallMat, 0), ox1 + (2 - ox1) / 2, (oy0 + oy1) / 2, zc);
    add(box(2 + ox0, oy1 - oy0, T, wallMat, 0), ox0 - (2 + ox0) / 2, (oy0 + oy1) / 2, zc);

    // casing trim around the opening, proud of the wall
    const cw = 0.1, ct = 0.028;
    add(box(ox1 - ox0 + cw * 2, cw, ct, frameMat), 0, oy1 + cw / 2, 0.12 + ct / 2);
    add(box(cw, oy1 - oy0 + cw, ct, frameMat), ox0 - cw / 2, (oy0 + oy1 + cw) / 2, 0.12 + ct / 2);
    add(box(cw, oy1 - oy0 + cw, ct, frameMat), ox1 + cw / 2, (oy0 + oy1 + cw) / 2, 0.12 + ct / 2);
    // jambs (reveal) inside the opening
    add(box(0.02, oy1 - oy0, 0.15, frameMat, 0.002), ox0 + 0.01, (oy0 + oy1) / 2, 0.05);
    add(box(0.02, oy1 - oy0, 0.15, frameMat, 0.002), ox1 - 0.01, (oy0 + oy1) / 2, 0.05);
    add(box(ox1 - ox0, 0.02, 0.15, frameMat, 0.002), 0, oy1 - 0.01, 0.05);

    // deep sill (stool) + apron
    const sill = add(box(1.9, 0.05, 0.5, sillMat, 0.008), 0, SILL_Y - 0.025, 0.17);
    sill.name = 'sill';
    add(box(1.5, 0.09, 0.025, frameMat), 0, SILL_Y - 0.1, 0.135);
    // outer sill beyond the glass (gets wet when the window is open)
    add(box(ox1 - ox0, 0.03, 0.12, frameMat, 0.004), 0, SILL_Y - 0.02, -0.07);

    // two casement sashes, hinged at the outer edges, swinging outward
    this.sashes = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side < 0 ? x0 : x1, 0, 0);
      this.group.add(pivot);
      const w = (x1 - x0) / 2, h = y1 - y0, sw = 0.055, sd = 0.05;
      const sx = -side * w / 2; // sash centre relative to pivot
      const frame = new THREE.Group();
      frame.position.set(sx, (y0 + y1) / 2, 0);
      const st = (bw, bh, x, y) => { const m = box(bw, bh, sd, frameMat, 0.006); m.position.set(x, y, 0); frame.add(m); };
      st(sw, h, -w / 2 + sw / 2, 0); st(sw, h, w / 2 - sw / 2, 0);
      st(w - sw * 2, sw, 0, h / 2 - sw / 2); st(w - sw * 2, sw * 1.3, 0, -h / 2 + sw * 0.65);
      pivot.add(frame);
      // glass rectangle in sash-local coords; uv covers the shared glass texture area of this pane
      const gw = w - sw * 2 + 0.01, gh = h - sw * 2.3 + 0.01;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), null);
      glass.position.set(0, (sw * 1.3 - sw) / 2 * -0.0 + 0.004, 0.0);
      // world-space glass rect (closed) used to map into the shared drop/fog textures
      const cx = (side < 0 ? x0 : x1) + sx, cy = (y0 + y1) / 2 + 0.004;
      glass.userData.rect = { x0: cx - gw / 2, x1: cx + gw / 2, y0: cy - gh / 2, y1: cy + gh / 2 };
      frame.add(glass);
      this.sashes.push({ pivot, frame, glass, side, open: 0 });
    }
    // latch on the right sash's meeting stile
    const latch = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.32 });
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.07, 0.012, 2, 0.004), brass);
    const lever = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.1, 0.014, 2, 0.006), brass);
    lever.position.set(0, -0.04, 0.012); lever.geometry.translate(0, -0.03, 0);
    base.castShadow = lever.castShadow = true;
    latch.add(base, lever);
    latch.position.set(-(x1 - x0) / 2 + 0.03, 1.52, 0.032);
    this.sashes[1].pivot.add(latch);
    this.latch = latch; this.lever = lever;

    // room fill: soft light bouncing around, very low
    this.hemi = new THREE.HemisphereLight(0x8a7a6a, 0x2a1d14, 0.15);
    scene.add(this.hemi);
    // daylight through the window
    this.day = new THREE.DirectionalLight(0xffffff, 1);
    this.day.position.set(0.8, 3.2, -3.5);
    this.day.target.position.set(0, SILL_Y, 0.3);
    this.day.castShadow = true;
    this.day.shadow.mapSize.set(2048, 2048);
    Object.assign(this.day.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 8 });
    this.day.shadow.bias = -0.0004; this.day.shadow.normalBias = 0.02;
    scene.add(this.day, this.day.target);
    this.skyFill = new THREE.PointLight(0xffffff, 0, 4, 2);
    this.skyFill.position.set(0, 1.55, -0.3);
    scene.add(this.skyFill);

    this.props = {};
  }

  async loadProps() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const load = (id) => loader.loadAsync(`assets/models/${id}.glb`).then(g => {
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        // glass covers use KHR transmission, which needs its own render pass; fake it
        const m = o.material;
        if (m && /glass/i.test(m.name || '') && !/oil_lamp/.test(m.name || '')) {
          o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, depthWrite: false });
          o.castShadow = false;
          return;
        }
        if (m && m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.18; m.depthWrite = false; m.roughness = 0.05; o.castShadow = false; }
      });
      return g.scene;
    });
    const [candle, lamp, tea, tape, clock, plant] = await Promise.all(
      ['wooden_candlestick', 'vintage_oil_lamp', 'tea_set_01', 'portable_cassette_player', 'alarm_clock_01', 'potted_plant_04'].map(load));
    const put = (o, x, z, ry = 0, s = 1) => { o.position.set(x, SILL_Y, z); o.rotation.y = ry; o.scale.setScalar(s); this.group.add(o); return o; };

    put(lamp, -0.74, 0.28, 0.4, 0.9);
    put(plant, -0.43, 0.13, 0.8);
    put(candle, -0.16, 0.24, 0);
    // tea: keep one cup on its saucer
    const cup = tea.getObjectByName('tea_set_01_cup_small_01');
    const saucer = tea.getObjectByName('tea_set_01_saucer_circular_04');
    const teaG = new THREE.Group();
    for (const o of [cup, saucer]) { o.position.x = 0; o.position.z = 0; teaG.add(o); }
    put(teaG, 0.17, 0.3, -0.5);
    put(tape, 0.47, 0.17, -0.25);
    // the tape player stands upright facing the room
    put(clock, 0.74, 0.25, -0.45);

    this.props = { candle, lamp, cup: teaG, tape, clock, plant };
    // name the clickable roots
    for (const [k, o] of Object.entries(this.props)) o.traverse(m => { m.userData.prop = k; });

    // warm lights
    this.candleLight = new THREE.PointLight(0xff9a48, 0, 5, 2);
    this.candleLight.position.set(-0.16, SILL_Y + 0.29, 0.24);
    this.candleLight.castShadow = true;
    this.candleLight.shadow.mapSize.set(512, 512);
    this.candleLight.shadow.bias = -0.002;
    this.candleLight.shadow.camera.near = 0.03;
    this.scene.add(this.candleLight);
    this.lampLight = new THREE.PointLight(0xffb26a, 0, 7, 2);
    this.lampLight.position.set(-0.74, SILL_Y + 0.47, 0.28);
    this.lampLight.castShadow = true;
    this.lampLight.shadow.mapSize.set(512, 512);
    this.lampLight.shadow.bias = -0.002;
    this.lampLight.shadow.camera.near = 0.05;
    this.scene.add(this.lampLight);
    // the lamp's own flame mesh glows
    const flame = lamp.getObjectByName('vintage_oil_lamp_flame');
    if (flame) { this.lampFlame = flame; flame.material = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true }); }
    const glass = lamp.getObjectByName('vintage_oil_lamp_glass');
    if (glass) {
      // clear chimney glass that warms up when the lamp is lit
      this.chimney = glass.material = new THREE.MeshStandardMaterial({ color: 0xfff4e6, transparent: true, opacity: 0.16, roughness: 0.05, emissive: 0xffa040, emissiveIntensity: 0, depthWrite: false });
      glass.castShadow = false;
    }
    // clock hands: pivot them about the hub (where all three overlap in the rest pose)
    const handObjs = ['houd_hand', 'minute_hand', 'second_hand'].map(n => clock.getObjectByName(n));
    if (handObjs.every(Boolean)) {
      const saved = { p: clock.position.clone(), r: clock.rotation.clone(), s: clock.scale.clone(), parent: clock.parent };
      clock.removeFromParent(); clock.position.set(0, 0, 0); clock.rotation.set(0, 0, 0); clock.scale.set(1, 1, 1);
      clock.updateMatrixWorld(true);
      // the hub, in clock space (from the source model; the optimised GLB recentres each hand)
      const c = new THREE.Vector3(0, 0.065, 0.025);
      this.hands = handObjs.map(h => { const pv = new THREE.Group(); pv.position.copy(c); clock.add(pv); pv.updateMatrixWorld(true); pv.attach(h); return pv; });
      clock.position.copy(saved.p); clock.rotation.copy(saved.r); clock.scale.copy(saved.s); saved.parent.add(clock);
    }
    return this.props;
  }
}
