import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { MAX_COMMITS, carriedFrom, carryDescription, carryKind, fetchCarryState, findCarry, findingCount, judgeCarry, latestReview, postCarry, readCarryState } from './carry.mjs';

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
  files: [{ filename: 'docs/how-to/email-sending.md' }],
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
    const code = docsCompare({ files: [{ filename: 'docs/x.md' }, { filename: 'apps/api/src/main.ts' }] });
    assert.match(judgeCarry(passing({ compare: code })), /apps\/api\/src\/main\.ts/);
    // Markdown the harness reads is not documentation (scripts/docs-only.ts).
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [{ filename: '.claude/skills/x/SKILL.md' }] }) })), /not documentation only/);
    // A rename lists both paths, so code moved into Markdown is a code change.
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [{ filename: 'docs/notes.md', previous_filename: 'scripts/x.ts' }] }) })), /scripts\/x\.ts/);
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [] }) })), /not documentation only/);
  });

  // @traces 1324-FR-007
  it('refuses a range that touches a deferred.md, since tech-debt tickets are retired', () => {
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [{ filename: 'specs/194-email-sending/deferred.md' }] }) })), /deferred\.md/);
    assert.match(judgeCarry(passing({ compare: docsCompare({ files: [{ filename: 'README.md' }, { filename: 'notes/deferred.md' }] }) })), /notes\/deferred\.md/);
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

  // Inside the merge gate every statuses read waits on the compare
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
    assert.deepEqual(findCarry({ pr: 21, gh }), { from: FROM, head: HEAD, kind: 'docs' });
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

// A passing lap that still reported medium or low findings: its fixes ride on its verdict.
const FINDINGS = 'No blocking findings; 3 in all. Booted 2/2.';
const fix = (sha, message, parents = 1) => ({ sha, parents: Array.from({ length: parents }, (_, i) => ({ sha: `${i}`.repeat(40) })), commit: { message } });
const fixesCompare = (over = {}) => ({
  status: 'ahead',
  base_commit: { sha: FROM },
  total_commits: 2,
  commits: [fix(MID, 'test(api): ST-9 pin the empty list'), fix(HEAD, 'fix(api): ST-9 empty list answers 200\n\nbody')],
  files: [{ filename: 'apps/api/src/list.ts' }, { filename: 'apps/api/src/list.spec.ts' }],
  ...over,
});
const fixes = (over = {}) => ({ from: FROM, head: HEAD, kind: 'fixes', fromReview: { state: 'success', description: FINDINGS }, compare: fixesCompare(), between: [], headReviews: [], ...over });

describe('the QA fixes carry', () => {
  // @traces 1362-FR-002
  it('names the commit and its kind, apart from the docs-only carry', () => {
    assert.equal(carryDescription(FROM, 'fixes'), `carried from ${FROM}: QA fixes`);
    assert.equal(carriedFrom(carryDescription(FROM, 'fixes')), FROM);
    assert.equal(carryKind(carryDescription(FROM, 'fixes')), 'fixes');
    assert.equal(carryKind(carryDescription(FROM)), 'docs');
    assert.equal(carryKind('No blocking findings; 2 in all'), null);
    assert.equal(carryKind('PR QA lap 2 passed; carried from abc1234: QA fixes'), null);
  });

  // @traces 1362-FR-003
  it('reads the finding count only from the PR tester\'s own success description', () => {
    assert.equal(findingCount(FINDINGS), 3);
    assert.equal(findingCount('No blocking findings; 0 in all. Booted 2/2.'), 0);
    assert.equal(findingCount('PR QA lap 2 passed'), null);
    assert.equal(findingCount('2 blocking findings; 5 in all'), null);
    assert.equal(findingCount(undefined), null);
  });

  // @traces 1362-FR-003
  it('accepts fix and test commits after a passing lap that reported findings, whatever paths they touch', () => {
    assert.equal(judgeCarry(fixes()), null);
    const scoped = fixesCompare({ commits: [fix(MID, 'style: tidy'), fix(HEAD, 'refactor(web)!: rename'), ] });
    assert.equal(judgeCarry(fixes({ compare: { ...scoped, total_commits: 2 } })), null);
    assert.equal(judgeCarry(fixes({ compare: fixesCompare({ commits: [fix(MID, 'docs(specs): note'), fix(HEAD, 'fix: x')] }) })), null);
  });

  // @traces 1362-FR-003
  it('refuses a fixes carry from a lap with no findings or no count', () => {
    assert.match(judgeCarry(fixes({ fromReview: { state: 'success', description: 'No blocking findings; 0 in all.' } })), /no medium or low finding/);
    assert.match(judgeCarry(fixes({ fromReview: { state: 'success', description: 'PR QA lap 2 passed' } })), /no medium or low finding/);
  });

  // @traces 1362-FR-003 1362-FR-006
  it('refuses a failing lap, a carried success, or a commit that is not an ancestor', () => {
    assert.match(judgeCarry(fixes({ fromReview: { state: 'failure', description: '1 blocking finding; 3 in all' } })), /no agent-review success/);
    assert.match(judgeCarry(fixes({ fromReview: { state: 'success', description: carryDescription(MID, 'fixes') } })), /itself carried/);
    assert.match(judgeCarry(fixes({ compare: fixesCompare({ status: 'diverged' }) })), /not an ancestor/);
  });

  // @traces 1362-FR-003
  it('refuses any commit that is not a fix, test, docs, style or refactor, and any merge commit', () => {
    for (const message of ['feat(api): ST-9 new route', 'chore: bump', 'ci: x', 'perf: y', 'Merge branch main', 'fixes things']) {
      const compare = fixesCompare({ commits: [fix(MID, 'test: a'), fix(HEAD, message)] });
      assert.match(judgeCarry(fixes({ compare })), /ccccccc is not a lap fix/, message);
    }
    const merge = fixesCompare({ commits: [fix(MID, "Merge remote-tracking branch 'origin/main'", 2), fix(HEAD, 'fix: a')] });
    assert.match(judgeCarry(fixes({ compare: merge })), /bbbbbbb is a merge commit/);
    const missing = fixesCompare({ commits: [{ sha: MID }, fix(HEAD, 'fix: a')] });
    assert.match(judgeCarry(fixes({ compare: missing })), /bbbbbbb/);
  });

  // @traces 1362-FR-003
  it('refuses a deferred.md, a long tail and a failing lap after the named commit, as the docs carry does', () => {
    assert.match(judgeCarry(fixes({ compare: fixesCompare({ files: [{ filename: 'specs/9-x/deferred.md' }] }) })), /deferred\.md/);
    assert.match(judgeCarry(fixes({ compare: fixesCompare({ total_commits: MAX_COMMITS + 1 }) })), /too large/);
    assert.match(judgeCarry(fixes({ between: [{ sha: MID, review: { state: 'failure', description: 'x' } }] })), /bbbbbbb.*failure/);
    assert.match(judgeCarry(fixes({ headReviews: [status('failure', '1 blocking finding')] })), /ccccccc.*failure/);
  });

  // @traces 1362-FR-004
  it('refuses a docs-only carry from a lap that reported findings: its fixes are owed', () => {
    assert.match(judgeCarry(passing({ fromReview: { state: 'success', description: FINDINGS } })), /reported 3 findings/);
    assert.equal(judgeCarry(passing({ fromReview: { state: 'success', description: 'No blocking findings; 0 in all.' } })), null);
  });

  const statuses = (map) => [/commits\/([0-9a-f]{40})\/statuses/, (args) => ok(map[args.join(' ').match(/commits\/([0-9a-f]{40})/)[1]] ?? [])];

  // @traces 1362-FR-004
  it('finds a fixes carry when the named lap reported findings, and says why not otherwise', () => {
    const rules = (compare) => [[/pr view/, viewOf([FROM, MID, HEAD])], [/compare\//, ok(compare)], statuses({ [FROM]: [status('success', FINDINGS)] })];
    assert.deepEqual(findCarry({ pr: 21, gh: fakeGh(rules(fixesCompare())).gh }), { from: FROM, head: HEAD, kind: 'fixes' });
    const feat = findCarry({ pr: 21, gh: fakeGh(rules(fixesCompare({ commits: [fix(MID, 'test: a'), fix(HEAD, 'feat: b')] }))).gh });
    assert.equal(feat.kind, 'fixes');
    assert.match(feat.reason, /not a lap fix/);
    const docs = findCarry({ pr: 21, gh: fakeGh([[/pr view/, viewOf([FROM, MID, HEAD])], [/compare\//, ok(docsCompare({ total_commits: 2, commits: [fix(MID, 'chore: a'), fix(HEAD, 'chore: b')] }))], statuses({ [FROM]: [status('success', 'No blocking findings; 0 in all.')] })]).gh });
    assert.deepEqual(docs, { from: FROM, head: HEAD, kind: 'docs' });
  });

  // @traces 1362-FR-002
  it('posts the fixes description and says so in the Agent review section', () => {
    const { calls, gh } = fakeGh([[/pr view/, ok({ body: '## Agent review\n\nVerdict: success\n' })], [/statuses\//, ok({})], [/pr edit/, ok({})]]);
    postCarry({ pr: 21, from: FROM, head: HEAD, kind: 'fixes', gh });
    const set = calls.find((c) => c.args.includes(`repos/{owner}/{repo}/statuses/${HEAD}`));
    assert.ok(set.args.includes(`description=carried from ${FROM}: QA fixes`));
    const edit = calls.find((c) => c.args.includes('edit'));
    assert.match(edit.input, /carried from aaaaaaa to ccccccc/);
    assert.match(edit.input, /Fixed after QA/);
  });
});

// @traces 1363-throughput-fixes-FR-010
describe('the merge-of-main carry', () => {
  const MAIN = 'd'.repeat(40);
  const MERGE_MESSAGE = "Merge remote-tracking branch 'origin/main' into 9-x";
  const merge = (sha, first, second = MAIN) => ({ sha, parents: [{ sha: first }, { sha: second }], commit: { message: MERGE_MESSAGE } });
  // Main brought in more commits and files than any cap allows: none of them is the PR's.
  const fromMain = Array.from({ length: MAX_COMMITS + 3 }, (_, i) => ({ sha: `9${i}`.padEnd(40, '0'), parents: [{ sha: '8'.repeat(40) }], commit: { message: 'feat(web): ST-1 another story' } }));
  const mainFiles = Array.from({ length: 40 }, (_, i) => ({ filename: `apps/api/src/other-${i}.ts` }));
  const mergeCompare = (commits = [...fromMain, merge(HEAD, FROM)]) => ({ status: 'ahead', base_commit: { sha: FROM }, total_commits: commits.length, commits, files: mainFiles });
  const sides = (over = {}) => ({ main: mainFiles.map((f) => f.filename), pr: ['apps/web/src/mine.ts', 'apps/web/src/mine.spec.ts'], ...over });
  const merged = (over = {}) => ({ from: FROM, head: HEAD, kind: 'merge', fromReview: { state: 'success', description: 'No blocking findings; 0 in all.' }, compare: mergeCompare(), merges: { [HEAD]: sides() }, between: [], headReviews: [], ...over });

  it('names the commit and its kind, apart from the other two', () => {
    assert.equal(carryDescription(FROM, 'merge'), `carried from ${FROM}: merge of main`);
    assert.equal(carriedFrom(carryDescription(FROM, 'merge')), FROM);
    assert.equal(carryKind(carryDescription(FROM, 'merge')), 'merge');
    assert.equal(carryKind(carryDescription(FROM, 'fixes')), 'fixes');
  });

  it('carries a merge whose own diff touches none of the PR\'s files, however much main brought in', () => {
    assert.equal(judgeCarry(merged()), null);
  });

  it('refuses a merge that changes a file the PR changes, naming it', () => {
    const why = judgeCarry(merged({ merges: { [HEAD]: sides({ main: ['apps/api/src/other-1.ts', 'apps/web/src/mine.ts'] }) } }));
    assert.match(why, /ccccccc is a merge commit that changes apps\/web\/src\/mine\.ts/);
  });

  it('refuses a merge whose two sides were not read, or were too large to read whole', () => {
    assert.match(judgeCarry(merged({ merges: {} })), /ccccccc is a merge commit/);
    assert.match(judgeCarry(merged({ merges: { [HEAD]: sides({ main: Array.from({ length: 300 }, (_, i) => `f${i}`) }) } })), /too large/);
  });

  it('counts the caps over the PR\'s own first-parent commits only', () => {
    const many = [];
    let parent = FROM;
    for (let i = 0; i <= MAX_COMMITS; i++) {
      const sha = i === MAX_COMMITS ? HEAD : `7${i}`.padEnd(40, '0');
      many.push(merge(sha, parent));
      parent = sha;
    }
    const merges = Object.fromEntries(many.map((c) => [c.sha, sides()]));
    assert.match(judgeCarry(merged({ compare: mergeCompare([...fromMain, ...many]), merges })), /too large/);
  });

  it('rides on merges alone, and not over a lap whose fixes are owed', () => {
    const withFix = mergeCompare([...fromMain, { ...fix(MID, 'fix: a'), parents: [{ sha: FROM }] }, merge(HEAD, MID)]);
    assert.match(judgeCarry(merged({ compare: withFix })), /bbbbbbb is not a merge of main/);
    assert.match(judgeCarry(merged({ fromReview: { state: 'success', description: FINDINGS } })), /fixes are owed/);
  });

  it('lets a QA-fixes carry ride over a disjoint merge of main, and still refuses an overlapping one or a feature commit', () => {
    const compare = mergeCompare([...fromMain, { ...fix(MID, 'fix(api): a'), parents: [{ sha: FROM }] }, merge(HEAD, MID)]);
    const base = { ...merged({ compare }), kind: 'fixes', fromReview: { state: 'success', description: FINDINGS } };
    assert.equal(judgeCarry(base), null);
    assert.match(judgeCarry({ ...base, merges: { [HEAD]: sides({ main: ['apps/web/src/mine.ts'] }) } }), /changes apps\/web\/src\/mine\.ts/);
    const feat = mergeCompare([...fromMain, { ...fix(MID, 'feat(api): a'), parents: [{ sha: FROM }] }, merge(HEAD, MID)]);
    assert.match(judgeCarry({ ...base, compare: feat }), /bbbbbbb is not a lap fix/);
  });

  it('reads both sides of each merge and the statuses of the PR\'s own commits only', () => {
    const { calls, gh } = fakeGh([
      [/compare\/a{40}\.\.\.c{40}/, ok(mergeCompare())],
      [/compare\/d{40}\.\.\.c{40}/, ok({ status: 'ahead', files: sides().pr.map((filename) => ({ filename })) })],
      [/commits\/a{40}\/statuses/, ok([status('success', 'No blocking findings; 0 in all.')])],
      [/commits\/c{40}\/statuses/, ok([])],
    ]);
    const state = readCarryState({ from: FROM, head: HEAD, gh });
    assert.deepEqual(state.merges[HEAD].pr, sides().pr);
    assert.equal(calls.filter((c) => /statuses/.test(c.args.join(' '))).length, 2);
    assert.equal(judgeCarry({ from: FROM, head: HEAD, kind: 'merge', ...state }), null);
  });

  it('reads the same state at once for the merge gate', async () => {
    const { gh } = fakeGh([
      [/compare\/a{40}\.\.\.c{40}/, ok(mergeCompare())],
      [/compare\/d{40}\.\.\.c{40}/, ok({ status: 'ahead', files: sides().pr.map((filename) => ({ filename })) })],
      [/commits\/a{40}\/statuses/, ok([status('success', 'No blocking findings; 0 in all.')])],
      [/commits\/c{40}\/statuses/, ok([])],
    ]);
    const state = await fetchCarryState({ from: FROM, head: HEAD, gh: async (a) => gh(a) });
    assert.deepEqual(state, readCarryState({ from: FROM, head: HEAD, gh }));
  });

  it('finds a merge-of-main carry when the lap reported nothing and head merged main in', () => {
    const statuses = [/commits\/([0-9a-f]{40})\/statuses/, (args) => ok(args.join(' ').includes(FROM) ? [status('success', 'No blocking findings; 0 in all.')] : [])];
    const { gh } = fakeGh([
      [/pr view/, viewOf([FROM, HEAD])],
      [/compare\/a{40}\.\.\.c{40}/, ok(mergeCompare())],
      [/compare\/d{40}\.\.\.c{40}/, ok({ status: 'ahead', files: [{ filename: 'apps/web/src/mine.ts' }] })],
      statuses,
    ]);
    assert.deepEqual(findCarry({ pr: 21, gh }), { from: FROM, head: HEAD, kind: 'merge' });
  });

  it('keeps the single-parent rule for the fix commits themselves', () => {
    const compare = fixesCompare({ commits: [fix(MID, 'test: a'), fix(HEAD, 'feat: b')] });
    assert.match(judgeCarry(fixes({ compare })), /ccccccc is not a lap fix/);
  });
});
