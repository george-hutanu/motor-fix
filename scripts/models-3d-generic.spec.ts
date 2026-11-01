import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GENERIC_FILES } from '../libs/domain/src/catalogue/models-3d/models-3d.ts';

// The six generic body-shape files as the generator writes them. The
// generator and three.js are ES modules only, so both run in a child Node
// process, as CI runs the script.
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
const PARTS = [
  'body',
  ...SYSTEMS.map((code) => `sys_${code}`),
  ...SYSTEMS.map((code) => `pin_${code}`),
];

interface Gltf {
  asset: { copyright?: string; generator?: string };
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  images?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
  nodes: { name?: string; mesh?: number; translation?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

const generate = (dir: string) =>
  spawnSync(process.execPath, ['scripts/models-3d-generic.ts', dir], {
    cwd: root,
    encoding: 'utf8',
  });

function json(bytes: Buffer): Gltf {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as Gltf;
}

const read = (dir: string) =>
  new Map(
    readdirSync(dir)
      .sort()
      .map((name) => [name, readFileSync(join(dir, name))]),
  );

let dir: string;
let files: Map<string, Buffer>;
let run: ReturnType<typeof generate>;

const byStyle = (style: string) => {
  const name = [...files.keys()].find((n) => n.startsWith(`generic-${style}.`));
  if (name === undefined) throw new Error(`no file for ${style}`);
  return json(files.get(name) as Buffer);
};

// The body's top (y) and length (z) from its POSITION bounds.
const bodySize = (gltf: Gltf) => {
  const node = gltf.nodes.find((n) => n.name === 'body');
  const accessor =
    gltf.accessors[
      gltf.meshes[node?.mesh ?? -1].primitives[0].attributes.POSITION
    ];
  const [min, max] = [accessor.min ?? [], accessor.max ?? []];
  return { length: max[2] - min[2], top: max[1] };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'models-3d-generic-'));
  run = generate(dir);
  files = read(dir);
}, 60_000);

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('the generic body-shape files', () => {
  // @traces 1242-FR-001
  it('are six, one per style, each named by the first 16 hex of its SHA-256', () => {
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect([...files.keys()].map((n) => n.split('.')[0])).toEqual(
      STYLES.map((s) => `generic-${s}`),
    );
    for (const [name, bytes] of files) {
      const hash = createHash('sha256')
        .update(bytes)
        .digest('hex')
        .slice(0, 16);
      expect(name).toBe(`${name.split('.')[0]}.${hash}.glb`);
    }
    expect(run.stdout.trim().split('\n')).toEqual([...files.keys()]);
  });

  // @traces 1242-FR-001
  it('are the same bytes on every run', () => {
    const again = mkdtempSync(join(tmpdir(), 'models-3d-generic-'));
    try {
      expect(generate(again).status).toBe(0);
      expect(read(again)).toEqual(files);
    } finally {
      rmSync(again, { force: true, recursive: true });
    }
  }, 60_000);

  // @traces 1242-FR-002
  it('hold the body, the nine petrol and diesel systems and a pin each, and nothing of another fuel', () => {
    for (const style of STYLES) {
      const gltf = byStyle(style);
      const names = gltf.nodes.map((n) => n.name);
      expect([...names].sort()).toEqual([...PARTS].sort());
      for (const node of gltf.nodes) {
        if (node.name?.startsWith('pin_')) {
          expect(node.mesh).toBeUndefined();
          expect(node.translation).toHaveLength(3);
        } else {
          expect(node.mesh).toEqual(expect.any(Number));
        }
      }
    }
  });

  // @traces 1242-FR-003
  it('are at most 2 MiB, meshopt-compressed and hold no image or texture', () => {
    for (const [name, bytes] of files) {
      expect({ name, size: bytes.length <= 2_097_152 }).toEqual({
        name,
        size: true,
      });
      const gltf = json(bytes);
      expect(gltf.extensionsRequired).toContain('EXT_meshopt_compression');
      expect(gltf.images ?? []).toEqual([]);
      expect(gltf.textures ?? []).toEqual([]);
      expect(gltf.samplers ?? []).toEqual([]);
    }
  });

  // @traces 1242-FR-005
  it('differ by style: the suv tallest, the hatchback shortest, no two alike', () => {
    const sizes = Object.fromEntries(
      STYLES.map((s) => [s, bodySize(byStyle(s))]),
    );
    for (const style of STYLES.filter((s) => s !== 'suv')) {
      expect(sizes.suv.top).toBeGreaterThan(sizes[style].top);
    }
    for (const style of STYLES.filter((s) => s !== 'hatchback')) {
      expect(sizes.hatchback.length).toBeLessThan(sizes[style].length);
    }
    const hashes = new Set([...files.keys()].map((n) => n.split('.')[1]));
    expect(hashes.size).toBe(6);
  });

  // @traces 1242-FR-006
  it('record their source and licence', () => {
    for (const style of STYLES) {
      const { asset } = byStyle(style);
      expect(asset.copyright).toMatch(/MotorFix/);
      expect(asset.copyright).toMatch(/scripts\/models-3d-generic\.ts/);
      expect(asset.copyright).toMatch(/no third-party content/);
      expect(asset.generator).toBe('motor-fix scripts/models-3d-generic.ts');
    }
  });

  // @traces 1242-FR-004
  it('load in three.js with no warning or error, every part found by name and facing out', () => {
    const loader = `
      import { readFileSync } from 'node:fs';
      import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
      import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
      const said = [];
      console.warn = (...a) => said.push('warn ' + a.join(' '));
      console.error = (...a) => said.push('error ' + a.join(' '));
      const parts = ${JSON.stringify(PARTS)};
      const out = {};
      const inverted = [];
      for (const file of process.argv.slice(1)) {
        const bytes = readFileSync(file);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
        out[file] = parts.filter((p) => !gltf.scene.getObjectByName(p));
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const P = o.geometry.attributes.position.array;
          const N = o.geometry.attributes.normal.array;
          const I = o.geometry.index.array;
          let agree = 0;
          let total = 0;
          for (let t = 0; t < I.length; t += 3) {
            const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
            const u = [0, 1, 2].map((d) => P[b + d] - P[a + d]);
            const w = [0, 1, 2].map((d) => P[c + d] - P[a + d]);
            const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            if (Math.hypot(...n) < 1e-12) continue;
            const v = [0, 1, 2].map((d) => N[a + d] + N[b + d] + N[c + d]);
            total++;
            if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0) agree++;
          }
          if (agree < total * 0.99) inverted.push(file + ' ' + o.name);
        });
      }
      process.stdout.write(JSON.stringify({ inverted, missing: out, said }));
    `;
    const paths = [...files.keys()].map((n) => join(dir, n));
    expect(paths).toHaveLength(6);
    const load = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', loader, ...paths],
      { cwd: root, encoding: 'utf8' },
    );
    expect(load.stderr).toBe('');
    const result = JSON.parse(load.stdout) as {
      inverted: string[];
      missing: Record<string, string[]>;
      said: string[];
    };
    expect(result.said).toEqual([]);
    // Single-sided parts face out: every triangle winds the way its normals point.
    expect(result.inverted).toEqual([]);
    expect(Object.values(result.missing)).toEqual(paths.map(() => []));
  }, 60_000);

  // @traces 1242-FR-008
  it('keep their encoder pinned: Dependabot never bumps it', () => {
    const config = readFileSync(join(root, '.github/dependabot.yml'), 'utf8');
    const ignored = [
      ...config.matchAll(
        /- dependency-name: "?([^"\n]+)"?\n(?!\s+update-types)/g,
      ),
    ].map((m) => m[1]);
    expect(ignored).toEqual(
      expect.arrayContaining(['@gltf-transform/*', 'meshoptimizer']),
    );
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const name of [
      '@gltf-transform/core',
      '@gltf-transform/extensions',
      'meshoptimizer',
    ]) {
      expect(pkg.dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  // @traces 1242-FR-007
  it('are the files the catalogue names for the six body styles', () => {
    expect([...files.keys()]).toEqual(Object.values(GENERIC_FILES).sort());
  });

  // @traces 1242-FR-007
  // @traces 1242-FR-008
  it('pass the 3D asset check as CI runs it, and fail it on one changed byte', () => {
    const asCi = spawnSync(process.execPath, ['scripts/model-3d-check.ts'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(asCi.stdout).toBe('');
    expect(asCi.status).toBe(0);

    const name = GENERIC_FILES.saloon;
    const bytes = Buffer.from(files.get(name) as Buffer);
    bytes[bytes.length - 1] ^= 0xff;
    const only = mkdtempSync(join(tmpdir(), 'models-3d-generic-check-'));
    try {
      for (const [file, content] of files) {
        writeFileSync(join(only, file), file === name ? bytes : content);
      }
      const run = spawnSync(
        process.execPath,
        ['scripts/model-3d-check.ts', only],
        { cwd: root, encoding: 'utf8' },
      );
      expect(run.status).toBe(1);
      expect(run.stdout).toContain(`${name}: hash mismatch`);
    } finally {
      rmSync(only, { force: true, recursive: true });
    }
  }, 60_000);

  it('refuses to run without an output directory', () => {
    const bare = spawnSync(process.execPath, ['scripts/models-3d-generic.ts'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(bare.status).toBe(2);
    expect(bare.stderr).toMatch(/usage/i);
  });
});
