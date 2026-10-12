import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Deck } from './deck.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { frameRect, bar, SASH, SASH_W, FRAME, FRAME_W, CASING, CASING_W, MUNTIN } from './profile.js';

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

// Old painted wood: the scan's bare-wood patches show through, its paint is replaced by our colour.
function paint(mat, hex) {
  const c = new THREE.Color(hex);
  mat.customProgramCacheKey = () => 'paint' + hex;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: c };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPaint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 t = diffuseColor.rgb;
          float wood = smoothstep(0.07, 0.17, t.r - t.b);
          float l = dot(t, vec3(.3, .59, .11));
          vec3 p = uPaint * (0.78 + 1.6 * l) ;
          diffuseColor.rgb = mix(p, t * 1.1, wood);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor * 0.8, roughnessFactor, 0.5);');
  };
  return mat;
}

export class Room {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const wallMat = pbr('wood_plank_wall', [0.8, 0.8], { color: 0xb8a690 });
    const sillMat = pbr('wood_table_worn', [1.2, 1.2]);
    const frameMat = paint(pbr('wood_peeling_paint_weathered', [3, 3], { side: THREE.DoubleSide }), 0xd8d0bf);
    const liningMat = paint(pbr('wood_peeling_paint_weathered', [3, 3]), 0xcfc6b4);
    this.frameMat = frameMat;
    const brass = new THREE.MeshStandardMaterial({ color: 0xc09a58, metalness: 1, roughness: 0.28, envMapIntensity: 1.6 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2724, metalness: 0.8, roughness: 0.5 });

    const { x0, x1, y0, y1 } = WIN;
    const cxw = (x0 + x1) / 2, cyw = (y0 + y1) / 2;
    // the hole in the wall is the outside of the fixed frame
    const hx0 = x0 - FRAME_W, hx1 = x1 + FRAME_W, hy0 = SILL_Y, hy1 = y1 + FRAME_W;
    const T = 0.24, zc = 0.12 - T / 2;
    const add = (m, x, y, z) => { m.position.set(x, y, z); this.group.add(m); return m; };
    add(box(4, hy0, T, wallMat, 0), 0, hy0 / 2, zc);
    add(box(4, 3.2 - hy1, T, wallMat, 0), 0, hy1 + (3.2 - hy1) / 2, zc);
    add(box(2 - hx1, hy1 - hy0, T, wallMat, 0), hx1 + (2 - hx1) / 2, (hy0 + hy1) / 2, zc);
    add(box(2 + hx0, hy1 - hy0, T, wallMat, 0), hx0 - (2 + hx0) / 2, (hy0 + hy1) / 2, zc);

    // fixed frame (its bottom member is buried in the stool up to SILL_Y)
    const frame = frameRect(FRAME, x1 - x0 + FRAME_W * 2, y1 - y0 + FRAME_W * 2, frameMat);
    add(frame, cxw, cyw, 0);
    // jamb linings between the frame and the room face of the wall
    const ld = 0.12 - 0.05, lt = 0.016;
    add(box(lt, hy1 - hy0, ld, liningMat, 0.002), hx0 + lt / 2, (hy0 + hy1) / 2, 0.05 + ld / 2);
    add(box(lt, hy1 - hy0, ld, liningMat, 0.002), hx1 - lt / 2, (hy0 + hy1) / 2, 0.05 + ld / 2);
    add(box(hx1 - hx0, lt, ld, liningMat, 0.002), cxw, hy1 - lt / 2, 0.05 + ld / 2);
    // architrave: mitred at the head, butting onto the stool at the foot
    const cw = hx1 - hx0 + CASING_W * 2, ch = hy1 - hy0 + CASING_W;
    const casing = frameRect(CASING, cw, ch, frameMat, { sides: ['left', 'top', 'right'], butt: { 'left:bottom': 1, 'right:bottom': 1 } });
    add(casing, cxw, hy0 + ch / 2, 0.12);

    // deep stool with a rounded nosing, and the apron under it
    const sill = add(box(1.9, 0.05, 0.5, sillMat, 0.012), 0, SILL_Y - 0.025, 0.17);
    sill.name = 'sill';
    this.sill = sill;
    add(box(cw - 0.04, 0.1, 0.022, frameMat, 0.006), cxw, SILL_Y - 0.1, 0.131);
    // outside sill beyond the glass
    add(box(hx1 - hx0 + 0.06, 0.035, 0.16, liningMat, 0.006), cxw, y0 - FRAME_W - 0.0, -0.13);

    // two casement sashes, hinged at the outer edges, swinging outward
    this.sashes = [];
    const w = (x1 - x0) / 2, h = y1 - y0;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side < 0 ? x0 : x1, 0, 0);
      this.group.add(pivot);
      const sx = -side * w / 2;
      const sash = new THREE.Group();
      sash.position.set(sx, cyw, 0);
      sash.add(frameRect(SASH, w, h, frameMat));
      // one glazing bar a little above the middle
      const mb = bar(MUNTIN, w - SASH_W * 2 + 0.03, frameMat);
      mb.position.y = h * 0.1;
      sash.add(mb);
      // hinge knuckles on the outer stile
      for (const hy of [-h / 2 + 0.16, h / 2 - 0.16]) {
        const k = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.075, 12), iron);
        k.position.set(-sx, hy, -0.03); k.castShadow = true;
        sash.add(k);
      }
      // casement stay resting along the bottom rail
      const stay = new THREE.Group();
      const arm = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.011, 0.006, 2, 0.003), brass);
      arm.position.x = side * 0.11;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.008, 14, 10), brass);
      knob.position.x = side * 0.225;
      const plate = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.026, 0.004, 2, 0.002), brass);
      stay.add(arm, knob, plate);
      stay.traverse(o => { if (o.isMesh) o.castShadow = true; });
      stay.position.set(-sx - side * 0.0 + side * -0.0 + (side < 0 ? -w / 2 + 0.07 : w / 2 - 0.07) * -1 * -1, -h / 2 + 0.03, 0.028);
      stay.position.x = side < 0 ? -w / 2 + 0.08 : w / 2 - 0.08;
      stay.scale.x = side < 0 ? -1 : 1;
      sash.add(stay);
      pivot.add(sash);
      // glass behind the ovolo; its world rect maps into the shared drop/mist textures
      const inset = 0.044;
      const gw = w - inset * 2, gh = h - inset * 2;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), null);
      sash.add(glass);
      const cx = (side < 0 ? x0 : x1) + sx;
      glass.userData.rect = { x0: cx - gw / 2, x1: cx + gw / 2, y0: cyw - gh / 2, y1: cyw + gh / 2 };
      this.sashes.push({ pivot, frame: sash, glass, side, open: 0 });
    }

    // cockspur fastener on the right sash's meeting stile
    const latch = new THREE.Group();
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.026, 0.075, 0.008, 3, 0.0035), brass);
    const lever = new THREE.Group();
    const spine = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.012), new THREE.Vector3(0.003, -0.03, 0.016), new THREE.Vector3(0.012, -0.065, 0.02), new THREE.Vector3(0.026, -0.092, 0.019),
    ]);
    const handle = new THREE.Mesh(new THREE.TubeGeometry(spine, 24, 0.0042, 10), brass);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 16, 12), brass);
    ball.position.set(0.027, -0.094, 0.019);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.012, 16), brass);
    boss.rotation.x = Math.PI / 2; boss.position.z = 0.008;
    const spur = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.008, 0.008, 2, 0.003), brass);
    spur.position.set(-0.014, 0.004, 0.011);
    lever.add(handle, ball, boss, spur);
    latch.add(base, lever);
    latch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    latch.position.set(-w + SASH_W / 2 + 0.004, cyw + 0.02, 0.025 + 0.004);
    this.sashes[1].pivot.add(latch);
    this.latch = latch; this.lever = lever;
    // the keep it hooks onto, on the left sash
    const keep = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.03, 0.01, 2, 0.003), brass);
    keep.position.set(w - SASH_W / 2 + 0.006, cyw + 0.024, 0.03);
    keep.castShadow = true;
    this.sashes[0].pivot.add(keep);

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
    // the whole window glows into the room: a rectangular area light in the glass
    RectAreaLightUniformsLib.init();
    this.skyFill = new THREE.RectAreaLight(0xffffff, 0, WIN.x1 - WIN.x0, WIN.y1 - WIN.y0);
    this.skyFill.position.set((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, -0.03);
    this.skyFill.lookAt(this.skyFill.position.x, this.skyFill.position.y, 1);
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
    const [candle, lamp, tea, clock, plant] = await Promise.all(
      ['wooden_candlestick', 'vintage_oil_lamp', 'tea_set_01', 'alarm_clock_01', 'potted_plant_04'].map(load));
    this.deck = new Deck();
    const tape = this.deck.root;
    const put = (o, x, z, ry = 0, s = 1) => { o.position.set(x, SILL_Y, z); o.rotation.y = ry; o.scale.setScalar(s); this.group.add(o); return o; };

    put(lamp, -0.74, 0.28, 0.4, 0.9);
    put(plant, -0.5, 0.14, 0.8);
    put(candle, -0.27, 0.25, 0);
    put(tape, 0.52, 0.2, -0.28);
    put(clock, 0.82, 0.3, -0.5);
    this.teaScene = tea;

    this.props = { candle, lamp, tape, clock, plant };
    // name the clickable roots; heavy scans get a simple invisible box to click instead of their mesh
    for (const [k, o] of Object.entries(this.props)) o.traverse(m => { m.userData.prop = k; });
    this.proxies = [];
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    for (const k of ['candle', 'lamp', 'plant', 'clock']) {
      const b = new THREE.Box3().setFromObject(this.props[k]);
      const px = new THREE.Mesh(new THREE.BoxGeometry(...b.getSize(new THREE.Vector3()).toArray()), hidden);
      b.getCenter(px.position); px.userData.prop = k;
      this.scene.add(px); this.proxies.push(px);
    }

    // warm lights
    this.candleLight = new THREE.PointLight(0xff9a48, 0, 5, 2);
    this.candleLight.position.set(-0.27, SILL_Y + 0.29, 0.25);
    this.candleLight.castShadow = false; // a point-light shadow per pixel was the main cost
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
      // clear chimney glass: two passes (inside wall, then outside wall) of a fresnel shader
      this.chimney = { uniforms: { uLamp: { value: 0 }, uFlameY: { value: 0 }, uSky: { value: new THREE.Color(0.5, 0.55, 0.6) }, uWarm: { value: new THREE.Color(1, 0.62, 0.3) } } };
      const mk = (sideMode, order) => {
        const m = new THREE.ShaderMaterial({
          uniforms: this.chimney.uniforms, transparent: true, depthWrite: false, side: sideMode,
          vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vY;
            void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vY = position.y;
              vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
              gl_Position = projectionMatrix * viewMatrix * w; }`,
          fragmentShader: `uniform float uLamp, uFlameY; uniform vec3 uSky, uWarm;
            varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vY;
            void main(){
              vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
              float c = abs(dot(n, vV));
              float fres = 0.04 + 0.96 * pow(1. - c, 5.);
              // the window behind the viewer is a bright rectangle: crisp vertical streaks of it
              vec3 vn = normalize((viewMatrix * vec4(n, 0.)).xyz);
              float streak = smoothstep(0.42, 0.47, vn.x) * smoothstep(0.62, 0.55, vn.x) + smoothstep(-0.62, -0.58, vn.x) * smoothstep(-0.5, -0.56, vn.x) * 0.5;
              vec3 refl = uSky * (0.35 + streak * 1.8) + uWarm * uLamp * 0.5;
              // flame light caught inside the glass, strongest near the wick
              float glow = exp(-pow((vW.y - uFlameY) / 0.06, 2.)) * uLamp;
              vec3 col = refl * fres + uWarm * glow * (0.25 + fres) ;
              float a = clamp(fres * 1.15 + streak * 0.35 + glow * 0.18 + 0.025, 0., 1.);
              gl_FragColor = vec4(col / max(a, 0.001), a);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
        });
        return m;
      };
      glass.material = mk(THREE.BackSide);
      const outer = glass.clone(); outer.material = mk(THREE.FrontSide);
      glass.renderOrder = 4; outer.renderOrder = 5;
      glass.parent.add(outer);
      glass.castShadow = outer.castShadow = false;
      glass.userData.prop = outer.userData.prop = 'lamp';
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
