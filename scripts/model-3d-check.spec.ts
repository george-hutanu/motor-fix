import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CAR_MODELS,
  glb,
  partsFor,
  placeholders,
} from '../libs/domain/src/catalogue/models-3d/models-3d.ts';

// The 3D asset check as CI runs it: over the placeholder set when given no
// directory, over a directory of .glb files when given one.
const root = join(__dirname, '..');

const check = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/model-3d-check.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
  });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-3d-check-'));
  for (const [file, bytes] of placeholders()) {
    writeFileSync(join(dir, file), bytes);
  }
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('the 3D asset check', () => {
  // @traces 1241-FR-006
  // @traces 1241-FR-007
  it('passes the placeholder set when it is given no directory', () => {
    const run = check();

    expect(run.stdout).toBe('');
    expect(run.status).toBe(0);
  });

  // @traces 1241-FR-007
  it('passes a directory holding a good file for every catalogue row', () => {
    const run = check(dir);

    expect(run.stdout).toBe('');
    expect(run.status).toBe(0);
  });

  // @traces 1241-FR-007
  // @traces 1241-FR-009
  it('fails naming the file and its fault, and the row left without a file', () => {
    const [logan, golf] = CAR_MODELS;
    writeFileSync(
      join(dir, logan.file),
      glb(partsFor('petrol').filter((n) => n !== 'sys_brakes')),
    );
    rmSync(join(dir, golf.file));
    writeFileSync(join(dir, 'notes.txt'), 'not a model');

    const run = check(dir);

    expect(run.status).toBe(1);
    expect(run.stdout.trim().split('\n')).toEqual(
      expect.arrayContaining([
        `${logan.file}: hash mismatch`,
        `${logan.file}: missing sys_brakes`,
        'notes.txt: unknown file',
        `volkswagen-golf: missing file ${golf.file}`,
      ]),
    );
  });
});
