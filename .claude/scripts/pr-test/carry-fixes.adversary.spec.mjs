import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { MAX_COMMITS, carryDescription, findCarry, findingCount, judgeCarry } from './carry.mjs';

const FROM = 'a'.repeat(40);
const MID = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const ok = (stdout) => ({ code: 0, stdout: JSON.stringify(stdout), stderr: '' });
const status = (state, description) => ({ context: 'agent-review', state, description });
const FINDINGS = 'No blocking findings; 2 in all. Booted 2/2.';
const fix = (sha, message, parents = 1) => ({ sha, parents: Array.from({ length: parents }, (_, i) => ({ sha: `${i}`.repeat(40) })), commit: { message } });
const compareOf = (commits, over = {}) => ({
  status: 'ahead',
  base_commit: { sha: FROM },
  total_commits: commits.length,
  commits,
  files: [{ filename: 'apps/api/src/list.ts' }],
  ...over,
});
const judge = (commits, over = {}, compareOver = {}) =>
  judgeCarry({ from: FROM, head: HEAD, kind: 'fixes', fromReview: { state: 'success', description: FINDINGS }, compare: compareOf(commits, compareOver), between: [], headReviews: [], ...over });

function fakeGh(rules) {
  const gh = (args) => {
    const line = args.join(' ');
    for (const [pattern, answer] of rules) if (pattern.test(line)) return typeof answer === 'function' ? answer(args) : answer;
    return { code: 1, stdout: '', stderr: `unexpected gh ${line}` };
  };
  return gh;
}

describe('the QA fixes carry under hostile commits', () => {
  // @traces 1362-FR-003
  it('refuses a feat or merge commit in the middle of the range, not only at head', async () => {
    assert.match(judge([fix(MID, 'feat(api)!: new route'), fix(HEAD, 'fix: a')]), /bbbbbbb is not a lap fix/);
    assert.match(judge([fix(MID, 'fix: a', 2), fix(HEAD, 'fix: b')]), /bbbbbbb is a merge commit/);
  });

  // @traces 1362-FR-003
  it('refuses subjects that only look like a lap fix', async () => {
    for (const message of ['Revert "fix: a"', 'fixup! fix: a', 'squash! test: a', 'feat!: drop the field', ' fix: leading space']) {
      assert.match(judge([fix(HEAD, message)]), /ccccccc is not a lap fix/, message);
    }
  });

  // @traces 1362-FR-003
  it('reads the type from the subject line only, so a feat in the body does not refuse a fix', async () => {
    assert.equal(judge([fix(HEAD, 'fix!: rename the field\n\nfeat: not a subject')]), null);
  });

  // @traces 1362-FR-003
  it('accepts exactly MAX_COMMITS commits and 299 files, and refuses one more of either', async () => {
    const many = (n) => Array.from({ length: n }, (_, i) => fix(`${i}`.padStart(40, 'd'), 'test: a'));
    const files = (n) => Array.from({ length: n }, (_, i) => ({ filename: `apps/api/src/f${i}.ts` }));
    assert.equal(judge(many(MAX_COMMITS), {}, { files: files(299) }), null);
    assert.match(judge(many(MAX_COMMITS), {}, { files: files(300) }), /too large/);
    assert.match(judge(many(MAX_COMMITS + 1)), /too large/);
  });

  // @traces 1362-FR-003
  it('refuses a compare that lists fewer commits than it counts, since the rest cannot be verified', async () => {
    const compare = compareOf([fix(HEAD, 'fix: a')], { total_commits: 3 });
    assert.notEqual(judgeCarry({ from: FROM, head: HEAD, kind: 'fixes', fromReview: { state: 'success', description: FINDINGS }, compare, between: [], headReviews: [] }), null);
  });

  // @traces 1362-FR-003 1362-FR-004
  it('refuses an unknown carry kind rather than treating it as verified', async () => {
    assert.notEqual(judge([fix(HEAD, 'fix: a')], { kind: 'bogus' }), null);
  });

  // @traces 1362-FR-002
  it('never writes the word undefined into a carry description for an unknown kind', async () => {
    let text;
    try {
      text = carryDescription(FROM, 'bogus');
    } catch {
      return;
    }
    assert.doesNotMatch(text, /undefined/);
  });
});

describe('the finding count', () => {
  // @traces 1362-FR-003
  it('reads a zero with leading zeros as no findings and refuses a negative or fractional count', async () => {
    assert.equal(findingCount('No blocking findings; 00 in all'), 0);
    assert.equal(findingCount('No blocking findings; -1 in all'), null);
    assert.equal(findingCount('No blocking findings; 1.5 in all'), null);
  });

  // @traces 1362-FR-003
  it('refuses N=0 for the fixes kind even when the count is spelled with leading zeros', async () => {
    assert.match(judge([fix(HEAD, 'fix: a')], { fromReview: { state: 'success', description: 'No blocking findings; 00 in all' } }), /no medium or low finding/);
  });

  // @traces 1362-FR-003 1362-FR-004
  it('refuses a cloud lap with no count for either carry kind that would let its findings through', async () => {
    const cloud = { state: 'success', description: 'PR QA lap 3 passed' };
    assert.match(judge([fix(HEAD, 'fix: a')], { fromReview: cloud }), /no medium or low finding/);
  });
});

describe('finding a carry among several laps', () => {
  const statuses = (map) => [/commits\/([0-9a-f]{40})\/statuses/, (args) => ok(map[args.join(' ').match(/commits\/([0-9a-f]{40})/)[1]] ?? [])];
  const view = (shas) => ok({ number: 21, headRefOid: shas.at(-1), commits: shas.map((oid) => ({ oid })) });

  // @traces 1362-FR-004
  it('carries from the newest lap that reported findings, not an older clean one', async () => {
    const gh = fakeGh([
      [/pr view/, view([FROM, MID, HEAD])],
      [/compare\//, ok(compareOf([fix(HEAD, 'fix: a')], { base_commit: { sha: MID } }))],
      statuses({ [FROM]: [status('success', 'No blocking findings; 0 in all.')], [MID]: [status('success', FINDINGS)] }),
    ]);
    const out = await findCarry({ pr: 21, gh });
    assert.equal(out.from, MID);
    assert.equal(out.kind, 'fixes');
  });

  // @traces 1362-FR-006
  it('never carries from a lap that failed with findings, even when an older lap passed', async () => {
    const gh = fakeGh([
      [/pr view/, view([FROM, MID, HEAD])],
      [/compare\//, ok(compareOf([fix(MID, 'fix: a'), fix(HEAD, 'fix: b')]))],
      statuses({ [FROM]: [status('success', FINDINGS)], [MID]: [status('failure', '1 blocking finding; 4 in all')] }),
    ]);
    const out = await findCarry({ pr: 21, gh });
    assert.equal(out.from, undefined);
    assert.match(out.reason, /failure/);
  });
});
