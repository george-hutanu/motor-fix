import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCases, runCases } from './harness-eval.mjs';

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

// runCases makes its scratch under os.tmpdir(): each case points TMPDIR at a
// folder of its own, so the cleanup check here and the one in
// harness-eval.spec.mjs never see each other's folders when run in parallel.
let scratch;
let savedTmp;
beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'eval-link-adv-')));
  savedTmp = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
});
afterEach(() => {
  if (savedTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmp;
  rmSync(scratch, { recursive: true, force: true });
});

const twoLabels = (extra = {}) => ({
  id: 'two-labels',
  hook: 'stop:pr-lifecycle',
  why: 'a ready PR with two stage labels is refused whatever path started the gate',
  payload: {},
  env: {
    SPECKIT_PR_STATE: JSON.stringify({
      branch: 'chore-x',
      ahead: 3,
      unpushed: 0,
      blocked: false,
      pr: {
        number: 44,
        title: 'fix(harness): a change',
        state: 'OPEN',
        isDraft: false,
        labels: [{ name: 'in development' }, { name: 'QA' }, { name: 'bug' }],
        mergeable: 'MERGEABLE',
        statusCheckRollup: [],
      },
    }),
  },
  expect: { exit: 2, stderr: 'more than one stage label' },
  ...extra,
});

describe('runCases with symlink: true', () => {
  // @traces 486-FR-002
  it('judges the same through the link with a fixture repo as it does without the link', () => {
    const fixture = { commits: [{ files: { 'a.txt': 'x\n' } }] };
    const [plain, linked] = runCases(REPO, [twoLabels({ id: 'plain', fixture }), twoLabels({ id: 'linked', fixture, symlink: true })]);
    assert.equal(plain.pass, true, plain.detail);
    assert.equal(linked.pass, true, linked.detail);
  });

  // @traces 486-FR-002
  it('judges through the link on the working tree, not a fixture', () => {
    const [result] = runCases(REPO, [twoLabels({ symlink: true })]);
    assert.equal(result.pass, true, result.detail);
  });

  // @traces 486-FR-002
  it('runs two symlink cases that share an id', () => {
    const results = runCases(REPO, [twoLabels({ symlink: true }), twoLabels({ symlink: true })]);
    assert.deepEqual(results.map((r) => r.pass), [true, true]);
  });

  // @traces 486-FR-002
  it('runs a symlink case whose id holds a slash', () => {
    const [result] = runCases(REPO, [twoLabels({ id: 'a/b', symlink: true })]);
    assert.equal(result.pass, true, result.detail);
  });

  // @traces 486-FR-002
  it('runs a symlink case whose id holds a slash with a fixture', () => {
    const [result] = runCases(REPO, [twoLabels({ id: 'a/b', symlink: true, fixture: { commits: [{ files: { 'a.txt': 'x\n' } }] } })]);
    assert.equal(result.pass, true, result.detail);
  });

  // @traces 486-FR-002
  it('fails a symlink case whose expectation the gate does not meet', () => {
    const [result] = runCases(REPO, [twoLabels({ symlink: true, expect: { exit: 0 } })]);
    assert.equal(result.pass, false);
    assert.match(result.detail, /expected exit 0, got 2/);
  });

  // @traces 486-FR-002
  it('leaves no scratch folder or link behind after a symlink case', () => {
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('harness-eval-')));
    runCases(REPO, [twoLabels({ symlink: true })]);
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('harness-eval-') && !before.has(n));
    assert.deepEqual(after, []);
  });

  // @traces 486-FR-002
  it('does not follow the link when a case leaves symlink out', () => {
    const [result] = runCases(REPO, [twoLabels({ id: 'no-link' })]);
    assert.equal(result.pass, true, result.detail);
  });

  it('returns no results for no cases', () => {
    assert.deepEqual(runCases(REPO, []), []);
  });

  // @traces 486-FR-002
  it('holds exactly one shipped case that declares symlink', () => {
    const cases = loadCases(REPO).filter((c) => c.symlink);
    assert.deepEqual(cases.map((c) => c.hook), ['stop:pr-lifecycle']);
  });
});
