import * as THREE from 'three';

// Joinery from 2D cross-sections. A profile is a closed loop of [u, v, smooth?] points:
// u = distance in from the member's outer edge, v = depth (room side +).

export function arc(cu, cv, r, a0, a1, n = 6) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, i > 0 && i < n]); }
  return pts;
}

function prepare(profile) {
  const P = profile.map(p => ({ u: p[0], v: p[1], smooth: !!p[2] }));
  let area = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a.u * b.v - b.u * a.v; }
  const sgn = area > 0 ? 1 : -1;
  const segs = [];
  let arcLen = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const du = b.u - a.u, dv = b.v - a.v, l = Math.hypot(du, dv) || 1e-6;
    segs.push({ a, b, n: [sgn * dv / l, -sgn * du / l], s0: arcLen, s1: arcLen + l });
    arcLen += l;
  }
  // smooth points share the average of their two segment normals
  const N = segs.length;
  for (let i = 0; i < N; i++) {
    const s = segs[i], prev = segs[(i - 1 + N) % N], next = segs[(i + 1) % N];
    s.na = s.a.smooth ? norm2(add2(prev.n, s.n)) : s.n;
    s.nb = s.b.smooth ? norm2(add2(s.n, next.n)) : s.n;
  }
  return segs;
}
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const norm2 = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

/**
 * One straight member of length L. O = start corner (outer edge), A = along, B = inward, Z = depth axis.
 * miter0/miter1: cut the ends at 45 degrees (for picture-frame corners).
 */
export function memberGeometry(profile, L, O, A, B, Z = new THREE.Vector3(0, 0, 1), miter0 = true, miter1 = true) {
  const segs = prepare(profile);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), Nv = new THREE.Vector3();
  const put = (u, v, z, n, s) => {
    P.copy(O).addScaledVector(A, z).addScaledVector(B, u).addScaledVector(Z, v);
    Nv.copy(B).multiplyScalar(n[0]).addScaledVector(Z, n[1]).normalize();
    pos.push(P.x, P.y, P.z); nor.push(Nv.x, Nv.y, Nv.z); uv.push(z, s);
  };
  for (const s of segs) {
    const base = pos.length / 3;
    const za0 = miter0 ? s.a.u : 0, zb0 = miter0 ? s.b.u : 0;
    const za1 = miter1 ? L - s.a.u : L, zb1 = miter1 ? L - s.b.u : L;
    put(s.a.u, s.a.v, za0, s.na, s.s0); put(s.b.u, s.b.v, zb0, s.nb, s.s1);
    put(s.a.u, s.a.v, za1, s.na, s.s0); put(s.b.u, s.b.v, zb1, s.nb, s.s1);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Picture-frame rectangle of outer size w x h centred at the origin, in the XY plane. */
export function frameRect(profile, w, h, mat, { sides = ['bottom', 'right', 'top', 'left'], butt = {} } = {}) {
  const g = new THREE.Group();
  const V = (x, y) => new THREE.Vector3(x, y, 0);
  const defs = {
    bottom: [V(-w / 2, -h / 2), V(1, 0), V(0, 1), w, 'left', 'right'],
    right: [V(w / 2, -h / 2), V(0, 1), V(-1, 0), h, 'bottom', 'top'],
    top: [V(w / 2, h / 2), V(-1, 0), V(0, -1), w, 'right', 'left'],
    left: [V(-w / 2, h / 2), V(0, -1), V(1, 0), h, 'top', 'bottom'],
  };
  for (const s of sides) {
    const [O, A, B, L, n0, n1] = defs[s];
    const geo = memberGeometry(profile, L, O, A, B, undefined, !butt[s + ':' + n0], !butt[s + ':' + n1]);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    m.name = s;
    g.add(m);
  }
  return g;
}

/** A straight bar centred on its profile (profile u measured from -half to +half), along X. */
export function bar(profile, L, mat) {
  const geo = memberGeometry(profile, L, new THREE.Vector3(-L / 2, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), undefined, false, false);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---- profiles (metres) ----
// sash stile/rail: 60 mm face, 50 mm deep; ovolo moulding to the room, putty bevel outside
export const SASH_W = 0.06;
export const SASH = [
  [0, -0.025], [0, 0.021], [0.004, 0.025],
  [0.03, 0.025], ...arc(0.03, 0.01, 0.015, Math.PI / 2, 0, 7).slice(1),
  [0.047, 0.008], [0.05, 0.004], [0.05, -0.004], [0.041, -0.018], [0.039, -0.025],
];
// fixed frame around the sashes, with a room-side stop bead that laps the sash edge
export const FRAME_W = 0.05;
export const FRAME = [
  [0, -0.07], [0, 0.05], [0.03, 0.05], ...arc(0.03, 0.04, 0.01, Math.PI / 2, 0, 5).slice(1),
  [0.04, 0.036], [0.06, 0.036], ...arc(0.06, 0.032, 0.004, Math.PI / 2, -Math.PI / 2, 4).slice(1),
  [0.05, 0.028], [0.05, -0.03], [0.045, -0.07],
];
// architrave on the wall: rounded outer edge, a small cove step, a flat face and a bead at the opening
export const CASING_W = 0.095;
export const CASING = [
  [0, 0], [0, 0.007], ...arc(0.005, 0.007, 0.005, Math.PI, Math.PI / 2, 4).slice(1),
  [0.012, 0.012], ...arc(0.012, 0.022, 0.01, -Math.PI / 2, 0, 5).slice(1).map(p => [p[0], p[1] - 0.0, p[2]]),
  [0.024, 0.022], [0.075, 0.023], ...arc(0.083, 0.015, 0.008, Math.PI / 2, -0.1, 6).slice(1),
  [CASING_W, 0.012], [CASING_W, 0],
];
// glazing bar: rounded both faces
export const MUNTIN = [
  [-0.011, -0.006], [-0.005, -0.02], [0.005, -0.02], [0.011, -0.006],
  [0.011, 0.006], ...arc(0, 0.008, 0.011, 0, Math.PI, 8).slice(1, -1).map(p => [p[0], p[1], true]), [-0.011, 0.006],
];
