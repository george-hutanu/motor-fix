import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { droppedTests } from './adversary-keep-gate.mjs';

const HOOK = new URL('./adversary-keep-gate.mjs', import.meta.url).pathname;
const OLD = [
  "describe('the gate', () => {",
  "  it('refuses a dropped test', () => {});",
  '  test("keeps the rest", () => {});',
  '});',
  '',
].join('\n');

const tree = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'adversary-keep-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
const gate = (cwd, tool_name, tool_input) => spawnSync('node', [HOOK], { cwd, input: JSON.stringify({ tool_name, tool_input }), encoding: 'utf8' });

// @traces 1363-throughput-fixes-FR-007
describe('an adversary spec only grows', () => {
  it('a Write lacking an old test is refused, naming the file and the test', () => {
    const dir = tree({ 'a.adversary.spec.ts': OLD });
    const r = gate(dir, 'Write', { file_path: 'a.adversary.spec.ts', content: "describe('the gate', () => {\n  test(\"keeps the rest\", () => {});\n});\n" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /a\.adversary\.spec\.ts/);
    assert.match(r.stderr, /refuses a dropped test/);
    assert.match(r.stderr, /append or add a file, never remove a test/);
  });

  it('an .mjs adversary spec is held the same way', () => {
    const dir = tree({ 'b.adversary.spec.mjs': OLD });
    assert.equal(gate(dir, 'Write', { file_path: join(dir, 'b.adversary.spec.mjs'), content: '' }).status, 2);
  });

  it('an Edit removing an it, test or describe line is refused', () => {
    const dir = tree({ 'a.adversary.spec.ts': OLD });
    assert.equal(gate(dir, 'Edit', { file_path: 'a.adversary.spec.ts', old_string: "  it('refuses a dropped test', () => {});\n", new_string: '' }).status, 2);
    assert.equal(gate(dir, 'Edit', { file_path: 'a.adversary.spec.ts', old_string: "describe('the gate', () => {", new_string: '{' }).status, 2);
  });

  it('an Edit appending a test goes through', () => {
    const dir = tree({ 'a.adversary.spec.ts': OLD });
    const r = gate(dir, 'Edit', { file_path: 'a.adversary.spec.ts', old_string: '});\n', new_string: "  it('a new probe', () => {});\n});\n" });
    assert.equal(r.status, 0, r.stderr);
  });

  it('a MultiEdit dropping a title is refused', () => {
    const dir = tree({ 'a.adversary.spec.ts': OLD });
    const edits = [
      { old_string: '});\n', new_string: "  it('a new probe', () => {});\n});\n" },
      { old_string: 'keeps the rest', new_string: 'keeps some' },
    ];
    assert.equal(gate(dir, 'MultiEdit', { file_path: 'a.adversary.spec.ts', edits }).status, 2);
  });

  it('the same Write to a spec that is not an adversary spec goes through', () => {
    const dir = tree({ 'a.spec.ts': OLD });
    assert.equal(gate(dir, 'Write', { file_path: 'a.spec.ts', content: '' }).status, 0);
  });

  it('a new adversary file goes through', () => {
    const dir = tree({});
    assert.equal(gate(dir, 'Write', { file_path: 'new.adversary.spec.ts', content: "it('x', () => {});\n" }).status, 0);
  });

  it('counts titles: a duplicate title removed once is a dropped test', () => {
    const twice = "it('same', () => {});\nit('same', () => {});\n";
    assert.deepEqual(droppedTests(twice, "it('same', () => {});\n"), ['same']);
    assert.deepEqual(droppedTests(twice, `${twice}it('more', () => {});\n`), []);
  });
});
