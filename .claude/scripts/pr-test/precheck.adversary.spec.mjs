import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precheck, scenarios } from './precheck.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'precheck.mjs');
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'precheck-adv-'));
  dirs.push(d);
  return d;
};
const ok = { ok: true, isFunction: true };
const spec = (stories) => stories.map(([k, n]) => `### User Story ${k} - x (Priority: P1)\n\n**Acceptance Scenarios**:\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. **Given** a, **When** b, **Then** c`).join('\n')}\n`).join('\n');

describe('scenarios of a spec', () => {
  it('is empty for an empty spec and for one with no user stories', () => {
    assert.deepEqual(scenarios(''), []);
    assert.deepEqual(scenarios('# Title\n\n1. not a scenario\n'), []);
    assert.deepEqual(scenarios(undefined), []);
  });

  it('reads ten and more scenarios and several stories', () => {
    const out = scenarios(spec([[1, 11], [2, 1]]));
    assert.equal(out.length, 12);
    assert.ok(out.includes('US1 scenario 10'));
    assert.ok(out.includes('US1 scenario 11'));
    assert.ok(out.includes('US2 scenario 1'));
  });

  it('reads a spec with Windows line endings', () => {
    assert.deepEqual(scenarios(spec([[1, 2]]).replace(/\n/g, '\r\n')), ['US1 scenario 1', 'US1 scenario 2']);
  });

  it('ignores numbered lists outside the Acceptance Scenarios block of a story', () => {
    const t = '### User Story 1 - x\n\n**Why**:\n\n1. a reason\n\n**Acceptance Scenarios**:\n\n1. **Given** x\n\n**Independent Test**:\n\n1. step\n';
    assert.deepEqual(scenarios(t), ['US1 scenario 1']);
  });
});

describe('precheck of a flows file', () => {
  it('is clean for a loaded function with no spec', () => {
    assert.deepEqual(precheck({ flowsText: 'export default () => {}', loaded: ok }), []);
  });

  it('names a networkidle wait with its line number, every occurrence', () => {
    const p = precheck({ flowsText: "a\nawait page.goto(u, { waitUntil: 'networkidle' });\nb\npage.waitForLoadState(\"networkidle\")", loaded: ok, name: 'f.mjs' });
    assert.equal(p.length, 2);
    assert.match(p[0], /f\.mjs:2:/);
    assert.match(p[1], /f\.mjs:4:/);
  });

  it('reports a load failure and a non-function default export', () => {
    assert.equal(precheck({ flowsText: '', loaded: { ok: false, error: 'boom' } }).length, 1);
    assert.equal(precheck({ flowsText: '', loaded: { ok: true, isFunction: false } }).length, 1);
  });

  it('does not accept US1 scenario 1 as covering US1 scenario 10 or US11 scenario 1', () => {
    const p = precheck({ flowsText: '// US1 scenario 1\n// US11 scenario 1', specText: spec([[1, 10]]), loaded: ok });
    assert.equal(p.length, 9);
    assert.ok(p.some((l) => l.includes('US1 scenario 10')));
    assert.ok(!p.some((l) => l.includes('scenario not covered: US1 scenario 1 ')));
  });

  it('does not let US1 scenario 1 cover US2 scenario 1', () => {
    const p = precheck({ flowsText: '// US1 scenario 1', specText: spec([[1, 1], [2, 1]]), loaded: ok });
    assert.equal(p.length, 1);
    assert.match(p[0], /US2 scenario 1/);
  });

  it('accepts a not-a-flow line with a reason and rejects one with none', () => {
    const s = spec([[1, 2]]);
    assert.deepEqual(precheck({ flowsText: '// not a flow: US1 scenario 1 — needs a real mailbox\n// US1 scenario 2', specText: s, loaded: ok }), []);
    assert.equal(precheck({ flowsText: '// not a flow: US1 scenario 1\n// US1 scenario 2', specText: s, loaded: ok }).length, 1);
    assert.equal(precheck({ flowsText: '// not a flow: US1 scenario 1 —   \n// US1 scenario 2', specText: s, loaded: ok }).length, 1);
  });

  it('accepts an ASCII hyphen as the reason separator', () => {
    assert.deepEqual(precheck({ flowsText: '// not a flow: US1 scenario 1 - reason here', specText: spec([[1, 1]]), loaded: ok }), []);
  });

  it('reports a scenario once per missing scenario, with one line each', () => {
    const p = precheck({ flowsText: '', specText: spec([[1, 3]]), loaded: ok });
    assert.equal(p.length, 3);
  });

  it('does not flag a flows file whose comment only mentions the word in a prose line about load', () => {
    assert.deepEqual(precheck({ flowsText: "await page.goto(u, { waitUntil: 'load' });", loaded: ok }), []);
  });

  it('copes with a 5000-scenario spec quickly', () => {
    const start = Date.now();
    const p = precheck({ flowsText: 'x', specText: spec([[1, 5000]]), loaded: ok });
    assert.equal(p.length, 5000);
    assert.ok(Date.now() - start < 5000);
  });
});

describe('precheck command line', () => {
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 20_000 });
  const flowsFile = (text, name = 'flows.mjs') => {
    const d = tmp();
    const f = join(d, name);
    writeFileSync(f, text);
    return { d, f };
  };

  it('exits 64 with no --flows or a missing file', () => {
    assert.equal(cli().status, 64);
    assert.equal(cli('--flows', '/nonexistent/flows.mjs').status, 64);
    assert.equal(cli('--flows').status, 64);
  });

  it('exits 0 and prints nothing for a clean flows file', () => {
    const { f } = flowsFile('export default async () => {};\n');
    const r = cli('--flows', f);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  it('exits 1 for a syntax error and names the file', () => {
    const { f } = flowsFile('export default (( {\n');
    const r = cli('--flows', f);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /flows\.mjs does not load/);
  });

  it('exits 1 when the default export is an object', () => {
    const { f } = flowsFile('export default { a: 1 };\n');
    assert.equal(cli('--flows', f).status, 1);
  });

  it('exits 1 for a module with only named exports', () => {
    const { f } = flowsFile('export const flows = () => {};\n');
    assert.equal(cli('--flows', f).status, 1);
  });

  it('exits 1 for a flows file that throws while loading', () => {
    const { f } = flowsFile('throw new Error("top-level");\nexport default () => {};\n');
    assert.equal(cli('--flows', f).status, 1);
  });

  it('prints one line per uncovered scenario and exits 1', () => {
    const { d, f } = flowsFile('export default () => {};\n// US1 scenario 1\n');
    const s = join(d, 'spec.md');
    writeFileSync(s, spec([[1, 3]]));
    const r = cli('--flows', f, '--spec', s);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim().split('\n').length, 2);
  });

  it('exits 1 for a Latin-1 flows file that contains networkidle', () => {
    const { f } = flowsFile(Buffer.from("export default () => {}; // caf\xe9 networkidle\n", 'latin1').toString('latin1'));
    assert.equal(cli('--flows', f).status, 1);
  });

  it('does not silently pass when --spec names a file that does not exist', () => {
    const { f } = flowsFile('export default () => {};\n');
    assert.notEqual(cli('--flows', f, '--spec', '/nonexistent/spec.md').status, 0);
  });

  it('exits 1 for a binary blob given as the flows file', () => {
    const d = tmp();
    const f = join(d, 'flows.mjs');
    writeFileSync(f, Buffer.from([0, 255, 254, 1, 2, 3, 0, 0x80]));
    assert.equal(cli('--flows', f).status, 1);
  });
});
