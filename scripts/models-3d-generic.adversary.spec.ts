import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..');
const STYLES = [
  'crossover',
  'estate',
  'fastback',
  'hatchback',
  'saloon',
  'suv',
];
const SYSTEMS = [
  'engine',
  'brakes',
  'suspension',
  'aircon',
  'exhaust',
  'gearbox',
  'electrics',
  'tyres',
  'bodywork',
];

interface Node {
  name?: string;
  mesh?: number;
  translation?: number[];
  children?: number[];
  scale?: number[];
  rotation?: number[];
  matrix?: number[];
}
interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes: Node[];
  meshes: {
    primitives: {
      attributes: { POSITION: number };
      material?: number;
    }[];
  }[];
  accessors: { min?: number[]; max?: number[]; count: number }[];
  materials?: Record<string, unknown>[];
  buffers: { byteLength: number; uri?: string }[];
  images?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
}

const generate = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/models-3d-generic.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
  });

const chunks = (bytes: Buffer) => {
  const out: { type: number; length: number; start: number }[] = [];
  let at = 12;
  while (at < bytes.length) {
    const length = bytes.readUInt32LE(at);
    out.push({ length, start: at + 8, type: bytes.readUInt32LE(at + 4) });
    at += 8 + length;
  }
  return { end: at, out };
};

const json = (bytes: Buffer): Gltf => {
  const [first] = chunks(bytes).out;
  return JSON.parse(
    bytes.subarray(first.start, first.start + first.length).toString('utf8'),
  ) as Gltf;
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'models-3d-adversary-'));
});
afterEach(() => {
  rmSync(tmp, { force: true, recursive: true });
});

const generated = (() => {
  let cache: Map<string, Buffer> | undefined;
  return () => {
    if (cache) return cache;
    const dir = mkdtempSync(join(tmpdir(), 'models-3d-adversary-shared-'));
    try {
      const run = generate(dir);
      if (run.status !== 0) throw new Error(run.stderr);
      cache = new Map(
        readdirSync(dir).map((n) => [n, readFileSync(join(dir, n))]),
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
    return cache;
  };
})();

const world = (gltf: Gltf, index: number): number[] => {
  const parent = gltf.nodes.findIndex((n) => n.children?.includes(index));
  const t = gltf.nodes[index].translation ?? [0, 0, 0];
  if (parent < 0) return t;
  const p = world(gltf, parent);
  return [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
};

const bounds = (gltf: Gltf, index: number) => {
  const node = gltf.nodes[index];
  const acc =
    gltf.accessors[
      gltf.meshes[node.mesh as number].primitives[0].attributes.POSITION
    ];
  const w = world(gltf, index);
  return {
    max: (acc.max as number[]).map((v, i) => v + w[i]),
    min: (acc.min as number[]).map((v, i) => v + w[i]),
  };
};

const index = (gltf: Gltf, name: string) =>
  gltf.nodes.findIndex((n) => n.name === name);

describe('the generator CLI under odd directories', () => {
  // @traces 1242-FR-001
  it('creates a nested directory that does not exist', () => {
    const target = join(tmp, 'a', 'b', 'c');
    const run = generate(target);
    expect(run.status).toBe(0);
    expect(readdirSync(target)).toHaveLength(6);
  }, 60_000);

  // @traces 1242-FR-001
  it('leaves other files in an existing directory alone', () => {
    writeFileSync(join(tmp, 'keep.txt'), 'mine');
    writeFileSync(join(tmp, 'generic-saloon.old.glb'), 'stale');
    const run = generate(tmp);
    expect(run.status).toBe(0);
    expect(readFileSync(join(tmp, 'keep.txt'), 'utf8')).toBe('mine');
    expect(readFileSync(join(tmp, 'generic-saloon.old.glb'), 'utf8')).toBe(
      'stale',
    );
    expect(readdirSync(tmp)).toHaveLength(8);
  }, 60_000);

  // @traces 1242-FR-001
  it('run twice into the same directory leaves exactly six files', () => {
    expect(generate(tmp).status).toBe(0);
    expect(generate(tmp).status).toBe(0);
    expect(readdirSync(tmp)).toHaveLength(6);
  }, 60_000);

  // @traces 1242-FR-001
  it('works in a directory name with spaces and non-ASCII letters', () => {
    const target = join(tmp, 'mașină 3d fișiere');
    const run = generate(target);
    expect(run.status).toBe(0);
    expect(readdirSync(target)).toHaveLength(6);
  }, 60_000);

  // @traces 1242-FR-001
  it('prints one file name per line and nothing else on stdout', () => {
    const run = generate(tmp);
    expect(run.stdout.trim().split('\n')).toEqual(readdirSync(tmp).sort());
    expect(run.stdout.endsWith('\n')).toBe(true);
  }, 60_000);

  // @traces 1242-FR-001
  it('fails and writes nothing when the output path is an existing file', () => {
    const file = join(tmp, 'plain');
    writeFileSync(file, 'x');
    const run = generate(file);
    expect(run.status).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('x');
    expect(readdirSync(tmp)).toEqual(['plain']);
  }, 60_000);

  // @traces 1242-FR-001
  it('exits 2 with a usage line for an empty directory argument and writes nothing', () => {
    const before = readdirSync(root).sort();
    const run = generate('');
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/usage/i);
    expect(run.stdout).toBe('');
    expect(readdirSync(root).sort()).toEqual(before);
  }, 60_000);

  // @traces 1242-FR-001
  it('prints the usage line to stderr and nothing to stdout without a directory', () => {
    const run = generate();
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim().split('\n').length).toBeGreaterThan(0);
    expect(run.stderr).toMatch(/models-3d-generic/);
  }, 60_000);
});

describe('the GLB container', () => {
  // @traces 1242-FR-003
  it('has a valid header whose lengths agree with the file and its chunks', () => {
    for (const [name, bytes] of generated()) {
      expect({ magic: bytes.readUInt32LE(0), name }).toEqual({
        magic: 0x46546c67,
        name,
      });
      expect(bytes.readUInt32LE(4)).toBe(2);
      expect(bytes.readUInt32LE(8)).toBe(bytes.length);
      const { out, end } = chunks(bytes);
      expect(end).toBe(bytes.length);
      expect(out[0].type).toBe(0x4e4f534a);
      expect(out[1]?.type).toBe(0x004e4942);
      expect(out).toHaveLength(2);
      for (const c of out) expect(c.length % 4).toBe(0);
    }
  });

  // @traces 1242-FR-003
  it('declares a first buffer no longer than its binary chunk and no external uri', () => {
    for (const [, bytes] of generated()) {
      const gltf = json(bytes);
      const bin = chunks(bytes).out[1];
      expect(gltf.buffers.length).toBeGreaterThan(0);
      for (const b of gltf.buffers) expect(b.uri).toBeUndefined();
      expect(gltf.buffers[0].byteLength).toBeLessThanOrEqual(bin.length);
    }
  });

  // @traces 1242-FR-003
  it('is far below the 2 MiB cap and has no trailing bytes after the last chunk', () => {
    for (const [name, bytes] of generated()) {
      expect({ name, ok: bytes.length < 2_097_152 }).toEqual({
        name,
        ok: true,
      });
      expect(chunks(bytes).end).toBe(bytes.length);
    }
  });

  // @traces 1242-FR-003
  it('lists EXT_meshopt_compression as used and required in every file', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes) as Gltf & {
        extensionsUsed?: string[];
        extensionsRequired?: string[];
      };
      expect(g.extensionsUsed).toContain('EXT_meshopt_compression');
      expect(g.extensionsRequired).toContain('EXT_meshopt_compression');
      expect(g.extensionsRequired?.sort()).toEqual(
        [...(g.extensionsRequired ?? [])].sort(),
      );
      for (const ext of g.extensionsRequired ?? [])
        expect(g.extensionsUsed).toContain(ext);
    }
  });
});

describe('the scene graph', () => {
  // @traces 1242-FR-002
  it('has exactly one scene, listing nodes that exist, with unique names', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes);
      expect(g.scenes).toHaveLength(1);
      expect(g.nodes).toHaveLength(19);
      const names = g.nodes.map((n) => n.name);
      expect(new Set(names).size).toBe(19);
      for (const i of g.scenes?.[0].nodes ?? [])
        expect(g.nodes[i]).toBeDefined();
    }
  });

  // @traces 1242-FR-002
  it('has no node of another fuel or any unprefixed extra node', () => {
    for (const [, bytes] of generated()) {
      const names = json(bytes).nodes.map((n) => n.name ?? '');
      expect(
        names.filter((n) => /battery|electric_motor|motor/.test(n)),
      ).toEqual([]);
      expect(
        names.filter((n) => n !== 'body' && !/^(sys|pin)_/.test(n)),
      ).toEqual([]);
      expect(
        names
          .filter((n) => /^(sys|pin)_/.test(n))
          .map((n) => n.replace(/^(sys|pin)_/, ''))
          .filter((c) => !SYSTEMS.includes(c)),
      ).toEqual([]);
    }
  });

  // @traces 1242-FR-002
  it('gives every pin no mesh, children or camera and every system a mesh with positions', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes);
      for (const code of SYSTEMS) {
        const pin = g.nodes[index(g, `pin_${code}`)] as Node & {
          camera?: number;
          skin?: number;
        };
        expect(pin.mesh).toBeUndefined();
        expect(pin.children ?? []).toEqual([]);
        expect(pin.camera).toBeUndefined();
        const sys = g.nodes[index(g, `sys_${code}`)];
        const prim = g.meshes[sys.mesh as number].primitives;
        expect(prim.length).toBeGreaterThan(0);
        expect(g.accessors[prim[0].attributes.POSITION].count).toBeGreaterThan(
          0,
        );
      }
    }
  });

  // @traces 1242-FR-002
  it('has no mesh shared by two nodes, so lighting one system cannot light another', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes);
      const used = g.nodes
        .map((n) => n.mesh)
        .filter((m): m is number => m !== undefined);
      expect(new Set(used).size).toBe(used.length);
      expect(used).toHaveLength(10);
      expect(g.meshes).toHaveLength(10);
    }
  });

  // @traces 1242-FR-002
  it('places every pin inside the car bounding box and near its own system', () => {
    for (const [name, bytes] of generated()) {
      const g = json(bytes);
      const body = bounds(g, index(g, 'body'));
      const size = body.max.map((v, i) => v - body.min[i]);
      for (const code of SYSTEMS) {
        const p = world(g, index(g, `pin_${code}`));
        const sys = bounds(g, index(g, `sys_${code}`));
        const mine = [0, 1, 2].map((i) => {
          const d = Math.max(sys.min[i] - p[i], 0, p[i] - sys.max[i]);
          return d * d;
        });
        const toOwn = Math.sqrt(mine[0] + mine[1] + mine[2]);
        const inside = p.every(
          (v, i) => v >= body.min[i] - 1e-6 && v <= body.max[i] + 1e-6,
        );
        expect({ code, inside, name }).toEqual({ code, inside: true, name });
        expect(toOwn).toBeLessThanOrEqual(size[2] * 0.15);
      }
    }
  });

  // @traces 1242-FR-002
  it('puts a pin nearer its own system than to any other system', () => {
    // Distance from a pin to a part is to its nearest triangle, measured on
    // the decoded geometry, so the meshopt data runs through three.js.
    const finder = `
      import { readFileSync } from 'node:fs';
      import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
      import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const at = (a, d, t) => [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
      // Ericson, Real-Time Collision Detection 5.1.5: the closest point of a triangle.
      function closest(p, a, b, c) {
        const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
        const d1 = dot(ab, ap), d2 = dot(ac, ap);
        if (d1 <= 0 && d2 <= 0) return a;
        const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
        if (d3 >= 0 && d4 <= d3) return b;
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(a, ab, d1 / (d1 - d3));
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) return c;
        const vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(a, ac, d2 / (d2 - d6));
        const va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
          return at(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
        const den = 1 / (va + vb + vc);
        return at(at(a, ab, vb * den), ac, vc * den);
      }
      function distance(mesh, p) {
        const a = mesh.geometry.attributes.position.array;
        const ix = mesh.geometry.index.array;
        const v = (i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
        let best = Infinity;
        for (let t = 0; t < ix.length; t += 3) {
          const q = closest(p, v(ix[t]), v(ix[t + 1]), v(ix[t + 2]));
          best = Math.min(best, Math.hypot(...sub(q, p)));
        }
        return best;
      }
      const wrong = [];
      for (const file of process.argv.slice(1)) {
        const bytes = readFileSync(file);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
        const parts = [];
        gltf.scene.traverse((o) => { if (o.isMesh && o.name.startsWith('sys_')) parts.push(o); });
        gltf.scene.traverse((o) => {
          if (!o.name.startsWith('pin_')) return;
          const p = [o.position.x, o.position.y, o.position.z];
          const ranked = parts
            .map((m) => [m.name.slice(4), distance(m, p)])
            .sort((x, y) => x[1] - y[1]);
          if (ranked[0][0] !== o.name.slice(4)) wrong.push(file + ' ' + o.name + ' nearest ' + ranked[0][0]);
        });
      }
      process.stdout.write(JSON.stringify(wrong));
    `;
    const dir = mkdtempSync(join(tmpdir(), 'models-3d-adversary-pins-'));
    try {
      expect(generate(dir).status).toBe(0);
      const paths = readdirSync(dir).map((n) => join(dir, n));
      expect(paths).toHaveLength(6);
      const run = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', finder, ...paths],
        { cwd: root, encoding: 'utf8' },
      );
      expect(run.stderr).toBe('');
      expect(JSON.parse(run.stdout)).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }, 60_000);

  // @traces 1242-FR-002
  it('keeps every pin finite and every pin of a file at a distinct place', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes);
      const spots = SYSTEMS.map((c) =>
        world(g, index(g, `pin_${c}`)).join(','),
      );
      for (const s of spots)
        for (const v of s.split(','))
          expect(Number.isFinite(Number(v))).toBe(true);
      expect(new Set(spots).size).toBe(9);
    }
  });
});

describe('the geometry data', () => {
  // @traces 1242-FR-004
  it('has finite, ordered min and max on every accessor and no NaN anywhere in the JSON', () => {
    for (const [name, bytes] of generated()) {
      const g = json(bytes);
      for (const a of g.accessors) {
        const all = [...(a.min ?? []), ...(a.max ?? [])];
        expect({ finite: all.every(Number.isFinite), name }).toEqual({
          finite: true,
          name,
        });
        const max = a.max ?? [];
        expect((a.min ?? []).filter((v, i) => v > max[i])).toEqual([]);
        expect(a.count).toBeGreaterThan(0);
      }
      const text = bytes
        .subarray(20, 20 + chunks(bytes).out[0].length)
        .toString('utf8');
      expect(text).not.toMatch(/NaN|Infinity|null/);
    }
  });

  // @traces 1242-FR-004
  it('gives the body a non-degenerate box in all three axes', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes);
      const b = bounds(g, index(g, 'body'));
      for (let i = 0; i < 3; i++)
        expect(b.max[i] - b.min[i]).toBeGreaterThan(0.1);
    }
  });

  // @traces 1242-FR-004
  it('loads each file in three.js with the meshopt decoder: finite positions, no warning, one scene', () => {
    const script = `
      import { readFileSync } from 'node:fs';
      import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
      import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
      const said = [];
      console.warn = (...a) => said.push('warn ' + a.join(' '));
      console.error = (...a) => said.push('error ' + a.join(' '));
      const res = [];
      for (const f of process.argv.slice(1)) {
        const b = readFileSync(f);
        const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
        const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
        let bad = 0, meshes = 0, textured = 0;
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          if (o.material.map) textured++;
          for (const v of o.geometry.attributes.position.array) if (!Number.isFinite(v)) bad++;
          for (const v of o.geometry.attributes.normal.array) if (!Number.isFinite(v)) bad++;
        });
        res.push({ scenes: g.scenes.length, bad, meshes, textured, cams: g.cameras.length, anims: g.animations.length });
      }
      process.stdout.write(JSON.stringify({ said, res }));
    `;
    const dir = mkdtempSync(join(tmpdir(), 'models-3d-adversary-load-'));
    try {
      for (const [n, b] of generated()) writeFileSync(join(dir, n), b);
      const paths = readdirSync(dir).map((n) => join(dir, n));
      const load = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', script, ...paths],
        { cwd: root, encoding: 'utf8' },
      );
      expect(load.stderr).toBe('');
      const out = JSON.parse(load.stdout) as {
        said: string[];
        res: Record<string, number>[];
      };
      expect(out.said).toEqual([]);
      expect(out.res).toEqual(
        paths.map(() => ({
          anims: 0,
          bad: 0,
          cams: 0,
          meshes: 10,
          scenes: 1,
          textured: 0,
        })),
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }, 60_000);
});

describe('licence cleanliness', () => {
  // @traces 1242-FR-003
  it('has materials with no texture reference of any kind', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes);
      expect(g.images).toBeUndefined();
      expect(g.textures).toBeUndefined();
      expect(g.samplers).toBeUndefined();
      const text = JSON.stringify(g.materials ?? []);
      expect(text).not.toMatch(/Texture|"index"|emissiveTexture/);
      expect(Object.keys(g.materials ?? [{}]).length).toBeLessThan(20);
    }
  });

  // @traces 1242-FR-006
  it('records MotorFix as owner, the generator path and the licence in every file, identically', () => {
    const texts = new Set<string>();
    for (const [, bytes] of generated()) {
      const g = json(bytes) as Gltf & { asset: { copyright?: string } };
      const c = g.asset.copyright ?? '';
      texts.add(c);
      expect(c).toMatch(/MotorFix/);
      expect(c).toMatch(/scripts\/models-3d-generic\.ts/);
      expect(c).toMatch(/no third-party content/);
      expect(c).toMatch(/[Ll]icence/);
      expect(c).not.toMatch(/https?:\/\//);
    }
    expect(texts.size).toBe(1);
  });

  // @traces 1242-FR-006
  it('carries no extras, names or strings beyond the part names that could hold a logo or text', () => {
    for (const [, bytes] of generated()) {
      const g = json(bytes) as Gltf & { extras?: unknown };
      expect(g.extras).toBeUndefined();
      for (const n of g.nodes)
        expect(n.name).toMatch(/^(body|sys_[a-z]+|pin_[a-z]+)$/);
    }
  });

  // @traces 1242-FR-005
  it('differs between every pair of styles in body bounds, not only in hash', () => {
    const sizes = [...generated()].map(([, bytes]) => {
      const g = json(bytes);
      const b = bounds(g, index(g, 'body'));
      return b.max.map((v, i) => (v - b.min[i]).toFixed(4)).join('x');
    });
    expect(new Set(sizes).size).toBe(6);
  });

  // @traces 1242-FR-005
  it('names the six files in the catalogue order with one hash each and the .glb extension only', () => {
    const names = [...generated().keys()].sort();
    expect(names).toHaveLength(6);
    expect(names.map((n) => n.replace(/\.[0-9a-f]{16}\.glb$/, ''))).toEqual(
      STYLES.map((x) => `generic-${x}`),
    );
    for (const n of names) expect(n).toMatch(/\.[0-9a-f]{16}\.glb$/);
    expect(existsSync(join(root, 'generic-saloon.glb'))).toBe(false);
    mkdirSync(tmp, { recursive: true });
  });
});
