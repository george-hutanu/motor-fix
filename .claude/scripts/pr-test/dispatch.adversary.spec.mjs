import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './dispatch.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dispatch.mjs');
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** A gh on PATH that logs every call and answers `pr view` with an open PR. */
function sandbox() {
  const d = mkdtempSync(join(tmpdir(), 'dispatch-adv-'));
  dirs.push(d);
  const log = join(d, 'calls.log');
  writeFileSync(join(d, 'gh'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1 $2" in\n  "pr view") echo '{"state":"OPEN","headRefOid":"${'a'.repeat(40)}"}';;\n  *) echo '[]';;\nesac\n`);
  chmodSync(join(d, 'gh'), 0o755);
  return { d, log, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}
const cli = (sb, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 4_000, env: { ...process.env, CLAUDE_CODE_REMOTE: '', PATH: `${sb.d}:${process.env.PATH}` } });
const spec = '### User Story 1 - x\n\n**Acceptance Scenarios**:\n\n1. **Given** a\n2. **Given** b\n';

describe('dispatch --flows pre-check', () => {
  it('dispatches nothing and exits 64 for a flows file that waits for networkidle', () => {
    const sb = sandbox();
    const f = join(sb.d, 'flows.mjs');
    writeFileSync(f, "export default async (page) => { await page.goto('/', { waitUntil: 'networkidle' }); };\n");
    const r = cli(sb, '12', '--flows', f, '--spec', join(sb.d, 'none.md'));
    assert.equal(r.status, 64);
    assert.doesNotMatch(sb.calls(), /workflow run|run list/);
    assert.match(r.stderr, /networkidle/);
  });

  it('dispatches nothing for a flows file that leaves a scenario uncovered', () => {
    const sb = sandbox();
    const f = join(sb.d, 'flows.mjs');
    const s = join(sb.d, 'spec.md');
    writeFileSync(f, 'export default async () => {};\n// US1 scenario 1\n');
    writeFileSync(s, spec);
    const r = cli(sb, '12', '--flows', f, '--spec', s);
    assert.equal(r.status, 64);
    assert.match(r.stderr, /US1 scenario 2/);
    assert.doesNotMatch(sb.calls(), /workflow/);
  });

  it('dispatches nothing for a flows file that does not load', () => {
    const sb = sandbox();
    const f = join(sb.d, 'flows.mjs');
    writeFileSync(f, 'export default ((');
    const r = cli(sb, '12', '--flows', f);
    assert.equal(r.status, 64);
    assert.doesNotMatch(sb.calls(), /workflow/);
  });

  it('names a flows file that does not exist instead of dispatching', () => {
    const sb = sandbox();
    const r = cli(sb, '12', '--flows', join(sb.d, 'missing.mjs'));
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(sb.calls(), /workflow/);
  });

  it('goes on to dispatch once a clean flows file passes the pre-check', () => {
    const sb = sandbox();
    const f = join(sb.d, 'flows.mjs');
    writeFileSync(f, 'export default async () => {};\n');
    cli(sb, '12', '--flows', f, '--spec', join(sb.d, 'none.md'), '--no-wait');
    assert.match(sb.calls(), /workflow run/);
  }, 15_000);
});

describe('dispatch argument parsing', () => {
  it('finds the PR number wherever it stands among the flags', () => {
    assert.equal(parseArgs(['--lap', '2', '12', '--no-wait']).pr, '12');
    assert.equal(parseArgs(['12', '--run', '99']).pr, '12');
    assert.equal(parseArgs(['--run', '99', '12']).pr, '12');
  });
  it('does not take a flag value for the PR', () => {
    assert.equal(parseArgs(['--flows', '77']).pr, undefined);
    assert.equal(parseArgs(['--spec', '5', '--out', '6']).pr, undefined);
  });
  it('rejects an empty or non-numeric PR with the usage exit 64', () => {
    const sb = sandbox();
    for (const args of [[], ['abc'], ['--no-wait']]) assert.equal(cli(sb, ...args).status, 64, JSON.stringify(args));
  });
  it('rejects --run with --no-wait and a non-numeric --run', () => {
    const sb = sandbox();
    assert.equal(cli(sb, '12', '--run', '5', '--no-wait').status, 64);
    assert.equal(cli(sb, '12', '--run', 'abc').status, 64);
  });

  it('does not dispatch a new run when --run is given without a number', () => {
    const sb = sandbox();
    cli(sb, '12', '--run');
    assert.doesNotMatch(sb.calls(), /workflow run/);
  }, 15_000);
});
