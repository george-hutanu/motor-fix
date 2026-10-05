import { afterEach, describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gateEnv, runGates, step } from './lifecycle.mjs';

const root = join(import.meta.dirname, '..', '..');
const FEATURE = '696-lifecycle-script';
const BRANCH = FEATURE;
const TITLE = 'chore(harness): ST-696 lifecycle steps as one script call each';
const STORY_URL = 'https://app.notion.com/p/3f0607bff0d2812e96e9c2882339f2bd';
const PR_URL = 'https://github.com/george-hutanu/motor-fix/pull/141';

let repo;
let featureDir;

function fixture({ notionScript = true } = {}) {
  repo = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), `# Spec\n\n**Notion story**: ST-696, ${STORY_URL} (Task)\n`);
  writeFileSync(join(featureDir, 'notion-sync.md'), `# Notion sync — ${FEATURE}\n\n- 2026-10-05 · start · ST-696 · To do → Planning\n`);
  writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## Why\n\n_(fill in: why)_\n\n## Notion story\n\n_(fill in: the story link)_\n\n## Spec folder\n\n_(fill in: specs/NNN-slug)_\n');
  if (notionScript) writeFileSync(join(repo, '.claude', 'scripts', 'notion-sync.mjs'), '// stub\n');
}

/**
 * Stubbed git, gh, gates and Notion CLI. `answers` maps a command prefix to a
 * result; the first prefix that matches wins. Every call and gate is recorded.
 */
function harness({ branch = BRANCH, env = { GH_TOKEN: 'tok-george' }, answers = [], refuse = null } = {}) {
  const calls = [];
  const gated = [];
  const envs = [];
  const base = [
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${branch}\n` }],
    ['git rev-parse HEAD', { stdout: 'abcdef1234567890\n' }],
    ['gh auth token -u george-hutanu', { stdout: 'tok-from-gh\n' }],
    ['gh pr create', { stdout: `${PR_URL}\n` }],
    ['gh pr view --json number,state,url', { stdout: JSON.stringify({ number: 141, state: 'OPEN', url: PR_URL }) }],
    ['gh pr view 141 --json number,state,url', { stdout: JSON.stringify({ number: 141, state: 'OPEN', url: PR_URL }) }],
    ['gh pr view 141 --json mergeCommit', { stdout: 'feed1234beef\n' }],
    [`gh pr view ${branch} --json number,title,isDraft,url`, { stdout: JSON.stringify({ number: 141, title: TITLE, isDraft: true, url: PR_URL }) }],
    ['node .claude/scripts/notion-sync.mjs start', { stdout: '{"ready":{"review":["ST-30"]}}\n' }],
    ['node .claude/scripts/notion-sync.mjs finish', { stdout: '{"ready":{"review":["ST-31"]}}\n' }],
  ];
  const table = [...answers, ...base];
  const run = (file, args, opts = {}) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    envs.push({ cmd, env: opts.env });
    const hit = table.find(([prefix]) => cmd.startsWith(prefix));
    const out = typeof hit?.[1] === 'function' ? hit[1](cmd) : hit?.[1];
    return { code: 0, stdout: '', stderr: '', ...out };
  };
  const gate = (command) => {
    gated.push(command);
    if (refuse && command.startsWith(refuse.prefix)) return { code: 2, stderr: refuse.message };
    return { code: 0, stderr: '' };
  };
  return { io: { repo, env, run, gate }, calls, gated, envs };
}

const ofTool = (calls) => calls.filter((c) => !c.startsWith('gh auth token'));

describe('open', () => {
  beforeEach(() => fixture());

  it('makes the start commit, pushes, opens the labelled draft, then runs Notion start and pr', () => {
    const h = harness({ answers: [['git rev-list --count origin/main..HEAD', { stdout: '0\n' }], ['gh pr list', { stdout: '\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pr, 141);
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.equal(calls.length, 8, calls.join('\n'));
    assert.equal(calls[0], 'git rev-list --count origin/main..HEAD');
    assert.equal(calls[1], 'git commit --allow-empty -m chore(harness): ST-696 start lifecycle steps as one script call each');
    assert.equal(calls[2], `git push -u origin ${BRANCH}`);
    assert.match(calls[3], new RegExp(`^gh pr list --head ${BRANCH} --state open`));
    assert.equal(calls[4], 'gh label create scope: harness --force');
    assert.match(calls[5], /^gh pr create --draft --base main --head 696-lifecycle-script --title chore\(harness\): ST-696 lifecycle steps as one script call each --body-file \S+ --label planning --label tooling --label scope: harness$/);
    assert.equal(calls[6], 'node .claude/scripts/notion-sync.mjs start --pr 141');
    assert.equal(calls[7], 'node .claude/scripts/notion-sync.mjs pr 141');
    assert.deepEqual(result.review, ['ST-30']);
  });

  it('opens the draft from the PR template with the story and spec folder filled in', () => {
    let body = '';
    const h = harness({
      answers: [
        ['git rev-list', { stdout: '0\n' }],
        ['gh pr list', { stdout: '' }],
        ['gh pr create', (cmd) => { body = readFileSync(cmd.match(/--body-file (\S+)/)[1], 'utf8'); return { stdout: `${PR_URL}\n` }; }],
      ],
    });
    step(['open', '--title', TITLE], h.io);
    assert.match(body, /## Why/);
    assert.ok(body.includes(STORY_URL), body);
    assert.ok(body.includes(`specs/${FEATURE}`), body);
  });

  it('adds breaking for a title with ! and the type label from the title', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '2\n' }], ['gh pr list', { stdout: '' }]] });
    step(['open', '--title', 'feat(api)!: ST-696 change the contract'], h.io);
    const create = h.calls.find((c) => c.startsWith('gh pr create'));
    assert.match(create, /--label planning --label feature --label breaking --label scope: api$/);
  });

  it('a second open makes no commit, opens no second PR, and still pushes and links', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '3\n' }], ['gh pr list', { stdout: '141\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.some((c) => c.startsWith('git commit')));
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr create')));
    assert.ok(h.calls.includes(`git push -u origin ${BRANCH}`));
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs pr 141'));
  });

  it('stops at Notion exit 3 and lists the connector events left and the rerun', () => {
    const h = harness({
      answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }], ['node .claude/scripts/notion-sync.mjs start', { code: 3, stdout: 'notion-sync: no NOTION_TOKEN, use the connector\n' }]],
    });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-notion-sync start', 'speckit-notion-sync pr 141']);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs open --title "${TITLE}" --notion-done`);
    assert.equal(h.calls.at(-1), 'node .claude/scripts/notion-sync.mjs start --pr 141');
  });

  it('treats a missing notion-sync.mjs like no token', () => {
    fixture({ notionScript: false });
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-notion-sync start', 'speckit-notion-sync pr 141']);
    assert.ok(!h.calls.some((c) => c.startsWith('node .claude/scripts/notion-sync.mjs')));
  });

  it('--notion-done skips the Notion events', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }]] });
    const result = step(['open', '--title', TITLE, '--notion-done'], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.some((c) => c.includes('notion-sync')));
  });

  it('stops at a failed push and runs nothing after it', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['git push', { code: 1, stderr: 'rejected: non-fast-forward' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, `git push -u origin ${BRANCH}`);
    assert.match(result.fix, /non-fast-forward/);
    assert.equal(h.calls.at(-1), `git push -u origin ${BRANCH}`);
  });
});

describe('ready', () => {
  let body;
  beforeEach(() => {
    fixture();
    body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n\nfilled\n');
  });

  const staged = (codes) => {
    let i = 0;
    return ['git diff --cached --quiet', () => ({ code: codes[i++] ?? 0 })];
  };

  it('commits the records, checks and publishes the body, marks ready, runs qa, commits the qa line, writes handoff.md', () => {
    const h = harness({ answers: [staged([1, 1])] });
    const result = step(['ready', '--body-file', body, '--decisions', 'none'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.deepEqual(calls, [
      `gh pr view ${BRANCH} --json number,title,isDraft,url`,
      `git add -- specs/${FEATURE}`,
      'git diff --cached --quiet',
      'git commit -m chore(specs): ST-696 feature records',
      `git push -u origin ${BRANCH}`,
      `node scripts/pr-body-check.ts --body-file ${body} --title ${TITLE}`,
      `gh pr edit 141 --body-file ${body}`,
      'gh pr ready 141',
      'node .claude/scripts/notion-sync.mjs qa --pr 141',
      `git add -- specs/${FEATURE}/notion-sync.md`,
      'git diff --cached --quiet',
      'git commit -m chore(specs): ST-696 qa',
      `git push -u origin ${BRANCH}`,
    ]);
    const note = readFileSync(join(featureDir, 'handoff.md'), 'utf8');
    assert.match(note, /PR: #141 https:\/\/github.com\/george-hutanu\/motor-fix\/pull\/141 · branch 696-lifecycle-script · worktree \S+ · head abcdef1234567890/);
    assert.match(note, /story 3f0607bff0d2812e96e9c2882339f2bd/);
    assert.match(note, /Open decisions: none/);
  });

  it('includes .specify/capabilities in the records when it exists, and makes no commit when nothing changed', () => {
    mkdirSync(join(repo, '.specify', 'capabilities'));
    const h = harness({ answers: [staged([0, 0])] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`git add -- specs/${FEATURE} .specify/capabilities`));
    assert.ok(!h.calls.some((c) => c.startsWith('git commit')));
  });

  it('files unfiled deferred bullets through Notion debt before the records commit', () => {
    writeFileSync(join(featureDir, 'deferred.md'), '# Deferred\n\n- MEDIUM: tidy `x.mjs` (code-reviewer)\n');
    const h = harness({ answers: [staged([1, 1])] });
    step(['ready', '--body-file', body], h.io);
    const debt = h.calls.indexOf('node .claude/scripts/notion-sync.mjs debt --pr 141');
    assert.ok(debt > -1, h.calls.join('\n'));
    assert.ok(debt < h.calls.indexOf(`git add -- specs/${FEATURE}`));
  });

  it('stops when the body check fails: no edit, no ready, the checker says why', () => {
    const h = harness({ answers: [staged([1]), ['node scripts/pr-body-check.ts', { code: 1, stderr: 'Missing: How it was tested\n' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'pr-body-check');
    assert.match(result.fix, /How it was tested/);
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr edit') || c.startsWith('gh pr ready')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
  });

  it('does not run gh pr ready on a PR that is already ready', () => {
    const h = harness({ answers: [staged([0, 0]), [`gh pr view ${BRANCH}`, { stdout: JSON.stringify({ number: 141, title: TITLE, isDraft: false, url: PR_URL }) }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.includes('gh pr ready 141'));
  });

  it('stops at Notion exit 3 with the qa event left and the rerun', () => {
    const h = harness({ answers: [staged([0]), ['node .claude/scripts/notion-sync.mjs qa', { code: 3, stdout: 'notion-sync: no NOTION_TOKEN, use the connector\n' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-notion-sync qa']);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs ready --body-file ${body} --notion-done`);
    assert.equal(h.calls.at(-1), 'node .claude/scripts/notion-sync.mjs qa --pr 141');
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
  });

  it('stops when the branch has no PR', () => {
    const h = harness({ answers: [[`gh pr view ${BRANCH}`, { code: 1, stderr: 'no pull requests found' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /lifecycle\.mjs open/);
  });
});

describe('merge', () => {
  beforeEach(() => {
    fixture();
    writeFileSync(join(featureDir, 'handoff.md'), '# Hand-off\n');
  });

  const diff = ['git diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n+- 2026-10-05 · ready · Foundations · no change\n' }];

  it('merges, runs finish with the absolute finish-comment path, comments once, restores the log, deletes handoff.md', () => {
    writeFileSync(join(featureDir, 'finish-comment.md'), '**Decisions**\n- one\n');
    let comment = '';
    const h = harness({ answers: [diff, ['gh pr comment', (cmd) => { comment = readFileSync(cmd.match(/--body-file (\S+)/)[1], 'utf8'); return {}; }]] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.equal(calls[0], 'gh pr view --json number,state,url');
    assert.equal(calls[1], 'gh pr merge 141 --merge');
    assert.equal(calls[2], 'gh pr view 141 --json mergeCommit --jq .mergeCommit.oid');
    assert.equal(calls[3], `node .claude/scripts/notion-sync.mjs finish --pr 141 --body-file ${join(featureDir, 'finish-comment.md')}`);
    assert.equal(calls[4], `git diff -U0 -- specs/${FEATURE}/notion-sync.md`);
    assert.equal(calls[5], `git checkout -- specs/${FEATURE}/notion-sync.md`);
    assert.match(calls[6], /^gh pr comment 141 --body-file \S+$/);
    assert.equal(calls.length, 7);
    assert.match(comment, /^## Finish log/);
    assert.match(comment, /feed1234beef/);
    assert.match(comment, /- one/);
    assert.match(comment, /finish · ST-696 · QA → Done/);
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
    assert.deepEqual(result.review, ['ST-31']);
  });

  it('passes --no-comment when there is no finish-comment.md', () => {
    const h = harness({ answers: [diff] });
    step(['merge'], h.io);
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs finish --pr 141 --no-comment'));
  });

  it('refuses exactly when the merge gate does, prints its refusal, and runs nothing after it', () => {
    const message = 'Merge gate (Constitution VII): PR #141 cannot merge: no agent-review success on abc1234.';
    const h = harness({ refuse: { prefix: 'gh pr merge', message } });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'gate: gh pr merge 141 --merge');
    assert.equal(result.fix, message);
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr merge')));
    assert.equal(h.calls.at(-1), 'gh pr view --json number,state,url');
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });

  it('skips the merge on a PR already merged and finishes the rest', () => {
    const h = harness({ answers: [diff, ['gh pr view --json number,state,url', { stdout: JSON.stringify({ number: 141, state: 'MERGED', url: PR_URL }) }]] });
    const result = step(['merge', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr merge')));
    assert.ok(!h.calls.some((c) => c.includes('notion-sync.mjs')));
    assert.ok(h.calls.some((c) => c.startsWith('gh pr comment 141')));
  });

  it('stops at Notion exit 3 after the merge with finish left and the rerun', () => {
    const h = harness({ answers: [['node .claude/scripts/notion-sync.mjs finish', { code: 3, stdout: 'notion-sync: no NOTION_TOKEN, use the connector\n' }]] });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-notion-sync finish']);
    assert.equal(result.then, 'node .claude/scripts/lifecycle.mjs merge --pr 141 --notion-done');
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr comment')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });
});

describe('gates, main and identity', () => {
  beforeEach(() => fixture());

  it('judges every git and gh command with the gates before it runs, in the same order', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '0\n' }], ['gh pr list', { stdout: '' }]] });
    step(['open', '--title', TITLE], h.io);
    const tools = h.calls.filter((c) => /^(git|gh) /.test(c) && !c.startsWith('gh auth token'));
    assert.equal(h.gated.length, tools.length);
    h.gated.forEach((command, i) => assert.equal(command.replace(/"/g, ''), tools[i]));
  });

  it('a gate refusal stops the step before the command runs', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }]], refuse: { prefix: 'git push', message: 'Bash guard: pushing to main is blocked' } });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.fix, 'Bash guard: pushing to main is blocked');
    assert.ok(!h.calls.some((c) => c.startsWith('git push')));
  });

  for (const name of ['open', 'ready', 'merge']) {
    it(`${name} on main runs nothing and pushes nothing`, () => {
      const h = harness({ branch: 'main' });
      const result = step([name, '--title', TITLE, '--body-file', 'b.md'], h.io);
      assert.equal(result.ok, false);
      assert.match(result.stopped, /main/);
      assert.deepEqual(h.calls, ['git rev-parse --abbrev-ref HEAD']);
    });
  }

  it('never pushes to main or with force in any step', () => {
    for (const argv of [['open', '--title', TITLE], ['ready', '--body-file', join(repo, 'b.md')], ['merge']]) {
      writeFileSync(join(repo, 'b.md'), 'x');
      const h = harness({ answers: [['git rev-list', { stdout: '0\n' }], ['gh pr list', { stdout: '' }], ['git diff --cached --quiet', { code: 1 }]] });
      step(argv, h.io);
      for (const push of h.calls.filter((c) => c.startsWith('git push'))) assert.equal(push, `git push -u origin ${BRANCH}`);
    }
  });

  it('runs gh with the caller GH_TOKEN, or george-hutanu\'s token when unset', () => {
    const own = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }]] });
    step(['open', '--title', TITLE, '--notion-done'], own.io);
    assert.ok(own.envs.filter((e) => e.cmd.startsWith('gh ')).every((e) => e.env.GH_TOKEN === 'tok-george'));
    assert.ok(!own.calls.includes('gh auth token -u george-hutanu'));

    const none = harness({ env: {}, answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }]] });
    step(['open', '--title', TITLE, '--notion-done'], none.io);
    assert.equal(none.calls[0], 'gh auth token -u george-hutanu');
    assert.ok(none.envs.filter((e) => e.cmd.startsWith('gh ') && !e.cmd.startsWith('gh auth')).every((e) => e.env.GH_TOKEN === 'tok-from-gh'));
  });

  it('strips the merge gate\'s test-only state from the gates\' environment', () => {
    const env = gateEnv({ PATH: '/bin', SPECKIT_PR_STATE: '{}', SPECKIT_CARRY_STATE: '{}', GH_TOKEN: 't' }, '/repo');
    assert.equal(env.SPECKIT_PR_STATE, undefined);
    assert.equal(env.SPECKIT_CARRY_STATE, undefined);
    assert.equal(env.GH_TOKEN, 't');
    assert.equal(env.CLAUDE_PROJECT_DIR, '/repo');
  });

  it('runs the Bash gates registered in settings.json: the real bash guard refuses a force-push', () => {
    const refused = runGates(root, 'git push --force origin 696-lifecycle-script', { PATH: process.env.PATH });
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /force-push blocked/);
    const passed = runGates(root, 'git status', { PATH: process.env.PATH });
    assert.equal(passed.code, 0);
  });

  it('prints one usage line for an unknown step', () => {
    const h = harness();
    const result = step(['deploy'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /open \| ready \| merge/);
  });
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('temp files, the token stop, reruns and the finish order', () => {
  beforeEach(() => fixture());

  it('removes the temp files when gh pr create or gh pr comment fails', () => {
    let body = '';
    const o = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '' }], ['gh pr create', (cmd) => { body = cmd.match(/--body-file (\S+)/)[1]; return { code: 1, stderr: 'boom' }; }]] });
    assert.equal(step(['open', '--title', TITLE], o.io).ok, false);
    assert.ok(body && !existsSync(body), body);
    let finish = '';
    const m = harness({ answers: [['gh pr comment', (cmd) => { finish = cmd.match(/--body-file (\S+)/)[1]; return { code: 1, stderr: 'boom' }; }]] });
    assert.equal(step(['merge', '--pr', '141'], m.io).ok, false);
    assert.ok(finish && !existsSync(finish), finish);
  });

  it('keeps the finish comment and names the command that posts it when the comment fails', () => {
    writeFileSync(join(featureDir, 'handoff.md'), 'note\n');
    const h = harness({ answers: [['git diff -U0', { stdout: '+- 2026-10-05 · finish · ST-696 · QA → Done\n' }], ['gh pr comment', { code: 1, stderr: 'HTTP 502' }]] });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.match(readFileSync(result.comment, 'utf8'), /finish · ST-696 · QA → Done/);
    assert.equal(result.then, `gh pr comment 141 --body-file ${result.comment} && rm -f ${join(featureDir, 'handoff.md')}`);
    assert.ok(existsSync(join(featureDir, 'handoff.md')));
    rmSync(result.comment, { force: true });
  });

  it('ready takes the commit ST from the PR title', () => {
    const body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n');
    let i = 0;
    const h = harness({
      answers: [
        ['git diff --cached --quiet', () => ({ code: i++ === 0 ? 1 : 0 })],
        [`gh pr view ${BRANCH} --json`, { stdout: JSON.stringify({ number: 141, title: 'fix(web): ST-702 a fix', isDraft: true, url: PR_URL }) }],
      ],
    });
    step(['ready', '--body-file', body], h.io);
    assert.ok(h.calls.includes('git commit -m chore(specs): ST-702 feature records'), h.calls.join('\n'));
  });

  it('removes the draft body temp file after gh pr create', () => {
    let file = '';
    const h = harness({
      answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '' }], ['gh pr create', (cmd) => { file = cmd.match(/--body-file (\S+)/)[1]; return { stdout: `${PR_URL}\n` }; }]],
    });
    assert.equal(step(['open', '--title', TITLE], h.io).ok, true);
    assert.ok(file && !existsSync(file), file);
  });

  it('removes the finish comment temp file after gh pr comment', () => {
    let file = '';
    const h = harness({ answers: [['gh pr comment', (cmd) => { file = cmd.match(/--body-file (\S+)/)[1]; return {}; }]] });
    assert.equal(step(['merge', '--pr', '141'], h.io).ok, true);
    assert.ok(file && !existsSync(file), file);
  });

  it('stops when gh auth token fails or prints nothing, before any git or gh call', () => {
    for (const answer of [{ code: 1, stderr: 'no account' }, { stdout: '\n' }]) {
      const h = harness({ env: {}, answers: [['gh auth token -u george-hutanu', answer]] });
      const result = step(['open', '--title', TITLE], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, 'gh auth token -u george-hutanu');
      assert.deepEqual(h.calls, ['gh auth token -u george-hutanu']);
    }
  });

  it('carries --decisions into the ready rerun', () => {
    const body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n');
    const h = harness({ answers: [['node .claude/scripts/notion-sync.mjs qa', { code: 3 }]] });
    const result = step(['ready', '--body-file', body, '--decisions', 'keep "x" as is'], h.io);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs ready --body-file ${body} --decisions "keep \\"x\\" as is" --notion-done`);
  });

  it('quotes the title and the body path in the reruns', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }], ['node .claude/scripts/notion-sync.mjs start', { code: 3 }]] });
    const title = 'feat(api): ST-696 a $HOME `x` "y"';
    assert.equal(step(['open', '--title', title], h.io).then, 'node .claude/scripts/lifecycle.mjs open --title "feat(api): ST-696 a \\$HOME \\`x\\` \\"y\\"" --notion-done');
    const spaced = join(repo, 'my body.md');
    writeFileSync(spaced, '## Why\n');
    const r = harness({ answers: [['node .claude/scripts/notion-sync.mjs qa', { code: 3 }]] });
    assert.equal(step(['ready', '--body-file', spaced], r.io).then, `node .claude/scripts/lifecycle.mjs ready --body-file "${spaced}" --notion-done`);
  });

  it('takes the start commit ST from the title when it has one', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '0\n' }], ['gh pr list', { stdout: '141\n' }]] });
    step(['open', '--title', 'fix(web): ST-701 a fix', '--notion-done'], h.io);
    assert.ok(h.calls.includes('git commit --allow-empty -m chore(web): ST-701 start a fix'), h.calls.join('\n'));
  });

  it('stops when gh pr create prints no PR URL', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '' }], ['gh pr create', { stdout: 'something else\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.match(result.stopped, /^gh pr create/);
    assert.ok(!h.calls.some((c) => c.includes('notion-sync')));
  });

  it('restores the log before posting the finish comment', () => {
    const h = harness();
    step(['merge', '--pr', '141'], h.io);
    const restore = h.calls.findIndex((c) => c.startsWith('git checkout --'));
    const comment = h.calls.findIndex((c) => c.startsWith('gh pr comment'));
    assert.ok(restore > -1 && restore < comment, h.calls.join('\n'));
  });
});
