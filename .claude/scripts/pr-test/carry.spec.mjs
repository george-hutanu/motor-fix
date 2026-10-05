import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { MAX_COMMITS, carriedFrom, carryDescription, fetchCarryState, findCarry, judgeCarry, latestReview, postCarry, readCarryState } from './carry.mjs';

const FROM = 'a'.repeat(40);
const MID = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const ok = (stdout) => ({ code: 0, stdout: JSON.stringify(stdout), stderr: '' });
const status = (state, description = 'No blocking findings') => ({ context: 'agent-review', state, description });
const docsCompare = (over = {}) => ({
  status: 'ahead',
  base_commit: { sha: FROM },
  total_commits: 1,
  commits: [{ sha: HEAD }],
  files: [{ filename: 'specs/194-email-sending/deferred.md' }],
  ...over,
});
const passing = (over = {}) => ({ from: FROM, head: HEAD, fromReview: { state: 'success', description: 'No blocking findings' }, compare: docsCompare(), between: [], headReviews: [], ...over });

/** A fake gh answering by the first matching rule, recording every call. */
function fakeGh(rules) {
  const calls = [];
  const gh = (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    const line = args.join(' ');
    for (const [pattern, answer] of rules) if (pattern.test(line)) return typeof answer === 'function' ? answer(args, opts) : answer;
    return { code: 1, stdout: '', stderr: `unexpected gh ${line}` };
  };
  return { calls, gh };
}

describe('the carry claim', () => {
  it('names the commit the verdict was carried from, and nothing else reads as a carry', () => {
    assert.equal(carriedFrom(carryDescription(FROM)), FROM);
    assert.equal(carriedFrom('carried from abc1234: docs-only change'), 'abc1234');
    assert.equal(carriedFrom('No blocking findings; carried from abc1234: docs-only change'), null);
    assert.equal(carriedFrom(undefined), null);
    assert.ok(carryDescription(FROM).length <= 140);
  });

  it('reads the newest agent-review status from the REST list, lowercased', () => {
    assert.deepEqual(latestReview([{ context: 'other', state: 'failure' }, status('success'), status('failure')]), { state: 'success', description: 'No blocking findings' });
    assert.equal(latestReview([{ context: 'other', state: 'success' }]), null);
  });
});

describe('judging a carry', () => {
  it('accepts a success on an ancestor with a docs-only diff to head', () => {
    assert.equal(judgeCarry(passing()), null);
  });

  it('refuses a named commit whose agent review failed, is missing, or was itself carried', () => {
    assert.match(judgeCarry(passing({ fromReview: { state: 'failure', description: 'x' } })), /no agent-review success/);
    assert.match(judgeCarry(passing({ fromReview: null })), /no agent-review success/);
    assert.match(judgeCarry(passing({ fromReview: { state: 'success', description: carryDescription(MID) } })), /itself carried/);
  });

  it('refuses a named commit that is not an ancestor of head', () => {
    assert.match(judgeCarry(passing({ compare: docsCompare({ status: 'diverged' }) })), /not an ancestor/);
    assert.match(judgeCarry(passing({ compare: docsCompare({ status: 'behind' }) })), /not an ancestor/);
    assert.match(judgeCarry(passing({ compare: docsCompare({ status: 'identical' }) })), /not an ancestor/);
  });

  it('refuses a diff that is not documentation only, by the docs-only.ts definition', () => {
    const code = docsCompare({ files: [{ filename: 'specs/x/deferred.md' }, { filename: 'apps/api/src/main.ts' }] });
    assert.match(judgeCarry(passing({ compare: code })), /apps\/api\/src\/main\.ts/);
    // Markdown the harness reads is not documentation (scripts/docs-only.ts).
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [{ filename: '.claude/skills/x/SKILL.md' }] }) })), /not documentation only/);
    // A rename lists both paths, so code moved into Markdown is a code change.
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [{ filename: 'docs/notes.md', previous_filename: 'scripts/x.ts' }] }) })), /scripts\/x\.ts/);
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [] }) })), /not documentation only/);
  });

  it('refuses a diff GitHub truncated, since the unseen files cannot be judged', () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md` }));
    assert.match(judgeCarry(passing({ compare: docsCompare({ files }) })), /too large/);
    assert.match(judgeCarry(passing({ compare: docsCompare({ total_commits: 300 }) })), /too large/);
  });

  it('refuses a docs-only tail longer than the commit cap, before reading a status per commit', () => {
    const many = Array.from({ length: MAX_COMMITS + 1 }, (_, i) => ({ sha: String(i).padStart(40, '0') }));
    const { calls, gh } = fakeGh([[/compare\//, ok(docsCompare({ total_commits: many.length, commits: many }))]]);
    const state = readCarryState({ from: FROM, head: HEAD, gh });
    assert.equal(calls.length, 1);
    assert.match(judgeCarry({ from: FROM, head: HEAD, ...state }), /too large/);
  });

  it('refuses a carry past a real failing verdict, on a commit between or on head itself', () => {
    assert.match(judgeCarry(passing({ between: [{ sha: MID, review: { state: 'failure', description: 'x' } }] })), /bbbbbbb.*failure/);
    assert.equal(judgeCarry(passing({ between: [{ sha: MID, review: { state: 'success', description: carryDescription(FROM) } }] })), null);
    assert.equal(judgeCarry(passing({ between: [{ sha: MID, review: null }] })), null);
    assert.match(judgeCarry(passing({ headReviews: [status('success', carryDescription(FROM)), status('failure', 'two blocking')] })), /ccccccc.*failure/);
  });
});

const viewOf = (commits) => ok({ headRefOid: HEAD, commits: commits.map((oid) => ({ oid })) });

describe('reading the state from GitHub', () => {
  it('reads the compare, the named commit, the commits between and head', () => {
    const { gh } = fakeGh([
      [/compare\/aaaaaaa\.\.\.c{40}/, ok(docsCompare({ total_commits: 2, commits: [{ sha: MID }, { sha: HEAD }] }))],
      [/commits\/a{40}\/statuses/, ok([status('success')])],
      [/commits\/b{40}\/statuses/, ok([])],
      [/commits\/c{40}\/statuses/, ok([status('success', carryDescription(FROM))])],
    ]);
    const state = readCarryState({ from: 'aaaaaaa', head: HEAD, gh });
    assert.equal(state.fromReview.state, 'success');
    assert.deepEqual(state.between, [{ sha: MID, review: null }]);
    assert.equal(state.headReviews.length, 1);
    assert.equal(judgeCarry({ from: 'aaaaaaa', head: HEAD, ...state }), null);
  });

  it('throws when gh fails, so the gate never reads silence as a pass', () => {
    const { gh } = fakeGh([]);
    assert.throws(() => readCarryState({ from: FROM, head: HEAD, gh }), /unexpected gh/);
  });

  // ST-659: inside the merge gate every statuses read waits on the compare
  // alone, so they go out together rather than one 10 s timeout after another.
  it('reads every status after the compare at once, and judges the same state as the one-by-one read', async () => {
    const rules = [
      [/compare\//, ok(docsCompare({ total_commits: 2, commits: [{ sha: MID }, { sha: HEAD }] }))],
      [/commits\/a{40}\/statuses/, ok([status('success')])],
      [/commits\/b{40}\/statuses/, ok([])],
      [/commits\/c{40}\/statuses/, ok([status('success', carryDescription(FROM))])],
    ];
    const { gh: sync } = fakeGh(rules);
    let inFlight = 0;
    let most = 0;
    const gh = async (args) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return sync(args);
    };
    const state = await fetchCarryState({ from: FROM, head: HEAD, gh });
    assert.equal(most, 3, 'the named commit, the commit between and head are read together');
    assert.deepEqual(state, readCarryState({ from: FROM, head: HEAD, gh: sync }));
    assert.equal(judgeCarry({ from: FROM, head: HEAD, ...state }), null);
  });

  it('reads nothing past the compare for a tail over the cap, and rejects when gh fails', async () => {
    const { calls, gh } = fakeGh([[/compare\//, ok(docsCompare({ total_commits: MAX_COMMITS + 1 }))]]);
    const state = await fetchCarryState({ from: FROM, head: HEAD, gh: async (a) => gh(a) });
    assert.equal(calls.length, 1);
    assert.match(judgeCarry({ from: FROM, head: HEAD, ...state }), /too large/);
    const broken = fakeGh([]);
    await assert.rejects(fetchCarryState({ from: FROM, head: HEAD, gh: async (a) => broken.gh(a) }), /unexpected gh/);
  });
});

describe('finding a carry for a PR', () => {
  const statuses = (map) => [/commits\/([0-9a-f]{40})\/statuses/, (args) => ok(map[args.join(' ').match(/commits\/([0-9a-f]{40})/)[1]] ?? [])];

  it('carries from the newest real success when the rest is docs-only', () => {
    const { gh } = fakeGh([
      [/pr view/, viewOf([FROM, MID, HEAD])],
      [/compare\//, ok(docsCompare({ total_commits: 2, commits: [{ sha: MID }, { sha: HEAD }] }))],
      statuses({ [FROM]: [status('success')] }),
    ]);
    assert.deepEqual(findCarry({ pr: 21, gh }), { from: FROM, head: HEAD });
  });

  it('skips an earlier carried success and carries from the commit that was tested', () => {
    const { gh } = fakeGh([
      [/pr view/, viewOf([FROM, MID, HEAD])],
      [/compare\/a{40}/, ok(docsCompare({ total_commits: 2, commits: [{ sha: MID }, { sha: HEAD }] }))],
      statuses({ [FROM]: [status('success')], [MID]: [status('success', carryDescription(FROM))] }),
    ]);
    assert.equal(findCarry({ pr: 21, gh }).from, FROM);
  });

  it('does not carry past a failing verdict, onto a head that has one, or with no success at all', () => {
    const failing = fakeGh([[/pr view/, viewOf([FROM, MID, HEAD])], statuses({ [FROM]: [status('success')], [MID]: [status('failure')] })]);
    assert.match(findCarry({ pr: 21, gh: failing.gh }).reason, /failure/);
    const judged = fakeGh([[/pr view/, viewOf([FROM, HEAD])], statuses({ [FROM]: [status('success')], [HEAD]: [status('pending')] })]);
    assert.match(findCarry({ pr: 21, gh: judged.gh }).reason, /already has/);
    const none = fakeGh([[/pr view/, viewOf([FROM, HEAD])], statuses({})]);
    assert.match(findCarry({ pr: 21, gh: none.gh }).reason, /no agent-review success/);
  });

  it('does not carry over a code change', () => {
    const { gh } = fakeGh([
      [/pr view/, viewOf([FROM, HEAD])],
      [/compare\//, ok(docsCompare({ files: [{ filename: 'apps/web/src/app.ts' }] }))],
      statuses({ [FROM]: [status('success')] }),
    ]);
    const out = findCarry({ pr: 21, gh });
    assert.equal(out.from, FROM);
    assert.match(out.reason, /apps\/web\/src\/app\.ts/);
  });
});

describe('posting a carry', () => {
  it('sets agent-review success on head naming the commit, and notes it in the Agent review section', () => {
    const { calls, gh } = fakeGh([
      [/pr view/, ok({ body: '## Agent review\n\n<!-- agent-review: the automated reviewer replaces the line below -->\nVerdict: success (agent-review on aaaaaaa, lap 1)\n' })],
      [/statuses\//, ok({})],
      [/pr edit/, ok({})],
    ]);
    const out = postCarry({ pr: 21, from: FROM, head: HEAD, gh });
    const set = calls.find((c) => c.args.includes(`repos/{owner}/{repo}/statuses/${HEAD}`));
    assert.ok(set.args.includes('state=success'));
    assert.ok(set.args.includes('context=agent-review'));
    assert.ok(set.args.includes(`description=${carryDescription(FROM)}`));
    const edit = calls.find((c) => c.args.includes('edit'));
    assert.match(edit.input, /carried from aaaaaaa to ccccccc/);
    assert.match(edit.input, /docs-only/);
    assert.equal(out.section, 'description');
  });

  it('posts nothing on a dry run', () => {
    const { calls, gh } = fakeGh([[/pr view/, ok({ body: '' })]]);
    const out = postCarry({ pr: 21, from: FROM, head: HEAD, gh, dryRun: true });
    assert.equal(out.dryRun, true);
    assert.ok(!calls.some((c) => c.args.some((a) => /statuses\//.test(a))));
  });

  it('throws when the status cannot be set', () => {
    const { gh } = fakeGh([[/pr view/, ok({ body: '' })], [/statuses\//, { code: 1, stdout: '', stderr: 'HTTP 403' }]]);
    assert.throws(() => postCarry({ pr: 21, from: FROM, head: HEAD, gh }), /HTTP 403/);
  });
});
