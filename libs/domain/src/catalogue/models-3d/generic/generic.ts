// The six generic body-shape 3D files: one GLB per body style,
// generated from code alone, so the files are an original work with no
// third-party content. The shapes are the design mock's procedural car
// (docs/reference/design/Main.dc.html) without paint, grille or badge.
// The bytes are the same on every run: a changed byte changes the name, which
// the asset check (scripts/model-3d-check.ts) then refuses against the
// catalogue. The generator strings below are written into every file, so
// they keep naming the script that prints the files.
import { createHash } from 'node:crypto';

import { Document, type Material, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';

type V3 = [number, number, number];

const GENERIC_STYLES = [
  'crossover',
  'estate',
  'fastback',
  'hatchback',
  'saloon',
  'suv',
] as const;
type GenericStyle = (typeof GENERIC_STYLES)[number];

/** The petrol and diesel systems, in the catalogue's order. */
const GENERIC_SYSTEMS = [
  'engine',
  'brakes',
  'suspension',
  'aircon',
  'exhaust',
  'gearbox',
  'electrics',
  'tyres',
  'bodywork',
] as const;
type System = (typeof GENERIC_SYSTEMS)[number];

const GENERATOR = 'motor-fix scripts/models-3d-generic.ts';
const COPYRIGHT =
  'MotorFix original work, generated from code by scripts/models-3d-generic.ts ' +
  'in the motor-fix repository; no third-party content (no outside model, ' +
  'image, logo or text). Licence: owned by MotorFix, usable by MotorFix ' +
  'without restriction.';

/* ---------- body profiles (the mock's six body kinds) ---------- */

interface Profile {
  w: number;
  floor: number;
  top: [number, number][];
  beltR: number;
  beltF: number;
  nose: [number, number, number, number, number];
  tail: [number, number, number, number, number];
  round: number;
}

const PROFILES: Record<GenericStyle, Profile> = {
  crossover: {
    beltF: 1.02,
    beltR: 1.14,
    floor: 0.24,
    nose: [0.5, 3.0, 0.32, 2.6, 0.62],
    round: 14,
    tail: [0.38, 3.4, 0.3, 2.8, 0.7],
    top: [
      [-2.2, 1.04],
      [-2.12, 1.14],
      [-1.52, 1.58],
      [0.18, 1.63],
      [1.04, 1.15],
      [2.02, 0.96],
      [2.22, 0.88],
    ],
    w: 0.92,
  },
  estate: {
    beltF: 0.92,
    beltR: 1.01,
    floor: 0.17,
    nose: [0.52, 2.8, 0.3, 2.4, 0.52],
    round: 14,
    tail: [0.36, 3.6, 0.3, 3.0, 0.62],
    top: [
      [-2.36, 0.98],
      [-2.29, 1.07],
      [-1.96, 1.43],
      [0.2, 1.46],
      [1.02, 1.03],
      [2.03, 0.83],
      [2.3, 0.78],
    ],
    w: 0.905,
  },
  fastback: {
    beltF: 0.88,
    beltR: 0.99,
    floor: 0.16,
    nose: [0.56, 2.9, 0.28, 2.6, 0.5],
    round: 18,
    tail: [0.42, 3.2, 0.26, 2.8, 0.6],
    top: [
      [-2.36, 0.9],
      [-2.16, 0.985],
      [-0.78, 1.33],
      [-0.06, 1.36],
      [0.8, 0.98],
      [2.08, 0.8],
      [2.38, 0.76],
    ],
    w: 0.94,
  },
  hatchback: {
    beltF: 0.93,
    beltR: 1.0,
    floor: 0.17,
    nose: [0.5, 2.9, 0.3, 2.5, 0.52],
    round: 14,
    tail: [0.36, 3.6, 0.3, 3.0, 0.62],
    top: [
      [-2.06, 0.96],
      [-1.99, 1.04],
      [-1.52, 1.44],
      [0.24, 1.47],
      [1.05, 1.05],
      [1.98, 0.85],
      [2.16, 0.8],
    ],
    w: 0.9,
  },
  saloon: {
    beltF: 0.91,
    beltR: 1.0,
    floor: 0.17,
    nose: [0.55, 2.7, 0.3, 2.3, 0.5],
    round: 16,
    tail: [0.42, 3.0, 0.26, 2.4, 0.58],
    top: [
      [-2.33, 0.9],
      [-1.74, 0.985],
      [-0.88, 1.4],
      [0.18, 1.43],
      [1.0, 1.01],
      [2.02, 0.8],
      [2.31, 0.76],
    ],
    w: 0.91,
  },
  suv: {
    beltF: 1.08,
    beltR: 1.17,
    floor: 0.27,
    nose: [0.42, 3.6, 0.3, 3.2, 0.68],
    round: 12,
    tail: [0.34, 4.0, 0.3, 3.4, 0.74],
    top: [
      [-2.12, 1.1],
      [-2.07, 1.2],
      [-1.74, 1.64],
      [0.2, 1.68],
      [0.98, 1.2],
      [1.98, 1.03],
      [2.14, 0.98],
    ],
    w: 0.92,
  },
};

/* ---------- vector helpers (mock coordinates: +x forward, y up) ---------- */

const PI = Math.PI;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const nrm = (a: V3): V3 => scl(a, 1 / (Math.sqrt(dot(a, a)) || 1));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const smin = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
};
const sup = (u: number, n: number) => Math.max(0, 1 - u ** n) ** (1 / n);
function pl(keys: [number, number][], x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const t = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return mix(keys[i - 1][1], keys[i][1], t);
    }
  }
  return keys[keys.length - 1][1];
}
function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/* ---------- a mesh under construction ---------- */

class Shape {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly idx: number[] = [];

  get count() {
    return this.pos.length / 3;
  }

  vert(p: V3, n: V3) {
    this.pos.push(...p);
    this.nor.push(...nrm(n));
    return this.count - 1;
  }

  box(c: V3, s: V3, rz = 0) {
    const cr = Math.cos(rz);
    const sr = Math.sin(rz);
    const ax: V3[] = [
      [cr, sr, 0],
      [-sr, cr, 0],
      [0, 0, 1],
    ];
    const h = [s[0] / 2, s[1] / 2, s[2] / 2];
    for (let a = 0; a < 3; a++) {
      for (const sg of [-1, 1]) {
        const b = (a + 1) % 3;
        const d = (a + 2) % 3;
        const n = scl(ax[a], sg);
        const q = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([u, w]) =>
          this.vert(
            add(
              c,
              add(
                scl(ax[a], sg * h[a]),
                add(scl(ax[b], u * h[b] * sg), scl(ax[d], w * h[d])),
              ),
            ),
            n,
          ),
        );
        this.idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      }
    }
  }

  cyl(a: V3, b: V3, r0: number, r1 = r0, seg = 20) {
    const dir = nrm(sub(b, a));
    const [e1, e2] = frame(dir);
    const base = this.count;
    const sl = (r0 - r1) / Math.sqrt(dot(sub(b, a), sub(b, a)));
    for (let s = 0; s <= seg; s++) {
      const an = (2 * PI * s) / seg;
      const rd = add(scl(e1, Math.cos(an)), scl(e2, Math.sin(an)));
      const n = add(rd, scl(dir, sl));
      this.vert(add(a, scl(rd, r0)), n);
      this.vert(add(b, scl(rd, r1)), n);
    }
    for (let s = 0; s < seg; s++) {
      const o = base + s * 2;
      this.idx.push(o, o + 2, o + 3, o, o + 3, o + 1);
    }
    if (r0 >= 0.012) this.cap(a, scl(dir, -1), r0, seg);
    if (r1 >= 0.012) this.cap(b, dir, r1, seg);
  }

  /** A disc at c facing n (the cap of a cylinder). */
  cap(c: V3, n: V3, r: number, seg: number) {
    const [e1, e2] = frame(n);
    const ci = this.vert(c, n);
    const first = this.count;
    for (let s = 0; s <= seg; s++) {
      const an = (2 * PI * s) / seg;
      this.vert(
        add(c, scl(add(scl(e1, Math.cos(an)), scl(e2, Math.sin(an))), r)),
        n,
      );
    }
    for (let s = 0; s < seg; s++) this.idx.push(ci, first + s, first + s + 1);
  }

  tube(pts: V3[], r: number, smooth = 8, seg = 10) {
    const path = smooth === 0 ? pts : spline(pts, smooth);
    const base = this.count;
    const m = path.length;
    let e1: V3 | undefined;
    for (let k = 0; k < m; k++) {
      const tan = nrm(
        sub(path[Math.min(k + 1, m - 1)], path[Math.max(k - 1, 0)]),
      );
      e1 = e1 ? nrm(sub(e1, scl(tan, dot(e1, tan)))) : frame(tan)[0];
      const e2 = cross(tan, e1);
      for (let s = 0; s <= seg; s++) {
        const an = (2 * PI * s) / seg;
        const rd = add(scl(e1, Math.cos(an)), scl(e2, Math.sin(an)));
        this.vert(add(path[k], scl(rd, r)), rd);
      }
    }
    for (let k = 0; k < m - 1; k++) {
      for (let s = 0; s < seg; s++) {
        const o = base + k * (seg + 1) + s;
        const p = o + seg + 1;
        this.idx.push(o, p + 1, p, o, o + 1, p + 1);
      }
    }
  }

  coil(a: V3, b: V3, R: number, turns: number, r: number) {
    const [e1, e2] = frame(nrm(sub(b, a)));
    const n = Math.round(turns * 14);
    const pts: V3[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const an = 2 * PI * turns * t;
      pts.push(
        add(
          mix3(a, b, t),
          add(scl(e1, Math.cos(an) * R), scl(e2, Math.sin(an) * R)),
        ),
      );
    }
    this.tube(pts, r, 0, 6);
  }

  /** A solid of revolution about the z axis: profile points are [radius, axial]. */
  lathe(c: V3, prof: [number, number][], seg = 48) {
    const base = this.count;
    const m = prof.length;
    for (let s = 0; s <= seg; s++) {
      const an = (2 * PI * s) / seg;
      const ca = Math.cos(an);
      const sa = Math.sin(an);
      for (let q = 0; q < m; q++) {
        const [r, z] = prof[q];
        const [rp, zp] = prof[Math.max(q - 1, 0)];
        const [rn, zn] = prof[Math.min(q + 1, m - 1)];
        const nr = zn - zp;
        const nz = -(rn - rp);
        this.vert(add(c, [r * ca, r * sa, z]), [nr * ca, nr * sa, nz]);
      }
    }
    for (let s = 0; s < seg; s++) {
      for (let q = 0; q < m - 1; q++) {
        const o = base + s * m + q;
        const p = o + m;
        this.idx.push(o, p, p + 1, o, p + 1, o + 1);
      }
    }
  }
}

function frame(dir: V3): [V3, V3] {
  const up: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = nrm(cross(up, dir));
  return [e1, cross(dir, e1)];
}

function spline(pts: V3[], steps: number): V3[] {
  const out: V3[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[Math.max(k - 1, 0)];
    const p1 = pts[k];
    const p2 = pts[k + 1];
    const p3 = pts[Math.min(k + 2, pts.length - 1)];
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      out.push(
        [0, 1, 2].map((d) => catmull(p0[d], p1[d], p2[d], p3[d], t)) as V3,
      );
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ---------- the lofted body ---------- */

const NS = 132;
const NV = 49;

/** The NS section stations along the car and the smoothed roof height at each. */
function stations(S: Profile) {
  const xt = S.top[0][0];
  const xn = S.top[6][0];
  const X: number[] = [];
  let T: number[] = [];
  for (let i = 0; i < NS; i++) {
    const s = i / (NS - 1);
    const ss = s * 0.35 + (0.5 - 0.5 * Math.cos(PI * s)) * 0.65;
    X.push(xt + (xn - xt) * ss);
    T.push(pl(S.top, X[i]));
  }
  for (let k = 0; k < S.round; k++) {
    const prev = T;
    T = prev.map((t, i) =>
      i === 0 || i === NS - 1 ? t : (prev[i - 1] + 2 * t + prev[i + 1]) / 4,
    );
  }
  return { T, X };
}

/** Pull roof, floor and belt towards the nose or tail end height. */
function blendEnd(
  v: number,
  e: Profile['nose'],
  h: { bl: number; fl: number; top: number },
) {
  if (v <= 0) return h;
  const a = sup(v, e[3]);
  return {
    bl: e[4] + (h.bl - e[4]) * a,
    fl: e[4] - (e[4] - h.fl) * a,
    top: e[4] + (h.top - e[4]) * a,
  };
}

/** The nine control points of the half-section at x: [half-width, height]. */
function sectionPoints(
  S: Profile,
  x: number,
  roof: number,
): [number, number][] {
  const xt = S.top[0][0];
  const xn = S.top[6][0];
  const plan =
    sup(clamp((x - (xn - S.nose[0])) / S.nose[0], 0, 1), S.nose[1]) *
    sup(clamp((xt + S.tail[0] - x) / S.tail[0], 0, 1), S.tail[1]);
  let h = {
    bl: mix(S.beltR, S.beltF, (x - xt) / (xn - xt)),
    fl: S.floor + 0.06 * (sstep(1.8, 2.3, x) + sstep(-1.85, -2.3, x)),
    top: roof,
  };
  h = blendEnd(clamp((x - (xn - S.nose[2])) / S.nose[2], 0, 1), S.nose, h);
  h = blendEnd(clamp((xt + S.tail[2] - x) / S.tail[2], 0, 1), S.tail, h);
  const { fl, top } = h;
  const hh = Math.max(top - fl, 0.0001);
  const belt = Math.min(
    Math.max(smin(h.bl, top - 0.055, 0.05), fl + 0.55 * hh),
    top - 0.04 * hh,
  );
  const g = top - belt;
  const wb = S.w * plan * (1 - 0.025 * sstep(0.2, 2.2, Math.abs(x)));
  const wl = wb * 0.965;
  const z6 = wb * mix(0.875, 0.745, sstep(0.06, 0.4, g));
  const hb = belt - fl;
  return [
    [0, fl],
    [wl * 0.74, fl],
    [wl, fl + Math.min(0.08, hb * 0.25)],
    [wb, fl + hb * 0.56],
    [wb * 0.988, belt - Math.min(0.035, hb * 0.1)],
    [wb * 0.935, belt + Math.min(0.012, g * 0.25)],
    [z6, belt + g * 0.84],
    [z6 * 0.83, belt + g * 0.972],
    [0, top],
  ];
}

/** The NV points of the half-section at x, a Catmull-Rom curve through its control points. */
function section(S: Profile, x: number, roof: number): V3[] {
  const pts = sectionPoints(S, x, roof);
  const out: V3[] = [];
  for (let k = 0; k < 8; k++) {
    const p0 = k === 0 ? [-pts[1][0], pts[1][1]] : pts[k - 1];
    const p3 = k === 7 ? [-pts[7][0], pts[7][1]] : pts[k + 2];
    for (let j = 0; j < 6; j++) {
      const t = j / 6;
      const cz = catmull(p0[0], pts[k][0], pts[k + 1][0], p3[0], t);
      const cy = catmull(p0[1], pts[k][1], pts[k + 1][1], p3[1], t);
      out.push([x, cy, Math.max(cz, 0)]);
    }
  }
  out.push([x, pts[8][1], 0]);
  return out;
}

/** Grid point (i, j) of the right half, mirrored past either end of the section. */
function gridPoint(P: V3[], i: number, j: number): V3 {
  const m = j < 0 || j > NV - 1 ? -1 : 1;
  const jj = j < 0 ? -j : j > NV - 1 ? 2 * (NV - 1) - j : j;
  const p = P[i * NV + jj];
  return [p[0], p[1], p[2] * m];
}

function gridNormal(P: V3[], i: number, j: number): V3 {
  if (i === 0) return [-1, 0, 0];
  if (i === NS - 1) return [1, 0, 0];
  const ds = sub(
    gridPoint(P, Math.min(i + 1, NS - 1), j),
    gridPoint(P, i - 1, j),
  );
  const n = nrm(cross(ds, sub(gridPoint(P, i, j + 1), gridPoint(P, i, j - 1))));
  if (i === 1) return nrm(add(n, [-1.2, 0, 0]));
  if (i === NS - 2) return nrm(add(n, [1.2, 0, 0]));
  return n;
}

/** Both halves of the lofted skin. */
function skin(shape: Shape, P: V3[]) {
  for (const side of [1, -1]) {
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NV; j++) {
        const p = P[i * NV + j];
        const n = gridNormal(P, i, j);
        shape.vert([p[0], p[1], p[2] * side], [n[0], n[1], n[2] * side]);
      }
    }
  }
  const half = NS * NV;
  for (let i = 0; i < NS - 1; i++) {
    for (let j = 0; j < NV - 1; j++) {
      const a = i * NV + j;
      const b = a + NV;
      const c = b + 1;
      const d = a + 1;
      shape.idx.push(a, b, c, a, c, d);
      shape.idx.push(
        half + a,
        half + c,
        half + b,
        half + a,
        half + d,
        half + c,
      );
    }
  }
}

/** An ellipsoid door mirror on the side sg (1 right, -1 left). */
function mirror(shape: Shape, c: V3, sg: number) {
  const EL = 7;
  const EO = 12;
  const base = shape.count;
  for (let i = 0; i <= EL; i++) {
    const la = -PI / 2 + (PI * i) / EL;
    for (let j = 0; j <= EO; j++) {
      const lo = (2 * PI * j) / EO;
      const d: V3 = [
        Math.cos(la) * Math.cos(lo),
        Math.sin(la),
        Math.cos(la) * Math.sin(lo),
      ];
      shape.vert(
        [
          c[0] + d[0] * 0.075 - 0.02 * Math.abs(d[2]),
          c[1] + d[1] * 0.058,
          sg * (c[2] + d[2] * 0.105),
        ],
        [d[0] / 0.075, d[1] / 0.058, (sg * d[2]) / 0.105],
      );
    }
  }
  for (let i = 0; i < EL; i++) {
    for (let j = 0; j < EO; j++) {
      const e = base + i * (EO + 1) + j;
      const f = e + EO + 1;
      if (sg > 0) shape.idx.push(e, f, f + 1, e, f + 1, e + 1);
      else shape.idx.push(e, f + 1, f, e, e + 1, f + 1);
    }
  }
}

function body(S: Profile): Shape {
  const { T, X } = stations(S);
  const P = X.flatMap((x, i) => section(S, x, T[i]));
  const shape = new Shape();
  skin(shape, P);
  // The mirrors sit on the belt (the section's waist point), ahead of the A-pillar.
  const mx = S.top[4][0] - 0.2;
  const mi = X.reduce((at, x, i) => (x <= mx ? i : at), 0);
  const c: V3 = [mx, P[mi * NV + 24][1] + 0.085, S.w * 0.9 + 0.085];
  mirror(shape, c, 1);
  mirror(shape, c, -1);
  return shape;
}

/* ---------- the systems (shared by every style, as in the mock) ---------- */

const WX = 1.35;
const WY = 0.34;
const WZ = 0.745;
const SIDES = [-1, 1];

const TYRE: [number, number][] = [
  [0.212, -0.108],
  [0.245, -0.118],
  [0.3, -0.116],
  [0.33, -0.1],
  [0.34, -0.07],
  [0.341, 0],
  [0.34, 0.07],
  [0.33, 0.1],
  [0.3, 0.116],
  [0.245, 0.118],
  [0.212, 0.108],
];

function enginePart(m: Shape) {
  m.box([1.45, 0.5, -0.04], [0.46, 0.3, 0.6]);
  m.box([1.45, 0.335, -0.04], [0.36, 0.07, 0.5]);
  m.box([1.43, 0.7, -0.04], [0.4, 0.1, 0.58]);
  m.box([1.43, 0.772, -0.04], [0.26, 0.045, 0.54]);
  for (const z of [-0.25, -0.11, 0.03, 0.17]) {
    m.cyl([1.43, 0.79, z], [1.43, 0.83, z], 0.026);
    m.tube(
      [
        [1.24, 0.71, z],
        [1.19, 0.75, z],
        [1.165, 0.8, z - 0.01],
      ],
      0.022,
      5,
    );
  }
  m.cyl([1.165, 0.78, -0.31], [1.165, 0.78, 0.23], 0.058);
  m.box([1.05, 0.74, 0.42], [0.22, 0.14, 0.2]);
  m.tube(
    [
      [1.05, 0.76, 0.32],
      [1.1, 0.8, 0.27],
      [1.165, 0.78, 0.23],
    ],
    0.034,
    5,
  );
  m.cyl([1.45, 0.42, 0.262], [1.45, 0.42, 0.3], 0.085);
  m.box([2.025, 0.53, 0], [0.034, 0.4, 1.08]);
}

function gearboxPart(m: Shape) {
  m.cyl([1.45, 0.5, -0.34], [1.45, 0.5, -0.66], 0.19, 0.11);
  for (const sz of SIDES)
    m.cyl([1.44, 0.42, sz * 0.26], [1.35, WY, sz * 0.58], 0.02);
}

function brakesPart(m: Shape) {
  for (const bx of [WX, -WX]) {
    for (const sz of SIDES) {
      m.cyl([bx, WY, sz * 0.692], [bx, WY, sz * 0.722], 0.158, 0.158, 32);
      m.cyl([bx, WY, sz * 0.722], [bx, WY, sz * 0.775], 0.072);
      m.box([bx - 0.1, WY + 0.085, sz * 0.708], [0.085, 0.17, 0.1], -0.55);
      const line: V3[] =
        bx > 0
          ? [
              [bx - 0.11, WY + 0.15, sz * 0.68],
              [bx - 0.2, 0.62, sz * 0.56],
              [1.1, 0.7, sz * 0.46],
              [1.18, 0.79, 0.36],
            ]
          : [
              [bx - 0.11, WY + 0.15, sz * 0.68],
              [bx + 0.22, 0.36, sz * 0.5],
              [-0.8, 0.215, sz * 0.44],
              [0.72, 0.215, sz * 0.44],
              [1.0, 0.46, sz * 0.42],
              [1.18, 0.79, 0.36],
            ];
      m.tube(line, 0.008);
    }
  }
  m.cyl([1.02, 0.8, 0.36], [1.11, 0.8, 0.36], 0.1);
  m.cyl([1.11, 0.8, 0.36], [1.24, 0.8, 0.36], 0.032);
}

function suspensionPart(m: Shape) {
  for (const sz of SIDES) {
    m.cyl([1.35, 0.37, sz * 0.6], [1.315, 0.86, sz * 0.545], 0.026);
    m.coil(
      [1.342, 0.56, sz * 0.585],
      [1.318, 0.83, sz * 0.548],
      0.066,
      5.5,
      0.011,
    );
    m.cyl([1.317, 0.83, sz * 0.547], [1.315, 0.86, sz * 0.545], 0.085);
    m.cyl([1.343, 0.545, sz * 0.586], [1.342, 0.565, sz * 0.585], 0.08);
    m.tube(
      [
        [1.35, 0.25, sz * 0.64],
        [1.2, 0.25, sz * 0.27],
      ],
      0.018,
      0,
    );
    m.tube(
      [
        [1.35, 0.25, sz * 0.64],
        [1.53, 0.25, sz * 0.27],
      ],
      0.018,
      0,
    );
    m.cyl([-1.39, 0.3, sz * 0.6], [-1.47, 0.78, sz * 0.555], 0.025);
    m.coil(
      [-1.29, 0.3, sz * 0.47],
      [-1.29, 0.57, sz * 0.47],
      0.075,
      4.5,
      0.012,
    );
    m.cyl([-1.29, 0.285, sz * 0.47], [-1.29, 0.3, sz * 0.47], 0.09);
    m.cyl([-1.29, 0.57, sz * 0.47], [-1.29, 0.585, sz * 0.47], 0.09);
    m.tube(
      [
        [-1.35, 0.3, sz * 0.62],
        [-0.86, 0.3, sz * 0.56],
      ],
      0.02,
      0,
    );
  }
  m.cyl([1.5, 0.33, -0.43], [1.5, 0.33, 0.43], 0.024);
  m.tube(
    [
      [-1.18, 0.3, -0.6],
      [-1.06, 0.29, -0.48],
      [-1.06, 0.29, 0.48],
      [-1.18, 0.3, 0.6],
    ],
    0.01,
    5,
  );
}

function airconPart(m: Shape) {
  m.cyl([1.63, 0.44, 0.1], [1.63, 0.44, 0.25], 0.062);
  m.box([2.075, 0.52, 0], [0.018, 0.34, 0.98]);
  m.cyl([2.01, 0.36, -0.52], [2.01, 0.64, -0.52], 0.032);
  m.tube(
    [
      [2.01, 0.64, -0.52],
      [1.8, 0.66, -0.6],
      [1.3, 0.66, -0.58],
      [1.08, 0.72, -0.44],
      [0.94, 0.74, -0.22],
    ],
    0.012,
  );
  m.tube(
    [
      [0.94, 0.78, 0.2],
      [1.1, 0.74, 0.5],
      [1.5, 0.56, 0.42],
      [1.63, 0.5, 0.2],
    ],
    0.014,
  );
  m.box([0.87, 0.74, 0], [0.19, 0.24, 0.56]);
  m.cyl([0.87, 0.69, -0.4], [0.87, 0.69, -0.28], 0.1);
}

function exhaustPart(m: Shape) {
  for (const z of [-0.25, -0.11, 0.03, 0.17]) {
    m.tube(
      [
        [1.64, 0.69, z],
        [1.74, 0.63, z * 0.6 - 0.02],
        [1.785, 0.5, -0.04],
      ],
      0.02,
      6,
    );
  }
  m.tube(
    [
      [1.785, 0.5, -0.04],
      [1.75, 0.33, -0.02],
      [1.56, 0.235, 0.1],
      [1.18, 0.22, 0.16],
      [0.6, 0.22, 0.16],
      [-0.6, 0.22, 0.16],
      [-1.02, 0.24, 0.16],
      [-1.32, 0.41, 0.22],
      [-1.58, 0.31, 0.28],
      [-1.74, 0.29, 0.3],
    ],
    0.03,
    10,
  );
  m.cyl([1.08, 0.22, 0.16], [0.8, 0.22, 0.16], 0.075);
  m.cyl([0.02, 0.22, 0.16], [-0.44, 0.22, 0.16], 0.064);
  m.cyl([-1.8, 0.29, -0.4], [-1.8, 0.29, 0.36], 0.1, 0.1, 24);
  m.tube(
    [
      [-1.8, 0.29, -0.34],
      [-1.9, 0.275, -0.42],
      [-1.985, 0.275, -0.42],
    ],
    0.036,
    6,
  );
}

function electricsPart(m: Shape) {
  m.box([1.16, 0.72, -0.47], [0.24, 0.17, 0.17]);
  m.cyl([1.62, 0.62, 0.262], [1.62, 0.62, 0.3], 0.05);
  m.cyl([1.66, 0.62, 0.11], [1.66, 0.62, 0.262], 0.058);
  m.tube(
    [
      [1.16, 0.81, -0.47],
      [1.3, 0.84, -0.3],
      [1.5, 0.8, 0.0],
      [1.62, 0.66, 0.2],
    ],
    0.012,
  );
  m.tube(
    [
      [1.04, 0.74, -0.47],
      [0.9, 0.86, -0.3],
      [0.6, 0.9, 0.0],
      [-1.6, 0.9, 0.0],
    ],
    0.01,
  );
}

function tyresPart(m: Shape) {
  for (const x of [WX, -WX])
    for (const sz of SIDES) m.lathe([x, WY, sz * WZ], TYRE);
}

function bodyworkPart(m: Shape, S: Profile) {
  const xt = S.top[0][0];
  const xn = S.top[6][0];
  const beamY = S.floor + 0.3;
  m.box([xn - 0.16, beamY, 0], [0.07, 0.11, S.w * 1.4]);
  m.box([xt + 0.16, beamY, 0], [0.07, 0.11, S.w * 1.4]);
  for (const sz of SIDES) {
    m.cyl(
      [-0.75, S.floor + 0.33, sz * S.w * 0.9],
      [0.75, S.floor + 0.33, sz * S.w * 0.9],
      0.018,
    );
  }
}

const PARTS: Record<System, (m: Shape, S: Profile) => void> = {
  aircon: airconPart,
  bodywork: bodyworkPart,
  brakes: brakesPart,
  electrics: electricsPart,
  engine: enginePart,
  exhaust: exhaustPart,
  gearbox: gearboxPart,
  suspension: suspensionPart,
  tyres: tyresPart,
};

function system(code: System, S: Profile): Shape {
  const m = new Shape();
  PARTS[code](m, S);
  return m;
}

/** Where each system's pin sits (mock coordinates): on its own part, nearer it than any other. */
const pins = (S: Profile): Record<System, V3> => ({
  aircon: [0.87, 0.87, 0.1],
  bodywork: [0, S.floor + 0.33, S.w * 0.9 + 0.02],
  brakes: [1.35, 0.42, 0.8],
  electrics: [1.16, 0.82, -0.47],
  engine: [1.43, 0.8, 0],
  exhaust: [-1.8, 0.4, 0.1],
  gearbox: [1.45, 0.5, -0.66],
  suspension: [-1.33, 0.66, 0.5],
  tyres: [-1.35, 0.68, 0.8],
});

/* ---------- the GLB ---------- */

// Mock (x forward, y up, z right) to glTF (+Z forward, Y up), a proper
// rotation, rounded so the bytes do not depend on the last bit of Math.
const R = (v: number) => Math.round(v * 1e5) / 1e5 + 0;
const toGltf = (p: V3): V3 => [R(-p[2]), R(p[1]), R(p[0])];

function mesh(doc: Document, name: string, shape: Shape, material: Material) {
  const buffer = doc.getRoot().listBuffers()[0];
  const map = (a: number[]) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3)
      out.set(toGltf([a[i], a[i + 1], a[i + 2]]), i);
    return out;
  };
  const indices =
    shape.count > 65535
      ? new Uint32Array(shape.idx)
      : new Uint16Array(shape.idx);
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(map(shape.pos))
        .setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(map(shape.nor))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(indices)
        .setBuffer(buffer),
    )
    .setMaterial(material);
  return doc.createMesh(name).addPrimitive(prim);
}

function document(style: GenericStyle): Document {
  const S = PROFILES[style];
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  doc.getRoot().getAsset().copyright = COPYRIGHT;
  doc.createBuffer();
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  const shell = doc
    .createMaterial('shell')
    .setBaseColorFactor([0.78, 0.8, 0.84, 0.35])
    .setAlphaMode('BLEND')
    .setDoubleSided(true)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.4);
  const part = doc
    .createMaterial('part')
    .setBaseColorFactor([0.55, 0.57, 0.6, 1])
    .setMetallicFactor(0.6)
    .setRoughnessFactor(0.45);
  const rubber = doc
    .createMaterial('rubber')
    .setBaseColorFactor([0.06, 0.06, 0.07, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.9);
  const scene = doc.createScene(`generic-${style}`);
  doc.getRoot().setDefaultScene(scene);
  scene.addChild(
    doc.createNode('body').setMesh(mesh(doc, 'body', body(S), shell)),
  );
  for (const code of GENERIC_SYSTEMS) {
    const material = code === 'tyres' ? rubber : part;
    const name = `sys_${code}`;
    scene.addChild(
      doc.createNode(name).setMesh(mesh(doc, name, system(code, S), material)),
    );
  }
  for (const code of GENERIC_SYSTEMS) {
    scene.addChild(
      doc.createNode(`pin_${code}`).setTranslation(toGltf(pins(S)[code])),
    );
  }
  return doc;
}

export interface GenericFile {
  style: GenericStyle;
  name: string;
  bytes: Uint8Array;
}

/** The six files, in style order, each named by the first 16 hex of its SHA-256. */
export async function generateGeneric(): Promise<GenericFile[]> {
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const files: GenericFile[] = [];
  for (const style of GENERIC_STYLES) {
    const bytes = await io.writeBinary(document(style));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    files.push({ bytes, name: `generic-${style}.${hash}.glb`, style });
  }
  return files;
}
