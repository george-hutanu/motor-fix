import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { missingReport, postVerdict, replaceSection, runUrlFor } from './post.mjs';

const OWN = 'gh: Unprocessable Entity (HTTP 422)\nCan not request changes on your own pull request';

/**
 * What `gh api` printed when GitHub refused the tester's APPROVE on PR #553 and
 * PR #554 (QA runs 40123063512, 40125063826), captured from the same call on
 * #552: gh writes the JSON body to stdout and only its summary line to stderr.
 */
const ghOwnPr422 = (message = 'Review Can not approve your own pull request') => ({
  stdout: `{"message":"Unprocessable Entity","errors":["${message}"],"documentation_url":"https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request","status":"422"}`,
  stderr: 'gh: Unprocessable Entity (HTTP 422)',
});

/** A fake gh: answers by the first matching rule and records every call. */
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

  // @traces 1377-FR-001
  it('falls back for either own-PR refusal GitHub sends, approve or request changes', () => {
    for (const [verdict, message] of [['success', 'Can not approve your own pull request'], ['failure', 'Can not request changes on your own pull request']]) {
      let first = true;
      const stderr = `gh: Unprocessable Entity (HTTP 422)\n{"message":"Unprocessable Entity","errors":["${message}"]}`;
      const { calls, gh } = fakeGh([[/\/reviews\b/, () => (first ? ((first = false), { code: 1, stdout: '', stderr }) : { code: 0, stdout: '{}', stderr: '' })]]);
      const out = postVerdict({ ...base, verdict, gh });
      assert.equal(events(calls).at(-1), 'COMMENT');
      assert.equal(out.reviewError, null);
    }
  });

  // @traces 1377-FR-002
  it('reports any other HTTP 422 as a failure and tries no COMMENT review, so the real error is not lost', () => {
    const stderr = 'gh: Validation Failed (HTTP 422)\n{"message":"Validation Failed","errors":["commit_id is not part of the pull request"]}';
    const { calls, gh } = fakeGh([[/\/reviews\b/, { code: 1, stdout: '', stderr }]]);
    const out = postVerdict({ ...base, verdict: 'success', gh });
    assert.deepEqual(events(calls), ['APPROVE']);
    assert.match(out.reviewError, /Validation Failed/);
    assert.match(out.reviewError, /commit_id is not part of the pull request/);
  });

  // @traces 1377-FR-001
  it('falls back to a COMMENT review with the same body on the 422 gh gave on #553 and #554: the JSON body on stdout, only the summary on stderr', () => {
    for (const [verdict, wanted] of [['success', 'APPROVE'], ['failure', 'REQUEST_CHANGES']]) {
      const message = wanted === 'APPROVE' ? 'Review Can not approve your own pull request' : 'Review Can not request changes on your own pull request';
      const { calls, gh } = fakeGh([
        [/\/reviews\b/, (args, opts) => (JSON.parse(opts.input).event === 'COMMENT' ? { code: 0, stdout: '{"id":1}', stderr: '' } : { code: 1, ...ghOwnPr422(message) })],
      ]);
      const out = postVerdict({ ...base, verdict, gh });
      assert.deepEqual(events(calls), [wanted, 'COMMENT']);
      const [first, second] = reviewCalls(calls).map((c) => JSON.parse(c.input));
      assert.equal(second.body, first.body);
      assert.equal(second.commit_id, base.sha);
      assert.equal(out.review, 'COMMENT');
      assert.equal(out.reviewError, null);
    }
  });

  // @traces 1377-FR-002
  it('reports a validation 422 in gh\'s real shape with GitHub\'s message, and tries no COMMENT review', () => {
    const stdout = '{"message":"Validation Failed","errors":["commit_id is not part of the pull request"],"documentation_url":"https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request","status":"422"}';
    const { calls, gh } = fakeGh([[/\/reviews\b/, { code: 1, stdout, stderr: 'gh: Validation Failed (HTTP 422)' }]]);
    const out = postVerdict({ ...base, verdict: 'success', gh });
    assert.deepEqual(events(calls), ['APPROVE']);
    assert.match(out.reviewError, /Validation Failed \(HTTP 422\)/);
    assert.match(out.reviewError, /commit_id is not part of the pull request/);
  });

  // @traces 1377-FR-003
  it('reports the COMMENT fallback\'s own refusal when GitHub refuses that too', () => {
    const { calls, gh } = fakeGh([
      [/\/reviews\b/, (args, opts) => (JSON.parse(opts.input).event === 'COMMENT' ? { code: 1, stdout: '{"message":"Validation Failed","errors":["Body is too long (maximum is 65536 characters)"]}', stderr: 'gh: Validation Failed (HTTP 422)' } : { code: 1, ...ghOwnPr422() })],
    ]);
    const out = postVerdict({ ...base, verdict: 'success', gh });
    assert.deepEqual(events(calls), ['APPROVE', 'COMMENT']);
    assert.match(out.reviewError, /Body is too long/);
  });

  // @traces 447-FR-002
  it('names the run the report came from as the status target, so the merge gate can judge it', () => {
    const url = 'https://github.com/george-hutanu/motor-fix/actions/runs/987';
    const a = fakeGh();
    postVerdict({ ...base, verdict: 'success', gh: a.gh, runUrl: url });
    const line = a.calls.find((c) => c.args.includes(`repos/${base.repo}/statuses/${base.sha}`)).args.join(' ');
    assert.match(line, new RegExp(`target_url=${url}`));
    const b = fakeGh();
    postVerdict({ ...base, verdict: 'success', gh: b.gh });
    assert.doesNotMatch(b.calls.find((c) => c.args.includes(`repos/${base.repo}/statuses/${base.sha}`)).args.join(' '), /target_url/);
  });

  // @traces 447-FR-002
  it("reads the run URL from the ci-run.json dispatch.mjs left beside the report, and none from anything else", () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-run-'));
    const report = join(dir, 'report.json');
    assert.equal(runUrlFor(report), null);
    writeFileSync(join(dir, 'ci-run.json'), JSON.stringify({ id: 987, url: 'https://github.com/george-hutanu/motor-fix/actions/runs/987', conclusion: 'success' }));
    assert.equal(runUrlFor(report), 'https://github.com/george-hutanu/motor-fix/actions/runs/987');
    writeFileSync(join(dir, 'ci-run.json'), JSON.stringify({ url: 'https://example.com/elsewhere' }));
    assert.equal(runUrlFor(report), null);
    writeFileSync(join(dir, 'ci-run.json'), 'not json');
    assert.equal(runUrlFor(report), null);
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

  // @traces 1377-FR-002
  it('names GitHub\'s reason from gh\'s stdout when the status is refused', () => {
    const stdout = '{"message":"Validation Failed","errors":["target_url must use http(s) scheme"],"status":"422"}';
    const { gh } = fakeGh([[/statuses/, { code: 1, stdout, stderr: 'gh: Validation Failed (HTTP 422)' }]]);
    assert.throws(() => postVerdict({ ...base, verdict: 'success', gh }), /Validation Failed \(HTTP 422\): target_url must use http\(s\) scheme/);
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

describe('posting from a cloud session, where the workflow owns the status and GraphQL is refused', () => {
  const cloudBody = '## Summary\nx\n\n## Agent review\n<!-- filled by the PR tester -->\n\n## Checklist\n- [x] a\n';
  const restPr = [/^api repos\/george-hutanu\/motor-fix\/pulls\/21$/, { code: 0, stdout: JSON.stringify({ body: cloudBody }), stderr: '' }];

  it('posts the review and writes no agent-review status', () => {
    const { calls, gh } = fakeGh([restPr]);
    const out = postVerdict({ ...base, verdict: 'failure', gh, cloud: true });
    assert.deepEqual(events(calls), ['REQUEST_CHANGES']);
    assert.equal(calls.filter((c) => c.args.some((a) => /statuses/.test(a))).length, 0);
    assert.equal(out.status, null);
  });

  it('reads and fills the Agent review section over REST, never through gh pr', () => {
    const { calls, gh } = fakeGh([restPr]);
    const out = postVerdict({ ...base, verdict: 'success', gh, cloud: true });
    assert.equal(calls.filter((c) => c.args[0] === 'pr').length, 0);
    const patch = calls.find((c) => c.args.join(' ') === 'api -X PATCH repos/george-hutanu/motor-fix/pulls/21 --input -');
    assert.ok(patch, 'description not patched over REST');
    assert.match(JSON.parse(patch.input).body, /## Agent review\n[\s\S]*2 blocking findings[\s\S]*## Checklist/);
    assert.equal(out.section, 'description');
  });

  it('comments over REST when the description has no Agent review section', () => {
    const { calls, gh } = fakeGh([[/^api repos\/george-hutanu\/motor-fix\/pulls\/21$/, { code: 0, stdout: JSON.stringify({ body: 'no section' }), stderr: '' }]]);
    const out = postVerdict({ ...base, verdict: 'success', gh, cloud: true });
    const comment = calls.find((c) => c.args.join(' ') === 'api -X POST repos/george-hutanu/motor-fix/issues/21/comments --input -');
    assert.ok(comment, 'no REST comment');
    assert.match(JSON.parse(comment.input).body, /Verdict: success/);
    assert.equal(out.section, 'comment');
  });

  it('defaults to the laptop path when CLAUDE_CODE_REMOTE is not true', () => {
    const { calls, gh } = fakeGh();
    postVerdict({ ...base, verdict: 'success', gh, cloud: false });
    assert.equal(calls.filter((c) => c.args.some((a) => /statuses/.test(a))).length, 1);
  });
});

describe('the post command', () => {
  // @traces 1377-FR-002
  it('exits 1 naming the error when GitHub refuses the review for another reason, after the status is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-cli-'));
    const log = join(dir, 'gh.log');
    writeFileSync(
      join(dir, 'gh'),
      `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in\n  */reviews*) echo 'gh: Validation Failed (HTTP 422)' >&2; exit 1 ;;\n  "pr view"*) echo '{"body":""}' ;;\n  *) echo '{}' ;;\nesac\n`,
    );
    chmodSync(join(dir, 'gh'), 0o755);
    const report = join(dir, 'report.json');
    writeFileSync(report, JSON.stringify({ pr: 21, repo: 'george-hutanu/motor-fix', sha: 'a'.repeat(40), verdict: 'success', summary: 'No blocking findings', markdown: 'x', lap: 1 }));
    const script = join(dirname(fileURLToPath(import.meta.url)), 'post.mjs');
    const run = spawnSync(process.execPath, [script, '--report', report], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_CODE_REMOTE: '' } });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /review was not posted: gh: Validation Failed/);
    const calls = readFileSync(log, 'utf8');
    assert.match(calls, /statuses\/a{40}.*state=success/);
    assert.equal(calls.match(/\/reviews/g).length, 1);
  });

  // @traces 1377-FR-001
  it('posts the COMMENT review and exits 0 when gh refuses the approval of your own PR the way it did on #553 and #554', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-cli-'));
    const log = join(dir, 'gh.log');
    const { stdout, stderr } = ghOwnPr422();
    writeFileSync(join(dir, 'refusal.json'), stdout);
    // The fake reads the review payload from stdin: APPROVE gets gh's real own-PR 422, COMMENT is posted.
    writeFileSync(
      join(dir, 'gh'),
      `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in\n  */reviews*) input=$(cat); echo "$input" >> "${log}"; case "$input" in *'"event":"COMMENT"'*) echo '{"id":1}' ;; *) cat "${join(dir, 'refusal.json')}"; echo '${stderr}' >&2; exit 1 ;; esac ;;\n  "pr view"*) echo '{"body":""}' ;;\n  *) echo '{}' ;;\nesac\n`,
    );
    chmodSync(join(dir, 'gh'), 0o755);
    const report = join(dir, 'report.json');
    writeFileSync(report, JSON.stringify({ pr: 553, repo: 'george-hutanu/motor-fix', sha: 'c'.repeat(40), verdict: 'success', summary: 'No blocking findings', markdown: 'x', lap: 1 }));
    const script = join(dirname(fileURLToPath(import.meta.url)), 'post.mjs');
    const run = spawnSync(process.execPath, [script, '--report', report], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_CODE_REMOTE: '' } });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).review, 'COMMENT');
    const calls = readFileSync(log, 'utf8');
    assert.equal(calls.match(/pulls\/553\/reviews/g).length, 2);
    assert.match(calls, /"event":"COMMENT"/);
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

  it('adds a finding the report already holds once, so a retry or a post after --dry-run lists it once', async () => {
    const { addFindings } = await import('./post.mjs');
    const report = { pr: 21, sha: 'abc1234', lap: 1, verdict: 'success', summary: '', findings: [{ severity: 'low', kind: 'axe', title: 'x', steps: ['a'] }], booted: ['api'], notes: [], screenshots: [] };
    const extra = [{ severity: 'high', kind: 'review', title: 'Missing behaviour', steps: ['Read spec.md'], evidence: 'a.mjs:1: x' }];
    const once = addFindings(report, extra);
    const again = addFindings(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(extra)));
    assert.deepEqual(again, once);
    assert.match(again.summary, /2 in all/);
    const other = addFindings(once, [{ ...extra[0], steps: ['Read plan.md'] }]);
    assert.equal(other.findings.length, 3);
    assert.equal(addFindings(report, [extra[0], { ...extra[0] }]).findings.length, 2);
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
    postVerdict({ pr: r.pr, repo: r.repo, sha: r.sha, verdict: r.verdict, summary: r.summary, body: r.markdown, lap: r.lap, gh: a.gh, cloud: false });
    const status = a.calls.find((c) => c.args.some((x) => /statuses\/abc1234def$/.test(x)));
    assert.ok(status, 'a status was set on the head');
    assert.ok(status.args.includes('state=failure'));
    assert.ok(status.args.includes('context=agent-review'));
    assert.ok(status.args.some((x) => /^description=.*SIGKILL/.test(x)));
  });
});
