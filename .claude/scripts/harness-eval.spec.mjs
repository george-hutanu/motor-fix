import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineFor, evaluate, loadCases, passRate, runCases } from './harness-eval.mjs';

// The eval runner measures the gates; these measure the runner. The full case
// suite is deliberately NOT run here — it goes through `npm run eval` and
// routine-verify, so the unit suite stays under its time budget.

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

describe('harness-eval — judging a case', () => {
  it('passes when the exit code and streams match', () => {
    const verdict = evaluate(
      { expect: { exit: 2, stderr: 'ratchet' } },
      { status: 2, stderr: 'Config protection: the mutation floor is a ratchet', stdout: '' },
    );
    assert.deepEqual(verdict, { pass: true, detail: '' });
  });

  it('fails on the exit code, and says which way', () => {
    const verdict = evaluate({ expect: { exit: 2 } }, { status: 0, stderr: '', stdout: '' });
    assert.equal(verdict.pass, false);
    assert.match(verdict.detail, /expected exit 2, got 0/);
  });

  it('fails when the message does not match, even with the right exit code', () => {
    const verdict = evaluate({ expect: { exit: 2, stderr: 'ratchet' } }, { status: 2, stderr: 'nope', stdout: '' });
    assert.equal(verdict.pass, false);
    assert.match(verdict.detail, /stderr did not match/);
  });

  it('checks only what the case declares', () => {
    assert.equal(evaluate({}, { status: 7, stderr: 'anything' }).pass, true);
  });
});

describe('harness-eval — scoring', () => {
  it('is the fraction of cases that hold', () => {
    assert.equal(passRate([{ pass: true }, { pass: true }, { pass: false }, { pass: true }]), 0.75);
    assert.equal(passRate([]), 0);
  });
});

describe('harness-eval — cases and baseline on disk', () => {
  it('loads this repo\'s cases, each with a hook, an expectation and a rationale', () => {
    const cases = loadCases(REPO);
    assert.ok(cases.length >= 10, 'the suite should cover more than a couple of behaviours');
    for (const c of cases) {
      assert.ok(c.id, 'every case has an id');
      assert.ok(c.hook, `${c.id} names a hook`);
      assert.ok(c.expect, `${c.id} declares an expectation`);
      assert.ok(c.why?.length > 20, `${c.id} records why the behaviour matters`);
    }
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'case ids are unique');
  });

  it('reads the ratchet, and defaults to a full pass rate when it is missing or broken', () => {
    assert.equal(baselineFor(REPO).pass_rate, 1);
    const empty = mkdtempSync(join(tmpdir(), 'eval-'));
    try {
      assert.equal(baselineFor(empty).pass_rate, 1);
      mkdirSync(join(empty, '.claude', 'evals'), { recursive: true });
      writeFileSync(join(empty, '.claude/evals/baseline.json'), '{ broken');
      assert.equal(baselineFor(empty).pass_rate, 1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('runs a case through the real runner entry point', () => {
    const [result] = runCases(REPO, [
      {
        id: 'smoke',
        hook: 'pre:bash:guard',
        why: 'the runner must reach a real gate, not just parse JSON',
        payload: { tool_input: { command: 'ls -la' } },
        expect: { exit: 0 },
      },
    ]);
    assert.equal(result.pass, true);
    assert.equal(result.hook, 'pre:bash:guard');
    assert.ok(result.ms >= 0);
  });

  it('materialises a transcript for a case that declares one', () => {
    const [result] = runCases(REPO, [
      {
        id: 'transcript',
        hook: 'subagent:verdict',
        why: 'transcript-driven gates need a file, and the runner builds it',
        transcript: ['## Code Review\n\nno verdict here'],
        expect: { exit: 2, stderr: 'VERDICT' },
      },
    ]);
    assert.equal(result.pass, true, result.detail);
  });
});
