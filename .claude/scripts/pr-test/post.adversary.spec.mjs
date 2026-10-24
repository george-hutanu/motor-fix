import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { postVerdict, runUrlFor } from './post.mjs';

function fakeGh(rules = []) {
  const calls = [];
  const gh = (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    const line = args.join(' ');
    for (const [pattern, answer] of rules) if (pattern.test(line)) return typeof answer === 'function' ? answer(args, opts) : answer;
    if (/pr view/.test(line)) return { code: 0, stdout: JSON.stringify({ body: 'Story: x' }), stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  };
  return { calls, gh };
}
const base = { pr: 21, repo: 'george-hutanu/motor-fix', sha: 'abc1234def', summary: '2 blocking findings', body: 'details', cloud: false };
const reviewCalls = (calls) => calls.filter((c) => c.args.some((a) => /\/reviews$/.test(a)));
const events = (calls) => reviewCalls(calls).map((c) => JSON.parse(c.input).event);
const statusCall = (calls) => calls.find((c) => c.args.includes(`repos/${base.repo}/statuses/${base.sha}`));

describe('own-PR refusal detection', () => {
  // @traces 1377-FR-002
  it('tries no COMMENT review for a 500 or an empty error and returns the error', () => {
    for (const stderr of ['gh: Internal Server Error (HTTP 500)', '', 'HTTP 422']) {
      const { calls, gh } = fakeGh([[/\/reviews\b/, { code: 1, stdout: '', stderr }]]);
      const out = postVerdict({ ...base, verdict: 'failure', gh });
      assert.deepEqual(events(calls), ['REQUEST_CHANGES'], stderr);
      assert.notEqual(out.reviewError, null, stderr);
    }
  });

  // @traces 1377-FR-002
  it('still writes the status and the description when the review fails with another 422', () => {
    const stderr = 'gh: Validation Failed (HTTP 422)\nBody is too long';
    const { calls, gh } = fakeGh([[/\/reviews\b/, { code: 1, stdout: '', stderr }]]);
    const out = postVerdict({ ...base, verdict: 'failure', gh });
    assert.match(statusCall(calls).args.join(' '), /state=failure/);
    assert.match(out.reviewError, /Body is too long/);
  });

  // @traces 1377-FR-003
  it('reports the error when the COMMENT fallback itself is refused', () => {
    const own = 'gh: Unprocessable Entity (HTTP 422)\nCan not approve your own pull request';
    const { calls, gh } = fakeGh([
      [/\/reviews\b/, (args, opts) => (JSON.parse(opts.input).event === 'COMMENT' ? { code: 1, stdout: '', stderr: 'gh: Validation Failed (HTTP 422)\ncommit_id is stale' } : { code: 1, stdout: '', stderr: own })],
    ]);
    const out = postVerdict({ ...base, verdict: 'success', gh });
    assert.deepEqual(events(calls), ['APPROVE', 'COMMENT']);
    assert.match(out.reviewError, /commit_id is stale/);
  });

  // @traces 1377-FR-002
  it('does not fall back for a 422 that mentions the phrase only as a quoted reviewed-text, not as GitHub message', () => {
    const stderr = 'gh: Validation Failed (HTTP 422)\n{"message":"Validation Failed","errors":["commit_id is not part of the pull request"]}';
    const { calls, gh } = fakeGh([[/\/reviews\b/, { code: 1, stdout: '', stderr }]]);
    postVerdict({ ...base, verdict: 'failure', summary: 'You cannot approve your own pull request', body: 'your own pull request', gh });
    assert.deepEqual(events(calls), ['REQUEST_CHANGES']);
  });

  // @traces 1377-FR-001
  it('has no reviewError after a clean review', () => {
    const { gh } = fakeGh();
    assert.equal(postVerdict({ ...base, verdict: 'success', gh }).reviewError, null);
  });

  // @traces 1377-FR-001
  it('makes no review calls in a dry run', () => {
    const { calls, gh } = fakeGh();
    postVerdict({ ...base, verdict: 'success', gh, dryRun: true });
    assert.deepEqual(reviewCalls(calls), []);
    assert.equal(statusCall(calls), undefined);
  });
});

describe('the run URL a report came from', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const reportWith = (content) => {
    const dir = mkdtempSync(join(tmpdir(), 'post-adv-'));
    dirs.push(dir);
    if (content !== undefined) writeFileSync(join(dir, 'ci-run.json'), typeof content === 'string' ? content : JSON.stringify(content));
    return join(dir, 'report.json');
  };

  // @traces 447-FR-002
  it('returns none for JSON that is not an object with a run URL', () => {
    for (const c of ['null', '[]', '"https://github.com/o/r/actions/runs/1"', '42', '{}', '', '{"url":null}', '{"url":42}', '{"url":["https://github.com/o/r/actions/runs/1"]}']) {
      assert.equal(runUrlFor(reportWith(c)), null, c);
    }
  });

  // @traces 447-FR-002
  it('returns none for URLs that merely look like a GitHub Actions run', () => {
    for (const url of [
      'https://github.com.evil.com/o/r/actions/runs/1',
      'https://evil.com/https://github.com/o/r/actions/runs/1',
      'http://github.com/o/r/actions/runs/1',
      'https://github.com/o/r/actions/runs/abc',
      'https://github.com/o/r/actions/runs/',
      'https://github.com/o/r/pull/1',
      'javascript:alert(1)//github.com/o/r/actions/runs/1',
    ]) {
      assert.equal(runUrlFor(reportWith({ url })), null, url);
    }
  });

  // @traces 447-FR-002
  it('returns none for a run URL with a line break or a trailing payload, which would corrupt the status call', () => {
    for (const url of ['https://github.com/o/r/actions/runs/1\nstate=success', 'https://github.com/o/r/actions/runs/1 context=x', 'https://github.com/o/r/actions/runs/1\r\n']) {
      assert.equal(runUrlFor(reportWith({ url })), null, JSON.stringify(url));
    }
  });

  // @traces 447-FR-002
  it('returns none when the report directory does not exist', () => {
    assert.equal(runUrlFor(join(tmpdir(), 'no-such-dir-adv-447', 'report.json')), null);
  });

  // @traces 447-FR-002
  it('returns the URL of a run whose ci-run.json carries extra fields', () => {
    const url = 'https://github.com/george-hutanu/motor-fix/actions/runs/987';
    assert.equal(runUrlFor(reportWith({ id: 987, url, conclusion: 'success', extra: { a: 1 } })), url);
  });
});
