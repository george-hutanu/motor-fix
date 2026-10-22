import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redFirst, relativeSpecifiers, unresolvedSpecifier } from './red-first-spec.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'red-first-spec.mjs');

const write = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
};

const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();

/** A repo whose first commit is the base; `files` are committed on top of it. */
const roots = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const repo = (baseFiles, files = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'red-first-'));
  roots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  write(root, { 'README.md': 'base\n', ...baseFiles });
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  write(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'branch', '--allow-empty');
  return root;
};

const env = { SPECKIT_BASE_REF: 'HEAD~1' };

// @traces 1359-FR-001
describe('relativeSpecifiers: the imports a red-first spec could be waiting on', () => {
  it('finds ./ and ../ literals in from, import(), require(), jest.mock() and jest.requireActual()', () => {
    const text = [
      "import { a } from './a';",
      "import '../side';",
      "const b = await import('./b');",
      "const c = require('../c');",
      "jest.mock('./d');",
      "const e = jest.requireActual(\"./e\");",
      "import { x } from '@nestjs/common';",
    ].join('\n');
    assert.deepEqual(relativeSpecifiers(text), ['./a', '../side', './b', '../c', './d', './e']);
  });

  it('skips commented-out imports, which are never loaded', () => {
    const text = "// import { a } from './old';\n/* jest.mock('./gone'); */\nimport { u } from './u'; // from './x'";
    assert.deepEqual(relativeSpecifiers(text), ['./u']);
  });

  it('skips import type, which is erased and never fails Jest', () => {
    assert.deepEqual(relativeSpecifiers("import type { T } from './types';\nimport { u } from './u';"), ['./u']);
  });
});

describe('unresolvedSpecifier: the first relative import that resolves to no file', () => {
  const root = repo({
    'libs/x/src/thing.ts': '',
    'libs/x/src/view.tsx': '',
    'libs/x/src/dir/index.ts': '',
    'libs/x/src/plain.json': '{}',
  });
  const spec = join(root, 'libs/x/src/a.spec.ts');

  it('resolves the literal path, a .ts or .tsx sibling, a .js written for a .ts and a directory index.ts', () => {
    const text = "import './plain.json';\nimport './thing';\nimport './view';\nimport './thing.js';\nimport './dir';";
    assert.equal(unresolvedSpecifier(spec, text), null);
  });

  it('names the first specifier that resolves to nothing, even beside ones that resolve', () => {
    assert.equal(unresolvedSpecifier(spec, "import './thing';\nimport { m } from './missing';"), './missing');
  });

  it('says nothing for a spec with only package or alias imports', () => {
    assert.equal(unresolvedSpecifier(spec, "import { a } from '@motor-fix/domain';"), null);
  });
});

describe('redFirst: new on the branch and importing something that does not exist yet', () => {
  it('is red-first when the spec is absent at the base and an import is unresolved', () => {
    const root = repo({}, { 'libs/x/src/a.spec.ts': "import { a } from './a';\n" });
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', env), './a');
  });

  it('is not red-first when the spec already exists at the base', () => {
    const root = repo({ 'libs/x/src/a.spec.ts': "import { a } from './a';\n" }, { 'libs/x/src/b.ts': '' });
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', env), null);
  });

  it('is not red-first when every relative import resolves', () => {
    const root = repo({ 'libs/x/src/a.ts': '' }, { 'libs/x/src/a.spec.ts': "import { a } from './a';\n" });
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', env), null);
  });

  it('is not red-first when no base can be found', () => {
    const root = repo({}, { 'libs/x/src/a.spec.ts': "import { a } from './a';\n" });
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', { SPECKIT_BASE_REF: 'no-such-ref' }), null);
  });

  it('takes SPECKIT_BASE_REF ahead of origin/main and main', () => {
    const root = repo({}, { 'libs/x/src/a.spec.ts': "import { a } from './a';\n" });
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', {}), null, 'main is HEAD, so the spec exists at the base');
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', env), './a');
  });

  it('counts a spec renamed on the branch as new at its new path', () => {
    const root = repo({ 'libs/x/src/old.spec.ts': "import { a } from './a';\n" });
    git(root, 'mv', 'libs/x/src/old.spec.ts', 'libs/x/src/a.spec.ts');
    git(root, 'commit', '-qm', 'rename');
    assert.equal(redFirst(root, 'libs/x/src/a.spec.ts', { SPECKIT_BASE_REF: 'HEAD~2' }), './a');
  });
});

describe('the CLI the post-edit hook calls', () => {
  const run = (root, rel, extra = {}) =>
    spawnSync(process.execPath, [CLI, rel], { cwd: root, env: { ...process.env, ...extra }, encoding: 'utf8' });

  it('exits 1 and prints the unresolved specifier for a red-first spec', () => {
    const root = repo({}, { 'libs/x/src/a.spec.ts': "import { a } from './a';\n" });
    const r = run(root, 'libs/x/src/a.spec.ts', env);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), './a');
  });

  it('exits 0 for any other spec, and for a file it cannot read', () => {
    const root = repo({ 'libs/x/src/a.ts': '' }, { 'libs/x/src/a.spec.ts': "import { a } from './a';\n" });
    assert.equal(run(root, 'libs/x/src/a.spec.ts', env).status, 0);
    assert.equal(run(root, 'libs/x/src/gone.spec.ts', env).status, 0);
  });
});
