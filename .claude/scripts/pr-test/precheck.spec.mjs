// @traces 1171-FR-007
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFlows, precheck, scenarios } from './precheck.mjs';

const SCRIPT = fileURLToPath(new URL('./precheck.mjs', import.meta.url));

const SPEC = `# Feature

### User Story 1 - A driver reads a price (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a garage, **Then** the intro shows.
2. **Given** a job, **Then** its row shows.

### User Story 2 - The brand range (Priority: P1)

**Acceptance Scenarios**:

1. **Given** BMW, **Then** the BMW range shows.

### Edge Cases

1. Not a scenario.
`;

const flowsOf = (body) => `export default async ({ baseURL }) => {\n${body}\n  return [];\n};\n`;

describe('scenarios', () => {
  it('names every numbered acceptance scenario of every user story, and nothing else', () => {
    assert.deepEqual(scenarios(SPEC), ['US1 scenario 1', 'US1 scenario 2', 'US2 scenario 1']);
    assert.deepEqual(scenarios('# no stories\n'), []);
  });
});

describe('precheck', () => {
  const loaded = { ok: true, isFunction: true };
  const covered = flowsOf("  // US1 scenario 1, US1 scenario 2\n  await page.goto(baseURL, { waitUntil: 'load' }); // US2 scenario 1");

  it('passes a flows file that loads, waits on no networkidle and names every scenario', () => {
    assert.deepEqual(precheck({ flowsText: covered, specText: SPEC, loaded }), []);
  });

  it('names a module that does not load, or whose default export is not a function', () => {
    assert.match(precheck({ flowsText: covered, specText: SPEC, loaded: { ok: false, error: 'SyntaxError: x' } }).join('\n'), /does not load: SyntaxError: x/);
    assert.match(precheck({ flowsText: covered, specText: SPEC, loaded: { ok: true, isFunction: false } }).join('\n'), /default export is not a function/);
  });

  it('names every line that waits for networkidle, which live updates never let settle', () => {
    const text = flowsOf("  await page.goto(baseURL, { waitUntil: 'networkidle' });\n  await page.waitForLoadState(\"networkidle\");\n  // US1 scenario 1 US1 scenario 2 US2 scenario 1");
    const problems = precheck({ flowsText: text, specText: SPEC, loaded });
    assert.equal(problems.filter((p) => /networkidle/.test(p)).length, 2);
    assert.match(problems[0], /:2:/);
  });

  it('names each scenario no flow and no "not a flow" line covers; a "not a flow" line with its reason covers one', () => {
    const text = flowsOf('  // US1 scenario 1\n  // not a flow: US2 scenario 1 — the brand range needs a seeded BMW range the QA stack has not');
    assert.deepEqual(precheck({ flowsText: text, specText: SPEC, loaded }), ['scenario not covered: US1 scenario 2 (name it in a flow, or add `// not a flow: US1 scenario 2 — <reason>`)']);
    const reasonless = flowsOf('  // US1 scenario 1 US1 scenario 2\n  // not a flow: US2 scenario 1');
    assert.match(precheck({ flowsText: reasonless, specText: SPEC, loaded }).join('\n'), /US2 scenario 1/);
  });

  it('does not read "US1 scenario 10" as covering "US1 scenario 1"', () => {
    const spec = '### User Story 1 - x\n\n**Acceptance Scenarios**:\n\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. j\n';
    const text = flowsOf(`  // ${Array.from({ length: 9 }, (_, i) => `US1 scenario ${i + 2}`).join(', ')}`);
    assert.deepEqual(precheck({ flowsText: text, specText: spec, loaded }).map((p) => p.match(/US1 scenario \d+/)[0]), ['US1 scenario 1']);
  });

  it('checks no scenario when no spec is given', () => {
    assert.deepEqual(precheck({ flowsText: flowsOf(''), specText: null, loaded }), []);
  });
});

describe('the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'precheck-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name, text) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 15_000 });

  it('exits 0 on a clean flows file and 1 with one line per problem', async () => {
    const spec = file('spec.md', SPEC);
    const good = file('good.mjs', flowsOf('  // US1 scenario 1 US1 scenario 2 US2 scenario 1'));
    assert.equal(run('--flows', good, '--spec', spec).status, 0);
    const bad = file('bad.mjs', flowsOf("  await page.goto(baseURL, { waitUntil: 'networkidle' });"));
    const r = run('--flows', bad, '--spec', spec);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim().split('\n').length, 4);
    assert.deepEqual((await checkFlows({ flows: bad, spec })).length, 4);
  });

  it('reports a module that fails to load', async () => {
    const broken = file('broken.mjs', 'export default async () => {');
    const r = run('--flows', broken);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /does not load/);
  });

  it('exits 64 without --flows', () => {
    assert.equal(run().status, 64);
  });
});
