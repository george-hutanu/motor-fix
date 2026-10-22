import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redFirst, relativeSpecifiers, unresolvedSpecifier } from './red-first-spec.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'red-first-spec.mjs');
const env = { SPECKIT_BASE_REF: 'HEAD~1' };
const roots = [];

const write = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
};
const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();

const repo = (baseFiles, files = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'red-first-adv-'));
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

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

// @traces 1359-FR-001
describe('relativeSpecifiers on awkward source', () => {
  it('returns an empty list for empty text', () => {
    assert.deepEqual(relativeSpecifiers(''), []);
  });

  it('finds a specifier in a multi-line import with CRLF line endings', () => {
    assert.deepEqual(relativeSpecifiers("import {\r\n  a,\r\n  b,\r\n} from './multi';\r\n"), ['./multi']);
  });

  it('keeps a value import whose braces hold an inline type modifier', () => {
    assert.deepEqual(relativeSpecifiers("import { type T, u } from './mixed';"), ['./mixed']);
  });

  it('skips a multi-line import type', () => {
    assert.deepEqual(relativeSpecifiers("import type {\n  A,\n  B,\n} from './types';"), []);
  });


});

// @traces 1359-FR-001
describe('unresolvedSpecifier on awkward resolution', () => {
  it('calls a directory without an index.ts unresolved', () => {
    const root = repo({ 'libs/x/src/dir/readme.md': '' });
    assert.equal(unresolvedSpecifier(join(root, 'libs/x/src/a.spec.ts'), "import './dir';"), './dir');
  });



  it('calls a dangling symlink unresolved', () => {
    const root = repo({});
    mkdirSync(join(root, 'libs/x/src'), { recursive: true });
    symlinkSync('/nonexistent/target.ts', join(root, 'libs/x/src/link.ts'));
    assert.equal(unresolvedSpecifier(join(root, 'libs/x/src/a.spec.ts'), "import './link';"), './link');
  });

});

// @traces 1359-FR-001
describe('redFirst on hostile inputs', () => {
  const SPEC = 'libs/x/src/a.spec.ts';

  it('is red-first for a spec that was never committed', () => {
    const root = repo({});
    write(root, { [SPEC]: "import './a';\n" });
    assert.equal(redFirst(root, SPEC, env), './a');
  });

  it('is not red-first for an empty spec', () => {
    const root = repo({}, { [SPEC]: '' });
    assert.equal(redFirst(root, SPEC, env), null);
  });

  it('does not throw on a UTF-16 spec and does not call it red-first by its mojibake', () => {
    const root = repo({}, {});
    write(root, { [SPEC]: Buffer.from('﻿import "./a";\n', 'utf16le') });
    assert.doesNotThrow(() => redFirst(root, SPEC, env));
    assert.equal(redFirst(root, SPEC, env), null);
  });


  it('finishes on a spec of tens of megabytes', { timeout: 30_000 }, () => {
    const root = repo({});
    write(root, { [SPEC]: `${'// filler line\n'.repeat(1_400_000)}import './ghost';\n` });
    assert.equal(redFirst(root, SPEC, env), './ghost');
  });

  it('is not red-first for a missing file', () => {
    const root = repo({});
    assert.equal(redFirst(root, 'libs/x/src/gone.spec.ts', env), null);
  });


  it('treats an empty SPECKIT_BASE_REF as unset', () => {
    const root = repo({}, { [SPEC]: "import './a';\n" });
    assert.equal(redFirst(root, SPEC, { SPECKIT_BASE_REF: '' }), null);
  });
});

// @traces 1359-FR-001
describe('the CLI on hostile arguments', () => {
  const run = (root, args, extra = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, ...extra }, encoding: 'utf8' });


  it('exits 0 outside a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'red-first-nogit-'));
    roots.push(dir);
    write(dir, { 'a.spec.ts': "import './ghost';\n" });
    const r = run(dir, ['a.spec.ts'], env);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  it('prints only the specifier on stdout when red-first', () => {
    const root = repo({}, { 'libs/x/src/a.spec.ts': "import './ghost';\n" });
    const r = run(root, ['libs/x/src/a.spec.ts'], env);
    assert.deepEqual([r.status, r.stdout], [1, './ghost\n']);
  });
});
