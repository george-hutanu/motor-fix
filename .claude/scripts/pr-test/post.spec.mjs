import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { missingReport, postVerdict, replaceSection } from './post.mjs';

const OWN = 'gh: Unprocessable Entity (HTTP 422)\nCan not request changes on your own pull request';

/** A fake gh: answers by the first matching rule and records every call. */
function fakeGh(rules = []) {
  const calls = [];
  const gh = (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    const line = args.join(' ');
    for (const [pattern, answer] of rules) if (pattern.test(line)) return typeof answer === 'function' ? answer(args, opts) : answer;
    if (/pr view/.test(line)) return { code: 0, stdout: JSON.stringify({ body: 'Notion story: x' }), stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  };
  return { calls, gh };
}

const base = { pr: 21, repo: 'george-hutanu/motor-fix', sha: 'abc1234def', summary: '2 blocking findings', body: 'details' };
const reviewCalls = (calls) => calls.filter((c) => c.args.some((a) => /\/reviews$/.test(a)));
const events = (calls) => reviewCalls(calls).map((c) => JSON.parse(c.input).event);

describe('posting the review', () => {
  it('asks for changes on a failure and approves a success', () => {
    const a = fakeGh();
    postVerdict({ ...base, verdict: 'failure', gh: a.gh });
    assert.deepEqual(events(a.calls), ['REQUEST_CHANGES']);
    const b = fakeGh();
    postVerdict({ ...base, verdict: 'success', gh: b.gh });
    assert.deepEqual(events(b.calls), ['APPROVE']);
  });

  it('falls back to a COMMENT review that states the verdict when GitHub refuses a review of your own PR', () => {
    let first = true;
    const { calls, gh } = fakeGh([
      [/\/reviews\b/, () => (first ? ((first = false), { code: 1, stdout: '', stderr: OWN }) : { code: 0, stdout: '{}', stderr: '' })],
    ]);
    const out = postVerdict({ ...base, verdict: 'failure', gh });
    assert.deepEqual(events(calls), ['REQUEST_CHANGES', 'COMMENT']);
    const comment = JSON.parse(reviewCalls(calls)[1].input);
    assert.match(comment.body.split('\n')[0], /verdict: failure/i);
    assert.equal(comment.commit_id, base.sha);
    assert.equal(out.review, 'COMMENT');
  });

  it('sets agent-review on the tested commit, failure or success', () => {
    const { calls, gh } = fakeGh();
    postVerdict({ ...base, verdict: 'failure', gh });
    const status = calls.find((c) => c.args.some((a) => a === `repos/${base.repo}/statuses/${base.sha}`));
    assert.ok(status, 'no status call');
    const line = status.args.join(' ');
    assert.match(line, /state=failure/);
    assert.match(line, /context=agent-review/);
  });

  it('throws when the status cannot be set, so silence is never read as success', () => {
    const { gh } = fakeGh([[/statuses/, { code: 1, stdout: '', stderr: 'HTTP 403' }]]);
    assert.throws(() => postVerdict({ ...base, verdict: 'success', gh }), /agent-review/);
  });

  it('fills the description\'s Agent review section when the template has one', () => {
    const body = '## Summary\nx\n\n## Agent review\n<!-- filled by the PR tester -->\n\n## Checklist\n- [x] a\n';
    const { calls, gh } = fakeGh([[/pr view/, { code: 0, stdout: JSON.stringify({ body }), stderr: '' }]]);
    const out = postVerdict({ ...base, verdict: 'success', gh });
    const patch = calls.find((c) => c.args[0] === 'pr' && c.args[1] === 'edit' && c.args.includes('--body-file'));
    assert.ok(patch, 'description not updated');
    const next = patch.input;
    assert.match(next, /## Agent review\n[\s\S]*2 blocking findings[\s\S]*## Checklist/);
    assert.equal(out.section, 'description');
  });

  it('comments instead when the description has no Agent review section', () => {
    const { calls, gh } = fakeGh();
    const out = postVerdict({ ...base, verdict: 'success', gh });
    assert.ok(calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'comment'));
    assert.equal(out.section, 'comment');
  });

  it('posts nothing on a dry run and returns what it would have posted', () => {
    const { calls, gh } = fakeGh();
    const out = postVerdict({ ...base, verdict: 'failure', gh, dryRun: true });
    assert.equal(calls.filter((c) => c.args.includes('POST') || c.args[1] === 'edit' || c.args[1] === 'comment').length, 0);
    assert.equal(out.dryRun, true);
    assert.equal(out.status.state, 'failure');
    assert.match(out.reviewBody, /verdict: failure/i);
  });
});

describe('replacing a section', () => {
  it('replaces only the section body, up to the next heading of the same level or higher', () => {
    const body = '## A\n1\n## Agent review\nold\n### sub\nold too\n## B\n2';
    assert.equal(replaceSection(body, 'Agent review', 'new'), '## A\n1\n## Agent review\nnew\n\n## B\n2');
  });

  it('keeps the template\'s marker comment and replaces the Pending line under it', () => {
    const body = '## Checklist\n- [x] a\n\n## Agent review\n\n<!-- agent-review: the automated reviewer replaces the line below -->\nPending.\n';
    const next = replaceSection(body, 'Agent review', 'Verdict: success');
    assert.match(next, /<!-- agent-review: [^>]*-->\nVerdict: success/);
    assert.doesNotMatch(next, /Pending\./);
  });

  it('runs to the end when the section is last, and returns null when it is absent', () => {
    assert.equal(replaceSection('## Agent review\nold', 'Agent review', 'new'), '## Agent review\nnew\n');
    assert.equal(replaceSection('## Other\nx', 'Agent review', 'new'), null);
  });
});

describe('adding the agent\'s own findings', () => {
  it('recomputes the verdict, the summary and the report', async () => {
    const { addFindings } = await import('./post.mjs');
    const report = { pr: 21, sha: 'abc1234', lap: 1, verdict: 'success', summary: '', findings: [{ severity: 'low', kind: 'axe', title: 'x', steps: ['a'] }], booted: ['api', 'web'], notes: [], screenshots: [] };
    const next = addFindings(report, [{ severity: 'high', kind: 'review', title: 'A required behaviour is not implemented', steps: ['Read spec.md'] }]);
    assert.equal(next.verdict, 'failure');
    assert.match(next.summary, /1 blocking/);
    assert.match(next.markdown, /A required behaviour is not implemented/);
    assert.equal(next.findings.length, 2);
  });
});

describe('a lap that left no report', () => {
  const missing = { pr: 21, repo: 'george-hutanu/motor-fix', sha: 'abc1234def', lap: 2, reason: 'killed by SIGKILL during the sweep' };

  it('is a failure whose summary and finding carry the reason', () => {
    const r = missingReport(missing);
    assert.equal(r.verdict, 'failure');
    assert.match(r.summary, /SIGKILL during the sweep/);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].severity, 'blocker');
    assert.match(r.findings[0].title, /no report/i);
    assert.match(r.markdown, /SIGKILL during the sweep/);
    assert.equal(r.sha, 'abc1234def');
  });

  it('sets agent-review to failure on the head when posted', () => {
    const r = missingReport(missing);
    const a = fakeGh();
    postVerdict({ pr: r.pr, repo: r.repo, sha: r.sha, verdict: r.verdict, summary: r.summary, body: r.markdown, lap: r.lap, gh: a.gh });
    const status = a.calls.find((c) => c.args.some((x) => /statuses\/abc1234def$/.test(x)));
    assert.ok(status, 'a status was set on the head');
    assert.ok(status.args.includes('state=failure'));
    assert.ok(status.args.includes('context=agent-review'));
    assert.ok(status.args.some((x) => /^description=.*SIGKILL/.test(x)));
  });
});
