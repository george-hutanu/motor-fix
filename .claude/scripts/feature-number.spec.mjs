// @traces 1018-FR-018
import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { traceTokens } from './lib/traces.mjs';
import { coveredTokens } from './lib/tests.mjs';
import { parseCapability, parseDelta } from './capabilities.mjs';
import { featureStatus, gatherStatus } from './status.mjs';
import { main as impactMain } from './impact.mjs';
import { main as retroMain } from './retro-evidence.mjs';

// Feature numbers grew past 999: a feature folder is `NNN-slug` with three or
// more digits, and its requirement ids are `<feature>-FR-NNN`, the FR part
// still three digits. Every reader of that grammar accepts the longer number
// whole, never as its last three digits.

const root = join(import.meta.dirname, '..', '..');
// Assembled at runtime: a literal id here would be scanned as a token.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;
const tag = '// ' + '@traces';

const dirs = [];
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'taskr-featnum-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const capability = (slug, { requirements = [], retired = [], features = [] } = {}) =>
  ['---', `capability: ${slug}`, 'updated: 2026-01-01', 'features:', ...features.map((f) => `  - ${f}`), '---', '',
    '## Requirements', '', ...requirements.flatMap(([t, text]) => [`### ${t} — ${text}`, '']),
    '## Retired', '', ...retired.map(([t, why]) => `- \`${t}\` — ${why}`), ''].join('\n');

const spec = [
  '# Spec', '',
  '- **FR-001**: sorts the list',
  '- **FR-002**: emits JSON',
  '- **FR-003**: was dropped', '',
  '## Spec Delta', '',
  '### Capability: `sorting`', '',
  '- **Adds**: FR-001, FR-002', '',
].join('\n');

const repoWith = (extra = {}) =>
  fixture({
    'specs/1018-fixture/spec.md': spec,
    'specs/1018-fixture/tasks.md': '- [X] T001 sort (FR-001)\n- [X] T002 emit (FR-002)\n',
    'libs/utils/src/sorting.spec.ts': `${tag} ${T('1018', '001')}\nit('sorts', () => {});\n`,
    '.specify/capabilities/sorting.md': capability('sorting', {
      requirements: [[T('001', '001'), 'an older requirement']],
      retired: [[T('1018', '003'), 'dropped']],
    }),
    ...extra,
  });

describe('four-digit feature numbers', () => {
  it('reads a four-digit feature id on a @traces line, and longer ones', () => {
    assert.deepEqual([...traceTokens(`${tag} ${T('1018', '001')} ${T('12345', '002')}`)], [T('1018', '001'), T('12345', '002')]);
  });

  it('still rejects a four-digit requirement number and a two-digit feature', () => {
    assert.deepEqual([...traceTokens(`${tag} ${T('1018', '0001')}`)], []);
    assert.deepEqual([...traceTokens(`${tag} ${T('18', '001')}`)], []);
  });

  it('counts the whole token a test carries, not its last three digits', () => {
    const covered = coveredTokens(repoWith());
    assert.ok(covered.has(T('1018', '001')));
    assert.ok(!covered.has(T('018', '001')));
  });

  it('parses four-digit ids and feature folders in a capability', () => {
    const cap = parseCapability(
      capability('docs', { requirements: [[T('1018', '001'), 'exports']], retired: [[T('1018', '002'), 'gone']], features: ['1018-docs-move'] }),
    );
    assert.deepEqual([...cap.requirements.keys()], [T('1018', '001')]);
    assert.deepEqual([...cap.retired.keys()], [T('1018', '002')]);
    assert.deepEqual(cap.features, ['1018-docs-move']);
  });

  it('parses four-digit ids in a Spec Delta Modifies and Removes', () => {
    const [section] = parseDelta(
      ['## Spec Delta', '', '### Capability: `docs`', '',
        `- **Modifies**: \`${T('1018', '001')}\` → FR-004`,
        `- **Removes**: \`${T('1018', '002')}\` — superseded`, ''].join('\n'),
    );
    assert.deepEqual(section.modifies, [{ base: T('1018', '001'), by: 'FR-004' }]);
    assert.equal(section.removes[0].base, T('1018', '002'));
  });

  it('status lists a four-digit feature and matches its tests and retirements', () => {
    const repo = repoWith();
    const report = gatherStatus(repo);
    const f = report.features.find((x) => x.feature === '1018-fixture');
    assert.ok(f, 'the four-digit feature is listed');
    const direct = featureStatus(repo, '1018-fixture', {
      covered: coveredTokens(repo),
      retired: new Set([T('1018', '003')]),
      capabilities: new Map(),
      staleDays: 14,
    });
    assert.deepEqual(direct.requirements, { declared: 3, live: 2, untested: 1, retired: 1 });
  });

  it('impact finds the tests of a requirement in a four-digit feature named on the command line', () => {
    const repo = repoWith();
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((s) => out.push(String(s)));
    assert.equal(impactMain(['specs/1018-fixture', 'FR-001'], repo), 0);
    assert.match(out.join('\n'), /libs\/utils\/src\/sorting\.spec\.ts/);
  });

  it('retro-evidence counts the retired requirements of a four-digit feature', () => {
    const repo = repoWith();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = {};
    assert.equal(retroMain(['specs/1018-fixture'], repo, out), 0);
    assert.equal(out.evidence.requirements.retired, 1);
  });

  it('capabilities merge writes the four-digit feature number into the capability', () => {
    const repo = repoWith();
    const run = spawnSync(process.execPath, [join(root, '.claude/scripts/capabilities.mjs'), 'merge', 'specs/1018-fixture', '--apply'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const cap = parseCapability(readFileSync(join(repo, '.specify/capabilities/sorting.md'), 'utf8'));
    assert.ok(cap.requirements.has(T('1018', '001')), [...cap.requirements.keys()].join(','));
    assert.ok(!cap.requirements.has(T('000', '001')));
  });

  it('trace-matrix counts a four-digit feature', () => {
    const repo = repoWith({ 'specs/1018-fixture/tasks.md': '- [X] T001 sort (FR-001)\n' });
    for (const rel of ['trace-matrix.mjs', 'capabilities.mjs', 'lib/feature.mjs', 'lib/tests.mjs', 'lib/traces.mjs']) {
      const to = join(repo, '.claude', 'scripts', rel);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(root, '.claude', 'scripts', rel), to);
    }
    const run = spawnSync(process.execPath, [join(repo, '.claude', 'scripts', 'trace-matrix.mjs'), '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });
    const f = JSON.parse(run.stdout).features.find((x) => x.feature === '1018-fixture');
    assert.ok(f, 'the four-digit feature is in the matrix');
    assert.equal(f.covered, 1);
  });
});
