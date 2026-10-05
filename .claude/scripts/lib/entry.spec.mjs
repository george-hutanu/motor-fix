import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntryPoint } from './entry.mjs';

const helper = new URL('./entry.mjs', import.meta.url).href;
const hooks = fileURLToPath(new URL('../../hooks/', import.meta.url));
const dirs = [];
const argv1 = process.argv[1];

afterEach(() => {
  process.argv[1] = argv1;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A real folder holding a script that reports whether it, and a module it
// imports, are the entry point; plus a symlink to that folder.
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'entry-'));
  dirs.push(root);
  const real = join(root, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'other.mjs'), `import { isEntryPoint } from '${helper}';\nexport const other = isEntryPoint(import.meta.url);\n`);
  writeFileSync(
    join(real, 'main.mjs'),
    `import { isEntryPoint } from '${helper}';\nimport { other } from './other.mjs';\nconsole.log(JSON.stringify({ main: isEntryPoint(import.meta.url), other }));\n`,
  );
  symlinkSync(real, join(root, 'link'));
  return root;
};
const start = (script) => JSON.parse(spawnSync(process.execPath, [script], { encoding: 'utf8' }).stdout);

describe('isEntryPoint', () => {
  it('is true for the started module by its real path, and false for a module it imports', () => {
    assert.deepEqual(start(join(fixture(), 'real', 'main.mjs')), { main: true, other: false });
  });

  it('is true for the started module through a symlinked folder', () => {
    assert.deepEqual(start(join(fixture(), 'link', 'main.mjs')), { main: true, other: false });
  });

  it('is false, without throwing, when no script was started', () => {
    process.argv[1] = undefined;
    assert.equal(isEntryPoint(import.meta.url), false);
  });

  it('is false, without throwing, when the started path does not exist', () => {
    process.argv[1] = join(tmpdir(), 'no-such-dir-entry', 'gone.mjs');
    assert.equal(isEntryPoint(pathToFileURL(process.argv[1]).href), false);
  });
});

describe('the hooks find their entry point by real path', () => {
  const sources = readdirSync(hooks)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.spec.mjs'))
    .map((f) => [f, readFileSync(join(hooks, f), 'utf8')]);

  it('no hook compares process.argv[1] with its own URL', () => {
    const raw = sources.filter(([, s]) => /process\.argv\[1\]/.test(s)).map(([f]) => f);
    assert.deepEqual(raw, []);
  });

  it('every hook with an entry guard uses isEntryPoint', () => {
    const guarded = sources.filter(([, s]) => /isEntryPoint\(import\.meta\.url\)/.test(s)).map(([f]) => f);
    for (const f of ['merge-gate.mjs', 'pr-lifecycle-gate.mjs', 'config-protection.mjs', 'session-context.mjs', 'agent-model-router.mjs', 'session-watch-reminder.mjs']) {
      assert.ok(guarded.includes(f), `${f} does not use isEntryPoint`);
    }
  });
});
