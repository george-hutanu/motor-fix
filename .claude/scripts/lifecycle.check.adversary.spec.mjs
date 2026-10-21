import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from './lifecycle.mjs';

const FEATURE = '696-lifecycle-script';
const BRANCH = FEATURE;
const TITLE = 'chore(harness): ST-696 lifecycle steps as one script call each';
const REST = 'gh api repos/{owner}/{repo}/';
const LOCAL = /^(node scripts\/|npm run lint|sh scripts\/heavy\.sh)/;

let repo;

function fixture() {
  repo = mkdtempSync(join(tmpdir(), 'lifecycle-adv-'));
  const featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696 (Task)\n');
  writeFileSync(join(featureDir, 'tracker-sync.md'), `# Tracker sync — ${FEATURE}\n\n- 2026-10-05 · start · ST-696 · To do → Planning\n`);
  writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## Why\n\n_(fill in: why)_\n');
  writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
}

const pullOf = (over = {}) => ({ number: 141, state: 'open', merged_at: null, draft: true, title: TITLE, body: '## Why\n\nbecause', html_url: 'https://github.com/george-hutanu/motor-fix/pull/141', head: { ref: BRANCH, sha: 'abcdef1234567890' }, labels: [], ...over });

function harness({ pull = pullOf(), mergeBase = { stdout: 'b45e0000\n' }, answers = [], noPr = false } = {}) {
  const calls = [];
  const invocations = [];
  const bodies = [];
  const table = [
    ...answers,
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${BRANCH}\n` }],
    ['git rev-parse HEAD', { stdout: 'abcdef1234567890\n' }],
    ['git merge-base HEAD origin/main', mergeBase],
    [`${REST}pulls?head=`, { stdout: JSON.stringify([noPr ? [] : [pull]]) }],
    [`${REST}pulls/${pull.number} -X GET`, { stdout: JSON.stringify(pull) }],
  ];
  const run = (file, args, opts = {}) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    invocations.push({ cmd, file, args, opts });
    if (cmd.startsWith('node scripts/pr-body-check.ts')) {
      const at = args.indexOf('--body-file');
      bodies.push(readFileSync(args[at + 1], 'utf8'));
    }
    const hit = table.find(([prefix]) => cmd.startsWith(prefix));
    const out = typeof hit?.[1] === 'function' ? hit[1](cmd) : hit?.[1];
    return { code: 0, stdout: '', stderr: '', ...out };
  };
  return { io: { repo, env: { GH_TOKEN: 'tok' }, run, gate: () => ({ code: 0, stderr: '' }) }, calls, invocations, bodies };
}

const local = (h) => h.calls.filter((c) => LOCAL.test(c));

// @traces 1355-FR-001
// @traces 1355-FR-002
describe('lifecycle check: a failure of any kind stops the push', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  for (const [prefix, name] of [
    ['node scripts/observability-inventory.ts', 'observability-inventory'],
    ['node scripts/structure-check.ts', 'structure-check'],
    ['npm run lint', 'lint'],
    ['sh scripts/heavy.sh', 'affected typecheck and unit tests'],
    ['node scripts/pr-body-check.ts', 'pr-body-check'],
  ]) {
    it(`stops at ${name} when it exits with a signal-style null code and only stderr`, () => {
      const h = harness({ answers: [[prefix, { code: null, stdout: '', stderr: 'spawn ENOENT' }]] });
      const result = step(['check'], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, name);
      assert.match(result.fix, /spawn ENOENT/);
    });

    it(`stops at ${name} on exit 127 and names that check, not a later one`, () => {
      const h = harness({ answers: [[prefix, { code: 127, stdout: '', stderr: 'command not found' }]] });
      const result = step(['check'], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, name);
      const lastLocal = local(h).at(-1);
      assert.ok(lastLocal.startsWith(prefix), local(h).join('\n'));
    });
  }

  it('shows the end of a ten-thousand-line failure, where the cause sits', () => {
    const noise = Array.from({ length: 10000 }, (_, i) => `ok line ${i}`).join('\n');
    const h = harness({ answers: [['node scripts/observability-inventory.ts', { code: 1, stdout: `${noise}\ninventory: no entry for queue mail-unique-marker\n` }]] });
    const result = step(['check'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /no entry for queue mail-unique-marker/);
  });

  it('keeps both streams of a failing check', () => {
    const h = harness({ answers: [['npm run lint', { code: 1, stdout: 'STDOUT-MARK\n', stderr: 'STDERR-MARK\n' }]] });
    const result = step(['check'], h.io);
    assert.match(result.fix, /STDOUT-MARK/);
    assert.match(result.fix, /STDERR-MARK/);
  });

  it('stops without running the typecheck and tests when git cannot give a merge base', () => {
    const h = harness({ mergeBase: { code: 128, stdout: '', stderr: 'fatal: Not a valid object name origin/main' } });
    const result = step(['check'], h.io);
    assert.equal(result.ok, false);
    assert.ok(!h.calls.some((c) => c.startsWith('sh scripts/heavy.sh') && /--base=(\s|$|undefined)/.test(c)), h.calls.join('\n'));
    assert.ok(!h.calls.some((c) => c.startsWith('sh scripts/heavy.sh')), h.calls.join('\n'));
  });

  it('stops without running the typecheck and tests when the merge base is empty', () => {
    const h = harness({ mergeBase: { code: 0, stdout: '\n' } });
    const result = step(['check'], h.io);
    assert.equal(result.ok, false);
    assert.ok(!h.calls.some((c) => c.startsWith('sh scripts/heavy.sh')), h.calls.join('\n'));
  });
});

// @traces 1355-FR-001
describe('lifecycle check: what the body check is given', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('hands the PR body over byte for byte, unicode included', () => {
    const body = '## Why\n\nçînd mașina nu pornește — 日本語 ✓ 🚗\r\n\n```sh\n$(echo hi) `x`\n```\n';
    const h = harness({ pull: pullOf({ body }) });
    assert.equal(step(['check'], h.io).ok, true);
    assert.deepEqual(h.bodies, [body]);
  });

  it('runs the body check against an empty file when the PR body is null', () => {
    const h = harness({ pull: pullOf({ body: null }) });
    const result = step(['check'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(h.bodies, ['']);
  });

  it('passes a hostile title as one argument', () => {
    const title = 'feat(api): ST-1 a; rm -rf / `x` $(y) "q" \'z\'';
    const h = harness({ pull: pullOf({ title }) });
    step(['check'], h.io);
    const call = h.invocations.find((i) => i.cmd.startsWith('node scripts/pr-body-check.ts'));
    assert.equal(call.args[call.args.indexOf('--title') + 1], title);
  });

  it('skips the body check, saying so, and still runs every other check when no PR exists', () => {
    const h = harness({ noPr: true });
    const result = step(['check'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('node scripts/pr-body-check.ts')));
    assert.ok(result.did.some((d) => /pr-body-check skipped/.test(d)), JSON.stringify(result.did));
    assert.equal(local(h).length, 4, local(h).join('\n'));
  });

  it('uses the draft rules for a draft and the full rules for a ready PR', () => {
    const draft = harness({ pull: pullOf({ draft: true }) });
    step(['check'], draft.io);
    assert.match(draft.calls.find((c) => c.startsWith('node scripts/pr-body-check.ts')), /--draft$/);
    const ready = harness({ pull: pullOf({ draft: false }) });
    step(['check'], ready.io);
    assert.doesNotMatch(ready.calls.find((c) => c.startsWith('node scripts/pr-body-check.ts')), /--draft/);
  });

  it('runs the same checks in the same order on a second call', () => {
    const first = harness();
    const second = harness();
    step(['check'], first.io);
    step(['check'], second.io);
    const norm = (calls) => calls.filter((c) => LOCAL.test(c)).map((c) => c.replace(/--body-file \S+/, '--body-file X'));
    assert.deepEqual(norm(second.calls), norm(first.calls));
  });
});

// @traces 1355-FR-002
describe('lifecycle check: the affected tests are measured from the merge base', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('passes the merge base sha as --base and runs unit specs only', () => {
    const h = harness({ mergeBase: { stdout: '0123abcd\n' } });
    step(['check'], h.io);
    const cmd = h.calls.find((c) => c.startsWith('sh scripts/heavy.sh'));
    assert.match(cmd, /--base=0123abcd(\s|$)/);
    assert.match(cmd, /JEST_SUITE=unit/);
    assert.match(cmd, /nx affected -t typecheck test/);
  });
});
