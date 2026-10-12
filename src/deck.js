import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// An old portable radio-cassette recorder, built in code. Interactive parts carry userData.part.
const W = 0.31, H = 0.15, D = 0.072;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function brushed(w, h, base) {
  return canvasTex(w, h, (x) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const y = Math.random() * h, l = 40 + Math.random() * 300;
      const v = Math.random() < 0.5 ? 255 : 0;
      x.strokeStyle = `rgba(${v},${v},${v},${0.03 + Math.random() * 0.05})`;
      x.beginPath(); x.moveTo(Math.random() * w, y); x.lineTo(Math.random() * w + l, y); x.stroke();
    }
  });
}

export class Deck {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;
    const tag = (o, part) => { o.traverse(m => { m.userData.part = part; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };

    const plastic = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.36, metalness: 0.0, envMapIntensity: 1.8 });
    const plasticDark = new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, metalness: 1, roughness: 0.12, envMapIntensity: 2 });
    const alu = new THREE.MeshStandardMaterial({ map: brushed(1024, 512, '#c9cac6'), metalness: 0.75, roughness: 0.33, envMapIntensity: 2.4 });

    // body
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.016), plastic);
    g.add(tag(body, 'body'));

    // front aluminium panel with the printing
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.018, H - 0.03), [alu][0]);
    const print = canvasTex(1536, 672, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = 'rgba(25,25,28,.92)';
      // brand and model line
      x.font = '600 34px Helvetica, Arial'; x.fillText('SOLANA', 60, 70);
      x.font = '20px Helvetica, Arial'; x.fillStyle = 'rgba(25,25,28,.75)';
      x.fillText('RC-77  RADIO CASSETTE RECORDER', 245, 68);
      x.fillText('FM · MW · LW', 1240, 68);
      // separating lines
      x.fillStyle = 'rgba(25,25,28,.5)'; x.fillRect(60, 88, w - 120, 2);
      // labels near the cassette door
      x.font = '18px Helvetica, Arial'; x.fillStyle = 'rgba(25,25,28,.8)';
      x.fillText('AUTO STOP', 900, 640); x.fillText('CrO₂ / NORMAL', 1200, 640);
      x.fillText('LEVEL', 1290, 118);
      x.fillText('MIC', 60, 640);
      for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(110 + i * 14, 632, 3, 0, Math.PI * 2); x.fill(); }
    });
    const printM = new THREE.MeshStandardMaterial({ map: print, transparent: true, roughness: 0.5, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1 });
    panel.position.set(0, -0.004, D / 2 + 0.0006);
    const panelPrint = new THREE.Mesh(panel.geometry, printM);
    panelPrint.position.copy(panel.position).add(new THREE.Vector3(0, 0, 0.0003));
    g.add(tag(panel, 'body'), tag(panelPrint, 'body'));

    // speaker: perforated grille, chrome ring
    const grilleTex = canvasTex(1024, 1024, (x, w) => {
      // the cone behind, seen through the holes
      const cg = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      cg.addColorStop(0, '#3a3530'); cg.addColorStop(0.12, '#141210'); cg.addColorStop(0.16, '#2b2723'); cg.addColorStop(0.7, '#1a1816'); cg.addColorStop(1, '#0c0b0a');
      x.fillStyle = cg; x.fillRect(0, 0, w, w);
      // the perforated plate on top: draw metal, punch holes so the cone shows
      const m = document.createElement('canvas'); m.width = m.height = w; const mx = m.getContext('2d');
      const mg = mx.createLinearGradient(0, 0, w, w); mg.addColorStop(0, '#b9bab6'); mg.addColorStop(1, '#8d8e8a');
      mx.fillStyle = mg; mx.fillRect(0, 0, w, w);
      mx.globalCompositeOperation = 'destination-out';
      for (let yy = 10; yy < w; yy += 21) for (let xx = 10 + ((yy / 21 | 0) % 2) * 10.5; xx < w; xx += 21) { mx.beginPath(); mx.arc(xx, yy, 7, 0, Math.PI * 2); mx.fill(); }
      x.drawImage(m, 0, 0);
    });
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.052, 64), new THREE.MeshStandardMaterial({ map: grilleTex, metalness: 0.55, roughness: 0.4, envMapIntensity: 1.6 }));
    grille.position.set(-0.078, -0.012, D / 2 + 0.002);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.0035, 12, 64), chrome);
    ring.position.copy(grille.position).add(new THREE.Vector3(0, 0, 0.001));
    g.add(tag(grille, 'body'), tag(ring, 'body'));

    // tuning scale (backlit strip) with a red pointer
    const dial = canvasTex(1024, 128, (x, w, h) => {
      x.fillStyle = '#e9dfc6'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#2b2620'; x.font = '26px Helvetica, Arial';
      const fm = [88, 92, 96, 100, 104, 108];
      fm.forEach((f, i) => { const px = 70 + i * 170; x.fillText(f, px - 16, 50); });
      for (let i = 0; i <= 60; i++) { const px = 70 + i * 14.2; x.fillRect(px, 58, 2, i % 5 ? 10 : 18); }
      x.font = '22px Helvetica, Arial'; [530, 600, 800, 1000, 1300, 1600].forEach((f, i) => x.fillText(f, 50 + i * 170, 110));
      x.font = 'bold 20px Helvetica, Arial'; x.fillText('FM', 8, 50); x.fillText('MW', 6, 110);
    });
    this.dialMat = new THREE.MeshStandardMaterial({ map: dial, emissive: 0xffd9a0, emissiveMap: dial, emissiveIntensity: 0.0, roughness: 0.3 });
    const dialM = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.017), this.dialMat);
    dialM.position.set(-0.078, 0.048, D / 2 + 0.0016);
    const dialGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.021), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2 }));
    dialGlass.position.copy(dialM.position).add(new THREE.Vector3(0, 0, 0.0012));
    const ptr = new THREE.Mesh(new THREE.PlaneGeometry(0.0012, 0.017), new THREE.MeshBasicMaterial({ color: 0xd8261a }));
    ptr.position.copy(dialM.position).add(new THREE.Vector3(0.012, 0, 0.0006));
    g.add(tag(dialM, 'body'), tag(dialGlass, 'body'), tag(ptr, 'body'));

    // cassette compartment: dark well, the cassette, a smoked door
    const cx = 0.072, cy = -0.012;
    const well = new THREE.Mesh(new THREE.PlaneGeometry(0.118, 0.078), plasticDark);
    well.position.set(cx, cy, D / 2 + 0.0008);
    g.add(tag(well, 'body'));
    const shellTex = canvasTex(1024, 640, (x, w, h) => {
      x.fillStyle = '#d9d4c6'; x.fillRect(0, 0, w, h);
      // label
      x.fillStyle = '#f1ebdc'; x.fillRect(40, 30, w - 80, h - 150);
      x.fillStyle = '#c4553a'; x.fillRect(40, 30, w - 80, 46);
      x.fillStyle = '#2d2a26'; x.font = 'italic 40px Georgia, serif'; x.fillText('lake tapes', 70, 140);
      x.font = '26px Helvetica, Arial'; x.fillText('A', 70, 66 + 0); x.fillStyle = '#fff'; x.font = 'bold 28px Helvetica, Arial'; x.fillText('C-60', w - 170, 66);
      x.strokeStyle = 'rgba(45,42,38,.35)'; x.lineWidth = 2;
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(70, 190 + i * 36); x.lineTo(w - 70, 190 + i * 36); x.stroke(); }
      // window
      x.fillStyle = "#1a1712"; x.beginPath(); x.roundRect(170, 300, w - 340, 150, 20); x.fill();
      x.clearRect(176, 306, w - 352, 138);
      // screws
      x.fillStyle = '#8f8a80'; [[30, 20], [w - 50, 20], [30, h - 40], [w - 50, h - 40], [w / 2 - 10, h - 40]].forEach(([a, b]) => { x.beginPath(); x.arc(a + 10, b + 10, 9, 0, Math.PI * 2); x.fill(); });
      // bottom trapezoid
      x.fillStyle = '#c9c3b4'; x.beginPath(); x.moveTo(180, h); x.lineTo(240, h - 90); x.lineTo(w - 240, h - 90); x.lineTo(w - 180, h); x.fill();
    });
    const shell = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0625), new THREE.MeshStandardMaterial({ map: shellTex, transparent: true, roughness: 0.55 }));
    shell.position.set(cx, cy, D / 2 + 0.0045);
    g.add(tag(shell, 'body'));
    // reels behind the shell window: tape packs and toothed hubs
    const hubTex = canvasTex(256, 256, (x) => {
      x.clearRect(0, 0, 256, 256);
      x.fillStyle = '#f2efe8'; x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.arc(128, 128, 54, 0, Math.PI * 2, true); x.fill();
      x.fillStyle = '#f2efe8';
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; x.save(); x.translate(128, 128); x.rotate(a); x.fillRect(-9, -60, 18, 26); x.restore(); }
    });
    const hubMat = new THREE.MeshStandardMaterial({ map: hubTex, transparent: true, roughness: 0.5 });
    const packMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.35, metalness: 0.1 });
    this.reels = [-1, 1].map(s => {
      const r = new THREE.Group();
      r.position.set(cx + s * 0.0215, cy - 0.0054, D / 2 + 0.003);
      const pack = new THREE.Mesh(new THREE.CircleGeometry(1, 48), packMat);
      const hub = new THREE.Mesh(new THREE.PlaneGeometry(0.011, 0.011), hubMat);
      hub.position.z = 0.0003;
      r.add(pack, hub);
      g.add(tag(r, 'body'));
      return { r, pack, hub };
    });
    // the smoked door
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.122, 0.082, 0.004, 2, 0.0015), new THREE.MeshStandardMaterial({ color: 0x2b2420, transparent: true, opacity: 0.38, roughness: 0.06, metalness: 0.1, envMapIntensity: 2 }));
    door.position.set(cx, cy, D / 2 + 0.008);
    g.add(tag(door, 'body'));

    // VU meter
    const vuTex = canvasTex(256, 128, (x, w, h) => {
      x.fillStyle = '#efe4c4'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#2b2620'; x.lineWidth = 3;
      x.beginPath(); x.arc(128, 150, 110, Math.PI * 1.22, Math.PI * 1.78); x.stroke();
      x.strokeStyle = '#c83a24'; x.lineWidth = 5; x.beginPath(); x.arc(128, 150, 110, Math.PI * 1.62, Math.PI * 1.78); x.stroke();
      x.fillStyle = '#2b2620'; x.font = 'bold 18px Helvetica'; x.fillText('VU', 116, 110);
    });
    const vu = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.015), new THREE.MeshStandardMaterial({ map: vuTex, emissive: 0xffd9a0, emissiveMap: vuTex, emissiveIntensity: 0, roughness: 0.4 }));
    vu.position.set(0.112, 0.048, D / 2 + 0.0016);
    this.vuMat = vu.material;
    this.needle = new THREE.Mesh(new THREE.PlaneGeometry(0.0006, 0.013), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    this.needle.geometry.translate(0, 0.0065, 0);
    this.needle.position.set(0.112, 0.0405, D / 2 + 0.0022);
    g.add(tag(vu, 'body'), tag(this.needle, 'body'));
    // three-digit tape counter with a reset button
    const ctrTex = canvasTex(256, 96, (x, w, h) => {
      x.fillStyle = '#0d0d0e'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 3; i++) { x.fillStyle = '#ece6d6'; x.fillRect(18 + i * 76, 12, 64, 72); x.fillStyle = '#1a1814'; x.font = 'bold 58px Helvetica'; x.textAlign = 'center'; x.fillText(['0', '4', '7'][i], 50 + i * 76, 68); }
    });
    const ctr = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.0085), new THREE.MeshStandardMaterial({ map: ctrTex, roughness: 0.4 }));
    ctr.position.set(0.072, 0.03, D / 2 + 0.0018);
    g.add(tag(ctr, 'body'));
    for (const [sx, sy] of [[-W / 2 + 0.012, H / 2 - 0.02], [W / 2 - 0.012, H / 2 - 0.02], [-W / 2 + 0.012, -H / 2 + 0.014], [W / 2 - 0.012, -H / 2 + 0.014]]) {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.001, 12), chrome);
      sc.rotation.x = Math.PI / 2; sc.position.set(sx, sy, D / 2 + 0.0014); g.add(tag(sc, 'body'));
    }
    // record LED
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0xff2a10, emissiveIntensity: 0 }));
    this.led.position.set(0.0365, 0.048, D / 2 + 0.002);
    g.add(tag(this.led, 'body'));

    // piano keys on the top, at the front edge
    const keyDefs = [['rec', 0xb22a1e], ['rew', 0x2a2a2c], ['play', 0x2a2a2c], ['ff', 0x2a2a2c], ['stop', 0x2a2a2c], ['pause', 0x2a2a2c]];
    const keyLbl = { rec: '●', rew: '◀◀', play: '▶', ff: '▶▶', stop: '■ ▲', pause: '❚❚' };
    this.keys = {};
    keyDefs.forEach(([k, col], i) => {
      const key = new THREE.Group();
      const kw = 0.0165;
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(kw, 0.012, 0.034, 2, 0.002), new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.2 }));
      mesh.position.y = 0.006;
      const lt = canvasTex(128, 64, (x, w, h) => { x.fillStyle = '#d7d4cc'; x.font = 'bold 34px Helvetica, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(keyLbl[k], w / 2, h / 2 + 2); });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(kw * 0.85, kw * 0.42), new THREE.MeshBasicMaterial({ map: lt, transparent: true }));
      label.position.set(0, 0.006, 0.0172); label.material.toneMapped = false;
      key.add(mesh, label);
      key.position.set(0.02 + i * (kw + 0.0018), H / 2 - 0.004, D / 2 - 0.02);
      g.add(tag(key, k));
      this.keys[k] = { key, down: 0, target: 0 };
    });

    // volume knob on top, knurled
    const knob = new THREE.Group();
    const kGeo = new THREE.CylinderGeometry(0.0145, 0.0155, 0.014, 48);
    const kp = kGeo.attributes.position;
    for (let i = 0; i < kp.count; i++) { const a = Math.atan2(kp.getZ(i), kp.getX(i)); const r = Math.hypot(kp.getX(i), kp.getZ(i)); if (r > 0.012) { const k = 1 + 0.035 * (Math.cos(a * 24) > 0 ? 1 : 0); kp.setX(i, kp.getX(i) * k); kp.setZ(i, kp.getZ(i) * k); } }
    kGeo.computeVertexNormals();
    const kb = new THREE.Mesh(kGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.35, metalness: 0.4 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.0012, 48), chrome);
    cap.position.y = 0.0075;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.0014, 0.009), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mark.position.set(0, 0.0082, -0.0055);
    knob.add(kb, cap, mark);
    knob.position.set(-0.12, H / 2 + 0.007, 0.006);
    g.add(tag(knob, 'vol'));
    this.knob = knob;
    const scale = canvasTex(256, 256, (x, w) => {
      x.clearRect(0, 0, w, w); x.strokeStyle = 'rgba(220,220,215,.8)'; x.lineWidth = 3; x.translate(128, 128);
      for (let i = 0; i <= 10; i++) { const a = -Math.PI * 0.75 + i * Math.PI * 0.15 - Math.PI / 2; x.beginPath(); x.moveTo(Math.cos(a) * 92, Math.sin(a) * 92); x.lineTo(Math.cos(a) * (i % 5 ? 104 : 116), Math.sin(a) * (i % 5 ? 104 : 116)); x.stroke(); }
      x.fillStyle = 'rgba(220,220,215,.9)'; x.font = 'bold 22px Helvetica'; x.textAlign = 'center'; x.fillText('VOLUME', 0, 110 + 0);
    });
    const scaleM = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: scale, transparent: true, color: 0x9a9a96 }));
    scaleM.rotation.x = -Math.PI / 2; scaleM.position.set(-0.12, H / 2 + 0.0004, 0.006);
    g.add(tag(scaleM, 'vol'));

    // carrying handle and a telescopic antenna
    const hp = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.1, H / 2, -0.012), new THREE.Vector3(-0.095, H / 2 + 0.028, -0.012), new THREE.Vector3(-0.07, H / 2 + 0.036, -0.012),
      new THREE.Vector3(0.07, H / 2 + 0.036, -0.012), new THREE.Vector3(0.095, H / 2 + 0.028, -0.012), new THREE.Vector3(0.1, H / 2, -0.012)]);
    const handle = new THREE.Mesh(new THREE.TubeGeometry(hp, 64, 0.0045, 12), chrome);
    g.add(tag(handle, 'body'));
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.008, 0.02, 2, 0.003), plastic); m.position.set(s * 0.1, H / 2 + 0.002, -0.012); g.add(tag(m, 'body')); }
    const ant = new THREE.Group();
    [[0.0028, 0.1], [0.0022, 0.09], [0.0017, 0.08]].forEach(([r, l], i) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), chrome); c.position.y = i * 0.085 + l / 2; ant.add(c); });
    ant.rotation.z = -Math.PI / 2 + 0.06; ant.position.set(-0.13, H / 2 - 0.004, -D / 2 + 0.006);
    g.add(tag(ant, 'body'));
    // side tuning wheel
    const tune = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 40), new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.4 }));
    tune.rotation.z = Math.PI / 2; tune.position.set(W / 2 + 0.002, 0.02, 0);
    g.add(tag(tune, 'body'));
    // little feet
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.004, 12), plasticDark); f.position.set(sx * (W / 2 - 0.02), -H / 2 - 0.002, sz * (D / 2 - 0.012)); g.add(f); }

    this.group.position.y = H / 2 + 0.004;
    this.root = new THREE.Group(); this.root.add(this.group);
    this.angle = [0, 0];
  }

  /** press a key down (latching keys stay down while engaged) */
  press(k, latch) { const K = this.keys[k]; if (!K) return; K.target = 1; K.latch = latch; K.t = 0.18; }
  release(k) { const K = this.keys[k]; if (K) { K.target = 0; K.latch = false; } }

  update(dt, tape, light) {
    for (const [k, K] of Object.entries(this.keys)) {
      if (!K.latch) { K.t = (K.t || 0) - dt; if (K.t <= 0) K.target = 0; }
      K.down += (K.target - K.down) * Math.min(1, dt * 30);
      K.key.position.y = H / 2 - 0.004 - K.down * 0.0065;
      K.key.rotation.x = K.down * 0.12;
    }
    this.keys.play.target = tape.on ? 1 : (this.keys.play.t > 0 ? 1 : 0);
    // reels: tape speed is constant, so the smaller pack turns faster
    const p = tape.progress();
    const rMin = 0.0062, rMax = 0.0175;
    const rs = [Math.sqrt(rMin * rMin + (rMax * rMax - rMin * rMin) * (1 - p)), Math.sqrt(rMin * rMin + (rMax * rMax - rMin * rMin) * p)];
    const v = tape.state === 'play' || tape.state === 'leader' ? 0.047 : tape.state === 'wind' ? 0.047 * Math.abs(tape.speed) : 0;
    const dir = tape.state === 'wind' && tape.speed < 0 ? -1 : 1;
    this.reels.forEach((R, i) => {
      R.pack.scale.setScalar(rs[i]);
      this.angle[i] -= dir * v / rs[i] * dt;
      R.hub.rotation.z = this.angle[i];
    });
    // VU needle with ballistics
    const lvl = Math.min(1, tape.level() * 5.5);
    this.vu = (this.vu || 0) + (lvl - (this.vu || 0)) * Math.min(1, dt * (lvl > this.vu ? 18 : 5));
    this.needle.rotation.z = 0.75 - this.vu * 1.5;
    const lit = tape.on ? 1 : 0;
    this.dialMat.emissiveIntensity += ((0.15 + lit * 0.45) * (0.4 + light) - this.dialMat.emissiveIntensity) * Math.min(1, dt * 6);
    this.vuMat.emissiveIntensity = this.dialMat.emissiveIntensity * 0.8;
    this.led.material.emissiveIntensity = tape.on ? 2.2 : 0;
    this.knob.rotation.y = -(tape.vol - 0.5) * Math.PI * 1.5;
  }
}
export const DECK_SIZE = { W, H, D };
