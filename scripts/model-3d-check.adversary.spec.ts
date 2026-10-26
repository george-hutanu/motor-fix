import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CAR_MODELS,
  MODEL_3D_FILES,
  placeholders,
} from '../libs/domain/src/catalogue/models-3d/models-3d.ts';

const root = join(__dirname, '..');

const check = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/model-3d-check.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

let generic: string;
let dir: string;
let outside: string;

beforeAll(() => {
  generic = mkdtempSync(join(tmpdir(), 'model-3d-adv-generic-'));
  execFileSync(process.execPath, ['scripts/models-3d-generic.ts', generic], {
    cwd: root,
  });
}, 60_000);

afterAll(() => {
  rmSync(generic, { force: true, recursive: true });
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-3d-adv-'));
  outside = mkdtempSync(join(tmpdir(), 'model-3d-out-'));
  cpSync(generic, dir, { recursive: true });
  for (const [file, bytes] of placeholders()) {
    writeFileSync(join(dir, file), bytes);
  }
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
  rmSync(outside, { force: true, recursive: true });
});

describe('the 3D asset check command, attacked', () => {
  // @traces 1241-FR-007
  it('names every catalogue row and exits 1 for an empty directory', () => {
    const empty = mkdtempSync(join(tmpdir(), 'model-3d-empty-'));
    try {
      const run = check(empty);

      expect(run.status).toBe(1);
      expect(run.stdout.trim().split('\n')).toEqual(
        MODEL_3D_FILES.map((r) => `${r.key}: missing file ${r.file}`),
      );
    } finally {
      rmSync(empty, { force: true, recursive: true });
    }
  });

  // @traces 1241-FR-007
  it('exits 1 with a message rather than passing when the directory does not exist', () => {
    const run = check(join(dir, 'nowhere'));

    expect(run.status).toBe(1);
    expect(run.stderr + run.stdout).not.toMatch(/\n\s+at /);
  });

  // @traces 1241-FR-007
  it('fails a file that is not a GLB and names it, for text in Latin-1 and UTF-16', () => {
    const [a, b] = CAR_MODELS;
    writeFileSync(join(dir, a.file), Buffer.from('caf\xe9 \xff', 'latin1'));
    writeFileSync(join(dir, b.file), Buffer.from('﻿body', 'utf16le'));

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout.trim().split('\n')).toEqual(
      expect.arrayContaining([
        `${a.file}: not a GLB`,
        `${b.file}: hash mismatch`,
      ]),
    );
    expect(run.stdout).toContain(`${b.file}: not a GLB`);
  });

  // @traces 1241-FR-007
  it('fails a 30 MiB file naming it as larger than 2 MiB without crashing', () => {
    const [a] = CAR_MODELS;
    writeFileSync(join(dir, a.file), Buffer.alloc(30 * 1024 * 1024, 0x41));

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`${a.file}: larger than 2 MiB`);
  });

  // @traces 1241-FR-007
  it('fails a dangling symlink standing in for a catalogue file, naming it', () => {
    const [a] = CAR_MODELS;
    rmSync(join(dir, a.file));
    symlinkSync(join(outside, 'gone.glb'), join(dir, a.file));

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(a.file);
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });

  // @traces 1241-FR-007
  it('refuses a symlink that points outside the directory even when the target is a good file', () => {
    const [a] = CAR_MODELS;
    writeFileSync(
      join(outside, a.file),
      placeholders().get(a.file) as Uint8Array,
    );
    rmSync(join(dir, a.file));
    symlinkSync(join(outside, a.file), join(dir, a.file));

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(a.file);
  });

  // @traces 1241-FR-007
  it('names a directory called like a catalogue file instead of crashing', () => {
    const [a] = CAR_MODELS;
    rmSync(join(dir, a.file));
    mkdirSync(join(dir, a.file));

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(a.file);
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });

  // @traces 1241-FR-007
  it('names an upper-case .GLB beside the good set as an unknown file', () => {
    const [a] = CAR_MODELS;
    writeFileSync(
      join(dir, 'STRAY.GLB'),
      placeholders().get(a.file) as Uint8Array,
    );

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe('STRAY.GLB: unknown file');
  });

  // @traces 1241-FR-007
  it('prints the same lines on a second run over the same directory', () => {
    const [a] = CAR_MODELS;
    rmSync(join(dir, a.file));

    const first = check(dir);
    const second = check(dir);

    expect(second.stdout).toBe(first.stdout);
    expect(first.stdout.trim()).toBe(`${a.key}: missing file ${a.file}`);
  });

  // @traces 1241-FR-007
  it('leaves the directory it checked untouched', () => {
    const before = readdirSync(dir).sort();
    check(dir);
    const again = check(dir);

    expect(again.status).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(before).toHaveLength(MODEL_3D_FILES.length);
  });
});
