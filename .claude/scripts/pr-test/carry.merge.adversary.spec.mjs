import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { MAX_COMMITS, judgeCarry } from './carry.mjs';

const FROM = 'a'.repeat(40);
const HEAD = 'c'.repeat(40);
const MAIN = 'd'.repeat(40);
const MAIN_B = 'e'.repeat(40);
const sha = (i) => `7${String(i).padStart(2, '0')}`.padEnd(40, '0');
const merge = (id, first, second = MAIN) => ({ sha: id, parents: [{ sha: first }, { sha: second }], commit: { message: "Merge remote-tracking branch 'origin/main'" } });
const chain = (n) => {
  const commits = [];
  let parent = FROM;
  for (let i = 0; i < n; i++) {
    const id = i === n - 1 ? HEAD : sha(i);
    commits.push(merge(id, parent));
    parent = id;
  }
  return commits;
};
const inMain = Array.from({ length: 25 }, (_, i) => ({ sha: `9${i}`.padEnd(40, '0'), parents: [{ sha: '8'.repeat(40) }], commit: { message: 'feat: other' } }));
const compareOf = (commits) => ({ status: 'ahead', base_commit: { sha: FROM }, total_commits: commits.length + inMain.length, commits: [...inMain, ...commits], files: [{ filename: 'apps/api/src/theirs.ts' }] });
const disjoint = { main: ['apps/api/src/theirs.ts'], pr: ['apps/web/src/mine.ts'] };
const carry = (commits, merges, over = {}) => ({
  from: FROM,
  head: HEAD,
  kind: 'merge',
  fromReview: { state: 'success', description: 'No blocking findings; 0 in all.' },
  compare: compareOf(commits),
  merges: merges ?? Object.fromEntries(commits.map((c) => [c.sha, disjoint])),
  between: [],
  headReviews: [],
  ...over,
});

// @traces 1363-FR-010
describe('the merge-of-main carry at its limits', () => {
  it('carries exactly the cap of PR-side merge commits and refuses one more', () => {
    assert.equal(judgeCarry(carry(chain(MAX_COMMITS))), null);
    assert.match(judgeCarry(carry(chain(MAX_COMMITS + 1))), /too large/);
  });

  it('carries a merge that changes nothing at all on either side', () => {
    const commits = chain(1);
    assert.equal(judgeCarry(carry(commits, { [HEAD]: { main: [], pr: [] } })), null);
  });

  it('refuses the second of two merges when only it overlaps, naming it', () => {
    const commits = chain(2);
    const merges = { [commits[0].sha]: disjoint, [HEAD]: { main: ['apps/web/src/mine.ts'], pr: ['apps/web/src/mine.ts'] } };
    const why = judgeCarry(carry(commits, merges));
    assert.match(why, /ccccccc is a merge commit that changes apps\/web\/src\/mine\.ts/);
  });

  it('refuses a merge whose first parent is main, not the lap it carries from', () => {
    const backwards = [merge(HEAD, MAIN, FROM)];
    const why = judgeCarry(carry(backwards, { [HEAD]: disjoint }));
    assert.equal(typeof why, 'string');
  });

  it('refuses a merge when its sides come back with a null or a non-list', () => {
    for (const bad of [{ main: null, pr: [] }, { main: [], pr: null }, { main: 'apps/a.ts', pr: [] }, {}]) {
      assert.equal(typeof judgeCarry(carry(chain(1), { [HEAD]: bad })), 'string', JSON.stringify(bad));
    }
  });

  it('refuses a merge carry when the head itself failed a real review', () => {
    const why = judgeCarry(carry(chain(1), undefined, { headReviews: [{ state: 'failure', description: 'Blocking findings' }] }));
    assert.match(why, /ccccccc itself has agent-review failure/);
  });

});
