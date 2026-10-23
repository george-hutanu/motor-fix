import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { judge, droppedTests } from './adversary-keep-gate.mjs';

const HOOK = new URL('./adversary-keep-gate.mjs', import.meta.url).pathname;
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const tree = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'adversary-keep-adv-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
const gate = (cwd, tool_name, tool_input) => spawnSync('node', [HOOK], { cwd, input: JSON.stringify({ tool_name, tool_input }), encoding: 'utf8' });
const FILE = 'a.adversary.spec.ts';
const BASE = ["describe('suite', () => {", "  it('first', () => {});", "  it('second', () => {});", '});', ''].join('\n');

// @traces 1363-FR-007
describe('an adversary spec cannot be thinned by other means than deleting the line', () => {
  it('commenting a test out drops it', () => {
    const dir = tree({ [FILE]: BASE });
    const content = BASE.replace("  it('second', () => {});", "  // it('second', () => {});");
    const r = gate(dir, 'Write', { file_path: FILE, content });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /second/);
  });

  it('a block comment around a test drops it', () => {
    const dir = tree({ [FILE]: BASE });
    const content = BASE.replace("  it('second', () => {});", "  /* it('second', () => {}); */");
    assert.equal(gate(dir, 'Write', { file_path: FILE, content }).status, 2);
  });

  it('adding a new test does not pay for dropping an old one', () => {
    const dir = tree({ [FILE]: BASE });
    const content = BASE.replace("  it('second', () => {});", "  it('third', () => {});");
    const r = gate(dir, 'Write', { file_path: FILE, content });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /"second"/);
    assert.doesNotMatch(r.stderr, /"third"/);
  });

  it('a MultiEdit whose second edit restores what the first removed goes through', () => {
    const dir = tree({ [FILE]: BASE });
    const edits = [
      { old_string: "it('second', () => {});", new_string: '' },
      { old_string: "it('first', () => {});", new_string: "it('first', () => {});\n  it('second', () => {});" },
    ];
    assert.equal(gate(dir, 'MultiEdit', { file_path: FILE, edits }).status, 0);
  });

});

// @traces 1363-FR-007
describe('an adversary spec read from odd places and in odd encodings', () => {
  it('a Latin-1 file with an accented comment still holds its titles', () => {
    const dir = tree({ [FILE]: Buffer.from("// caf\xe9\nit('first', () => {});\nit('second', () => {});\n", 'latin1') });
    const r = gate(dir, 'Write', { file_path: FILE, content: "it('first', () => {});\n" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /second/);
  });

  it('a symlink to an adversary spec outside the tree is held like the file it points at', () => {
    const outside = tree({ 'real.adversary.spec.ts': BASE });
    const dir = tree({});
    mkdirSync(join(dir, 'src'));
    symlinkSync(join(outside, 'real.adversary.spec.ts'), join(dir, 'src', 'link.adversary.spec.ts'));
    const r = judge({ tool: 'Write', input: { file_path: 'src/link.adversary.spec.ts', content: '' }, cwd: dir });
    assert.match(String(r), /first/);
  });

});
