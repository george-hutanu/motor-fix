import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./diff-audit.mjs', import.meta.url));

let repo;
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};
const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
const untested = () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--no-jev'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter((l) => l.includes('[untested-new-file]'));
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'diff-audit-adv-'));
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  write('tsconfig.base.json', { compilerOptions: { module: 'esnext', moduleResolution: 'bundler' } });
  write('libs/domain/tsconfig.json', { extends: '../../tsconfig.base.json' });
  write('apps/web-e2e/tsconfig.json', { extends: '../../tsconfig.base.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

// @traces 1359-FR-005
describe('untested-new-file under bundler resolution', () => {
  it('counts a double-quoted and a backtick import', () => {
    write('libs/domain/src/one.ts', 'export const one = 1;\n');
    write('libs/domain/src/two.ts', 'export const two = 1;\n');
    write('libs/domain/src/uses.spec.ts', 'import { one } from "./one";\nconst two = await import(`./two`);\n');
    assert.deepEqual(untested(), []);
  });


  it('does not take a file with a dot in its stem for a lookalike name', () => {
    write('libs/domain/src/a.b.ts', 'export const ab = 1;\n');
    write('libs/domain/src/uses.spec.ts', "import { x } from './aXb';\n");
    assert.equal(untested().length, 1);
  });


  it('survives a stem full of regex metacharacters', () => {
    write('libs/domain/src/a+b(c).ts', 'export const x = 1;\n');
    write('libs/domain/src/uses.spec.ts', "import { x } from './a+b(c)';\n");
    assert.deepEqual(untested(), []);
  });

});

// @traces 1359-FR-005
describe('untested-new-file under nodenext resolution', () => {
  it('warns when the only mention has no extension', () => {
    write('apps/web-e2e/src/thing.ts', 'export const thing = 1;\n');
    write('apps/web-e2e/src/uses.spec.ts', "import { thing } from './thing';\n");
    assert.equal(untested().length, 1);
  });

});
