import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = new URL('./entry.mjs', import.meta.url).href;

let dir;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'entry-adv-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const script = (name, body = '') => {
  const file = join(dir, name);
  writeFileSync(file, `import { isEntryPoint } from '${ENTRY}';\n${body}\nconsole.log(String(isEntryPoint(import.meta.url)));\n`);
  return file;
};
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });

describe('isEntryPoint, started oddly', () => {
  it('is true for a script started through a symlink to the file', () => {
    const real = script('real.mjs');
    const link = join(dir, 'link.mjs');
    symlinkSync(real, link);
    assert.equal(node([link]).stdout.trim(), 'true');
  });

  it('is true for a script started through a symlinked folder', () => {
    mkdirSync(join(dir, 'real'));
    const real = join(dir, 'real', 'main.mjs');
    writeFileSync(real, `import { isEntryPoint } from '${ENTRY}';\nconsole.log(String(isEntryPoint(import.meta.url)));\n`);
    symlinkSync(join(dir, 'real'), join(dir, 'via'));
    assert.equal(node([join(dir, 'via', 'main.mjs')]).stdout.trim(), 'true');
  });

  it('is true for a script started through a chain of two symlinks', () => {
    const real = script('real.mjs');
    symlinkSync(real, join(dir, 'one.mjs'));
    symlinkSync(join(dir, 'one.mjs'), join(dir, 'two.mjs'));
    assert.equal(node([join(dir, 'two.mjs')]).stdout.trim(), 'true');
  });

  it('is true for a script started by a relative path', () => {
    script('rel.mjs');
    assert.equal(node(['./rel.mjs'], { cwd: dir }).stdout.trim(), 'true');
  });

  it('is true for a path with a space and non-ASCII characters', () => {
    mkdirSync(join(dir, 'sp ace é'));
    const file = join(dir, 'sp ace é', 'ü.mjs');
    writeFileSync(file, `import { isEntryPoint } from '${ENTRY}';\nconsole.log(String(isEntryPoint(import.meta.url)));\n`);
    assert.equal(node([file]).stdout.trim(), 'true');
  });

  it('is false for a module imported by the entry script', () => {
    script('dep.mjs');
    writeFileSync(join(dir, 'main.mjs'), `import './dep.mjs';\n`);
    assert.equal(node([join(dir, 'main.mjs')]).stdout.trim(), 'false');
  });

  it('is false for a module imported through a symlink by the entry script', () => {
    const dep = script('dep.mjs');
    symlinkSync(dep, join(dir, 'dep-link.mjs'));
    writeFileSync(join(dir, 'main.mjs'), `import './dep-link.mjs';\n`);
    assert.equal(node([join(dir, 'main.mjs')]).stdout.trim(), 'false');
  });

  it('is false, without throwing, when argv[1] is unset', () => {
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; console.log(String(isEntryPoint(import.meta.url)));`]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'false');
  });

  it('is false, without throwing, when argv[1] names a path that does not exist', () => {
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; process.argv[1] = '/no/such/file.mjs'; console.log(String(isEntryPoint(import.meta.url)));`]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'false');
  });

  it('is false, without throwing, when argv[1] is a dangling symlink', () => {
    symlinkSync(join(dir, 'gone.mjs'), join(dir, 'dangling.mjs'));
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; process.argv[1] = ${JSON.stringify(join(dir, 'dangling.mjs'))}; console.log(String(isEntryPoint(import.meta.url)));`]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'false');
  });

  it('is false, without throwing, when argv[1] is an empty string', () => {
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; process.argv[1] = ''; console.log(String(isEntryPoint(import.meta.url)));`]);
    assert.equal(out.stdout.trim(), 'false');
  });

  it('is false, without throwing, for a module URL that is not a file URL', () => {
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; console.log(String(isEntryPoint('https://example.com/a.mjs')));`]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'false');
  });

  it('is false, without throwing, when the module URL is undefined', () => {
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; console.log(String(isEntryPoint(undefined)));`]);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'false');
  });

  it('is false for a different script that sits in the same folder', () => {
    script('a.mjs');
    script('b.mjs');
    const out = node(['--input-type=module', '-e', `import { isEntryPoint } from '${ENTRY}'; process.argv[1] = ${JSON.stringify(join(dir, 'a.mjs'))}; console.log(String(isEntryPoint(${JSON.stringify('file://' + join(dir, 'b.mjs'))})));`]);
    assert.equal(out.stdout.trim(), 'false');
  });
});
