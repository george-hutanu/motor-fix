import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from './lifecycle.mjs';

const FEATURE = '696-lifecycle-script';
const REST = 'gh api repos/{owner}/{repo}/';
const MERGE = 'gh api -X PUT repos/{owner}/{repo}/pulls/141/merge -f merge_method=merge';
const HEAD = 'abcdef1234567890';
const HEAD_STATUSES = `${REST}commits/${HEAD}/statuses?per_page=100`;
const FROM = '1'.repeat(40);
const FIX = '2'.repeat(40);
const PULL = { number: 141, state: 'open', merged_at: null, draft: false, title: 't', html_url: 'https://github.com/x/y/pull/141', merge_commit_sha: 'feed1234beef', head: { ref: FEATURE, sha: HEAD }, labels: [] };

let repo;
let featureDir;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'fixed-after-qa-'));
  featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696 (Task)\n');
  writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const review = (description) => ({ stdout: JSON.stringify([{ context: 'agent-review', state: 'success', description }]) });
const carried = (named, compareCommits) => [
  [HEAD_STATUSES, review(`carried from ${FROM}: QA fixes`)],
  [`${REST}commits/${FROM}/statuses`, review(named)],
  [`${REST}compare/${FROM}...${HEAD}`, { stdout: JSON.stringify({ status: 'ahead', commits: compareCommits }) }],
];

function run(answers) {
  const calls = [];
  const base = [
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${FEATURE}\n` }],
    ['git rev-parse HEAD', { stdout: `${HEAD}\n` }],
    ['gh auth token -u george-hutanu', { stdout: 'tok\n' }],
    [`${REST}pulls?head=`, { stdout: JSON.stringify([[PULL]]) }],
    [`${REST}pulls/141 -X GET`, { stdout: JSON.stringify(PULL) }],
    ['node .claude/scripts/tracker-sync.mjs finish', { stdout: '{"status":"Done"}\n' }],
  ];
  const table = [...answers, ...base];
  const io = {
    repo,
    env: { GH_TOKEN: 'tok' },
    gate: () => ({ code: 0, stderr: '' }),
    run: (file, args) => {
      const cmd = [file, ...args].join(' ');
      calls.push(cmd);
      const hit = table.find(([prefix]) => cmd.startsWith(prefix));
      return { code: 0, stdout: '', stderr: '', ...(typeof hit?.[1] === 'function' ? hit[1](cmd) : hit?.[1]) };
    },
  };
  return { result: step(['merge'], io), calls };
}

const list = (...lines) => writeFileSync(join(featureDir, 'finish-comment.md'), `## Fixed after QA\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
const commits = [{ sha: FIX }, { sha: HEAD }];

describe('Fixed after QA under a hostile list', () => {
  // @traces 1362-FR-007
  it('stops when a line names a commit that is not in the compare', () => {
    list('medium: a (9999999)', 'low: b (2222222)');
    const { result, calls } = run(carried('No blocking findings; 2 in all.', commits));
    assert.equal(result.stopped, 'Fixed after QA');
    assert.ok(!calls.includes(MERGE));
  });

  // @traces 1362-FR-007
  it('stops when a line names high instead of medium or low', () => {
    list('high: a (2222222)', 'low: b (2222222)');
    const { result, calls } = run(carried('No blocking findings; 2 in all.', commits));
    assert.equal(result.stopped, 'Fixed after QA');
    assert.ok(!calls.includes(MERGE));
  });

  // @traces 1362-FR-007
  it('stops when the list lines sit under a later heading, fewer than N under Fixed after QA', () => {
    writeFileSync(join(featureDir, 'finish-comment.md'), '## Fixed after QA\n\n- medium: a (2222222)\n\n## Decisions\n\n- low: b (2222222)\n');
    const { result, calls } = run(carried('No blocking findings; 2 in all.', commits));
    assert.equal(result.stopped, 'Fixed after QA');
    assert.ok(!calls.includes(MERGE));
  });

  // @traces 1362-FR-007
  it('stops under a carry whose named lap has no count, since the findings owed are unknown', () => {
    list('medium: a (2222222)');
    const { result, calls } = run(carried('PR QA lap 2 passed', commits));
    assert.equal(result.stopped, 'Fixed after QA');
    assert.ok(!calls.includes(MERGE));
  });

  // @traces 1362-FR-007
  it('merges nothing when head\'s statuses come back empty, rather than skipping the list check', () => {
    let threw = null;
    let calls = [];
    try {
      ({ calls } = run([[HEAD_STATUSES, { stdout: '' }]]));
    } catch (error) {
      threw = error;
    }
    assert.ok(threw || !calls.includes(MERGE), 'an unreadable statuses answer must stop before the merge');
  });
});
