import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importStyle as resolveImports } from './lib/tsconfig.mjs';

const importStyle = (...args) => resolveImports(...args)?.style ?? null;

// The import-extension rule follows the compiler, not the path: a file's
// nearest tsconfig.json (through `extends`) says whether its relative imports
// need `.js` (nodenext/node16), must not have it (bundler), or are not judged.

const SCRIPT = fileURLToPath(new URL('./diff-audit.mjs', import.meta.url));

let repo;
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};
const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
const run = () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--no-jev'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n');
};
const audit = () => run().filter((l) => l.includes('[import-extension]'));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'diff-audit-'));
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  // The shape of this repo: bundler at the base, one nodenext project.
  write('tsconfig.base.json', '{\n  // comments allowed\n  "compilerOptions": { "module": "esnext", "moduleResolution": "bundler", },\n}\n');
  write('libs/domain/tsconfig.json', { extends: '../../tsconfig.base.json', compilerOptions: { module: 'commonjs' } });
  write('apps/web-e2e/tsconfig.json', { extends: '../../tsconfig.base.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('importStyle — nearest tsconfig decides', () => {
  it('reads bundler through the extends chain', () => {
    write('libs/domain/src/a.ts', '');
    assert.equal(importStyle(repo, 'libs/domain/src/a.ts'), 'bundler');
  });

  it('reads nodenext from the project tsconfig over its base', () => {
    write('apps/web-e2e/src/a.ts', '');
    assert.equal(importStyle(repo, 'apps/web-e2e/src/a.ts'), 'nodenext');
  });

  it('takes node16 in module when moduleResolution is unset', () => {
    write('tools/x/tsconfig.json', { compilerOptions: { module: 'Node16' } });
    assert.equal(importStyle(repo, 'tools/x/src/a.ts'), 'nodenext');
  });

  it('judges nothing without a tsconfig', () => {
    assert.equal(importStyle(repo, 'scripts/a.ts'), null);
  });

  it('says whether .ts specifiers are allowed', () => {
    write('scripts/tsconfig.json', { extends: '../tsconfig.base.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowImportingTsExtensions: true } });
    assert.deepEqual(resolveImports(repo, 'scripts/a.ts'), { style: 'nodenext', tsExtensions: true });
    assert.deepEqual(resolveImports(repo, 'apps/web-e2e/src/a.ts'), { style: 'nodenext', tsExtensions: false });
  });

  it('judges nothing when the tsconfig does not parse', () => {
    write('tools/z/tsconfig.json', '{ "compilerOptions": { "module": "nodenext" ');
    assert.equal(importStyle(repo, 'tools/z/a.ts'), null);
  });
});

describe('diff-audit import-extension', () => {
  it('passes extensionless relative imports in a bundler lib', () => {
    write('libs/domain/src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    assert.deepEqual(audit(), []);
  });

  it('flags .js in a bundler lib', () => {
    write('libs/domain/src/a.ts', "import { b } from './b.js';\nexport const a = b;\n");
    const out = audit();
    assert.equal(out.length, 1);
    assert.match(out[0], /must drop \.js under bundler resolution/);
  });

  it('requires .js in a nodenext project and passes it when present', () => {
    write('apps/web-e2e/src/a.spec.ts', "import { b } from './b';\nimport { c } from './c.js';\n");
    const out = audit();
    assert.equal(out.length, 1);
    assert.match(out[0], /'\.\/b' needs the literal \.js extension under nodenext/);
  });

  it('accepts .ts specifiers in a nodenext project that allows importing them', () => {
    write('scripts/tsconfig.json', { extends: '../tsconfig.base.json', compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowImportingTsExtensions: true } });
    write('scripts/a.ts', "import { b } from './b.ts';\nimport { c } from './c';\n");
    const out = audit();
    assert.equal(out.length, 1);
    assert.match(out[0], /'\.\/c' needs the literal \.js or \.ts extension under nodenext/);
  });
});

describe('diff-audit dead-export', () => {
  const dead = () => run().filter((l) => l.includes('[dead-export]'));

  it('finds the user of an export whose name holds a dollar sign', () => {
    write('libs/client/src/fn.ts', 'export interface Find$Params { q: string }\n');
    write('libs/client/src/service.ts', "import { Find$Params } from './fn';\nexport const find = (p: Find$Params) => p;\nconst use = find;\n");
    write('libs/client/src/index.ts', "export { find } from './service';\n");
    assert.deepEqual(dead().filter((l) => l.includes('Find$Params')), []);
  });

  it('still names an export with a dollar sign that nothing imports', () => {
    write('libs/client/src/fn.ts', 'export interface Lost$Params { q: string }\n');
    assert.equal(dead().filter((l) => l.includes('Lost$Params')).length, 1);
  });
});

// Generator output is never edited by hand, so nothing in it is this
// branch's to fix: the same paths structure-check.ts leaves out.
describe('diff-audit generated code', () => {
  it('judges nothing in the generated client or Prisma output', () => {
    write('libs/data-access/src/lib/fn/find.ts', '/* eslint-disable */\nexport const lost = 1;\n');
    write('libs/domain/src/generated/client.ts', '// @ts-ignore\nexport const gone = 1;\n');
    assert.deepEqual(run().filter((l) => /data-access|generated/.test(l)), []);
  });

  it('still flags the same suppression in hand-written code', () => {
    write('libs/domain/src/a.ts', '/* eslint-disable */\nexport const a = 1;\n');
    assert.equal(run().filter((l) => l.includes('[suppression]')).length, 1);
  });
});

// The base is origin/main's merge-base: a worktree made from origin/main
// leaves the local main where the main checkout last had it, and diffing
// against that reports every file merged since as this branch's.
describe('diff-audit base', () => {
  const commit = (msg) => {
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD').stdout.trim();
  };
  const summary = () => run()[0];

  it('diffs against origin/main when the local main is stale', () => {
    commit('tsconfigs');
    write('libs/domain/src/merged.ts', 'export const merged = 1;\n');
    const upstream = commit('merged elsewhere');
    git('update-ref', 'refs/remotes/origin/main', upstream);
    git('reset', '-q', '--hard', 'HEAD~1');
    git('checkout', '-q', '-b', 'feature', 'origin/main');
    write('libs/domain/src/mine.ts', 'export const mine = 1;\n');
    commit('mine');
    assert.match(summary(), new RegExp(`^diff-audit: 1 changed file\\(s\\) vs ${upstream.slice(0, 7)} `));
  });

  it('falls back to main without origin/main', () => {
    const base = commit('tsconfigs');
    git('checkout', '-q', '-b', 'feature');
    write('libs/domain/src/mine.ts', 'export const mine = 1;\n');
    commit('mine');
    assert.match(summary(), new RegExp(`^diff-audit: 1 changed file\\(s\\) vs ${base.slice(0, 7)} `));
  });
});
