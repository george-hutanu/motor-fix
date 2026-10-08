import { afterEach, describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
    assert.equal(calls[6], 'node .claude/scripts/notion-sync.mjs start --pr 141 --story ST-696');
    assert.equal(calls[7], 'node .claude/scripts/notion-sync.mjs pr 141 --story ST-696');
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
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs pr 141 --story ST-696'));
  });

  it('stops at Notion exit 3 and lists the connector events left and the rerun', () => {
    const h = harness({
      answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }], ['node .claude/scripts/notion-sync.mjs start', { code: 3, stdout: 'notion-sync: no NOTION_TOKEN, use the connector\n' }]],
    });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-notion-sync start', 'speckit-notion-sync pr 141']);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs open --title "${TITLE}" --notion-done`);
    assert.equal(h.calls.at(-1), 'node .claude/scripts/notion-sync.mjs start --pr 141 --story ST-696');
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

  it("points a feature.json left on the last feature at this branch's spec folder before anything runs", () => {
    mkdirSync(join(repo, 'specs', '685-news-relay'), { recursive: true });
    writeFileSync(join(repo, 'specs', '685-news-relay', 'spec.md'), '# Spec\n');
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ level: 2, feature_directory: 'specs/685-news-relay' }));
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '141\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(JSON.parse(readFileSync(join(repo, '.specify', 'feature.json'), 'utf8')).feature_directory, `specs/${FEATURE}`);
    assert.equal(result.did[0], `feature.json → specs/${FEATURE}`);
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs start --pr 141 --story ST-696'), h.calls.join('\n'));
  });

  it('stops with a fix, not a stack, on a malformed feature.json', () => {
    writeFileSync(join(repo, '.specify', 'feature.json'), '{not json');
    const h = harness();
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'no feature');
    assert.ok(!h.calls.some((c) => c.startsWith('git push')));
  });

  it('stops, writing nothing, when SPECIFY_FEATURE_DIRECTORY names another feature', () => {
    mkdirSync(join(repo, 'specs', '685-news-relay'), { recursive: true });
    writeFileSync(join(repo, 'specs', '685-news-relay', 'spec.md'), '# Spec\n');
    const before = readFileSync(join(repo, '.specify', 'feature.json'), 'utf8');
    process.env.SPECIFY_FEATURE_DIRECTORY = join(repo, 'specs', '685-news-relay');
    try {
      const h = harness();
      const result = step(['open', '--title', TITLE], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, 'feature');
      assert.match(result.fix, /SPECIFY_FEATURE_DIRECTORY/);
      assert.equal(readFileSync(join(repo, '.specify', 'feature.json'), 'utf8'), before);
      assert.ok(!h.calls.some((c) => c.startsWith('git push')));
    } finally {
      delete process.env.SPECIFY_FEATURE_DIRECTORY;
    }
  });

  it('stops before any push when the branch has no spec folder of its own', () => {
    const h = harness({ branch: '700-no-spec' });
    const result = step(['open', '--title', 'chore(harness): ST-700 something'], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'feature');
    assert.match(result.fix, /specs\/696-lifecycle-script/);
    assert.match(result.fix, /specs\/700-no-spec/);
    assert.ok(!h.calls.some((c) => c.startsWith('git push') || c.startsWith('gh pr')), h.calls.join('\n'));
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

  // @traces 815-FR-004
  it('commits the records and the qa line to the specs repository, checks and publishes the body, marks ready, runs qa, writes handoff.md and, off the cloud, posts nothing', () => {
    const h = harness({ answers: [staged([1, 1])] });
    const result = step(['ready', '--body-file', body, '--decisions', 'none'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.deepEqual(calls, [
      `gh pr view ${BRANCH} --json number,title,isDraft,url`,
      'node .claude/scripts/level.mjs check --ready --json',
      `node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 feature records -- ${FEATURE}`,
      `node scripts/pr-body-check.ts --body-file ${body} --title ${TITLE}`,
      `gh pr edit 141 --body-file ${body}`,
      'gh pr ready 141',
      'node .claude/scripts/notion-sync.mjs qa --pr 141 --story ST-696',
      `node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 qa -- ${FEATURE}/notion-sync.md`,
    ]);
    const note = readFileSync(join(featureDir, 'handoff.md'), 'utf8');
    assert.match(note, /PR: #141 https:\/\/github.com\/george-hutanu\/motor-fix\/pull\/141 · branch 696-lifecycle-script · worktree \S+ · head abcdef1234567890/);
    assert.match(note, /story 3f0607bff0d2812e96e9c2882339f2bd/);
    assert.match(note, /Open decisions: none/);
    assert.ok(result.did.includes('handoff comment skipped (not a cloud session)'), JSON.stringify(result.did));
  });

  it('commits .specify/capabilities on the branch when it exists, and makes no commit when nothing changed', () => {
    mkdirSync(join(repo, '.specify', 'capabilities'));
    const h = harness({ answers: [staged([0, 0])] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes('git add -- .specify/capabilities'));
    assert.ok(!h.calls.some((c) => c.startsWith('git add') && c.includes('specs/')), h.calls.join('\n'));
    assert.ok(!h.calls.some((c) => c.startsWith('git commit')));
  });

  it('commits a changed .specify/capabilities on the branch and pushes it', () => {
    mkdirSync(join(repo, '.specify', 'capabilities'));
    const h = harness({ answers: [staged([1])] });
    assert.equal(step(['ready', '--body-file', body], h.io).ok, true);
    assert.ok(h.calls.includes('git commit -m chore(specs): ST-696 capability records'), h.calls.join('\n'));
    assert.ok(h.calls.includes(`git push -u origin ${BRANCH}`));
  });

  it('stops when the specs repository refuses the records commit, naming its error, before the PR goes ready', () => {
    const h = harness({ answers: [['node .claude/scripts/specs-repo.mjs commit', { code: 1, stdout: '{"ok":false,"error":"specs/ is not a clone of motor-fix-specs: run node .claude/scripts/specs-repo.mjs ensure"}\n' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /specs-repo\.mjs ensure/);
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr ready')));
  });

  it('files unfiled deferred bullets through Notion debt before the records commit', () => {
    writeFileSync(join(featureDir, 'deferred.md'), '# Deferred\n\n- MEDIUM: tidy `x.mjs` (code-reviewer)\n');
    const h = harness({ answers: [staged([1, 1])] });
    step(['ready', '--body-file', body], h.io);
    const debt = h.calls.indexOf('node .claude/scripts/notion-sync.mjs debt --pr 141 --story ST-696');
    assert.ok(debt > -1, h.calls.join('\n'));
    assert.ok(debt < h.calls.indexOf(`${'node .claude/scripts/specs-repo.mjs commit'} chore(specs): ST-696 feature records -- ${FEATURE}`));
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
    assert.equal(h.calls.at(-1), 'node .claude/scripts/notion-sync.mjs qa --pr 141 --story ST-696');
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
  });

  it('runs the level check before the records commit and stops on its refusal, the PR still a draft', () => {
    const h = harness({
      answers: [staged([1, 1]), ['node .claude/scripts/level.mjs check', { code: 2, stdout: '{"missing":["plan.md"]}\n', stderr: 'level check: not ready — level 2 is missing plan.md\n' }]],
    });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'level check');
    assert.match(result.fix, /plan\.md/);
    assert.ok(!h.calls.some((c) => c.includes('specs-repo.mjs commit') || c.startsWith('gh pr edit') || c.startsWith('gh pr ready')), h.calls.join('\n'));
  });

  it('passes through a level check that answers 0', () => {
    const h = harness({ answers: [staged([1, 1])] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const check = h.calls.indexOf('node .claude/scripts/level.mjs check --ready --json');
    assert.ok(check > -1, h.calls.join('\n'));
    assert.ok(check < h.calls.findIndex((c) => c.includes('specs-repo.mjs commit')));
  });

  it('stops when the branch has no PR', () => {
    const h = harness({ answers: [[`gh pr view ${BRANCH}`, { code: 1, stderr: 'no pull requests found' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /lifecycle\.mjs open/);
  });
});

// @traces 749-FR-002 749-FR-003
describe('handoff: the note survives a fresh VM as a marked PR comment', () => {
  const MARK = '<!-- speckit-handoff -->';
  const note = () => join(featureDir, 'handoff.md');
  const comments = (...bodies) => ['gh pr view 141 --json comments', { stdout: JSON.stringify({ comments: bodies.map((body, i) => ({ body, createdAt: `2026-10-06T10:0${i}:00Z` })) }) }];
  beforeEach(() => fixture());

  const CLOUD = { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' };
  // A cloud session's gh goes over REST: answer the pull lookups, and send each
  // POST to issues/141/comments (its JSON body on stdin) to `post`.
  const cloudGh = (h, post) => {
    const run = h.io.run;
    h.io.run = (file, args, opts = {}) => {
      const cmd = [file, ...args].join(' ');
      if (cmd.includes('issues/141/comments -X POST')) {
        h.calls.push(cmd);
        return { code: 0, stdout: '{}', stderr: '', ...post(JSON.parse(opts.input).body) };
      }
      if (cmd.includes('pulls?head=')) return { code: 0, stdout: JSON.stringify([[{ number: 141, state: 'open' }]]), stderr: '' };
      if (/pulls\/141 -X GET/.test(cmd)) return { code: 0, stdout: JSON.stringify({ number: 141, title: TITLE, draft: true, state: 'open', html_url: PR_URL, node_id: 'PR_1' }), stderr: '' };
      return run(file, args, opts);
    };
    return h;
  };

  it('posts the current note, marker first, on the PR in a cloud session', () => {
    writeFileSync(note(), '# Hand-off\n- QA run: 9 · head abc · lap 2 · url\n');
    const posted = [];
    const h = cloudGh(harness({ env: CLOUD }), (b) => (posted.push(b), {}));
    const result = step(['handoff', '--pr', '141'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(posted, [`${MARK}\n# Hand-off\n- QA run: 9 · head abc · lap 2 · url\n`]);
  });

  it('posts nothing off the cloud: the worktree keeps the note', () => {
    writeFileSync(note(), '# Hand-off\n');
    const h = harness();
    const result = step(['handoff', '--pr', '141'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.includes('comment')), JSON.stringify(h.calls));
    assert.ok(result.did.includes('handoff comment skipped (not a cloud session)'));
  });

  it('a ready whose comment fails keeps the note and names only the re-post as the fix', () => {
    const posted = [];
    const h = cloudGh(harness({ env: CLOUD, answers: [['git diff --cached --quiet', { code: 0 }]] }), (b) => (posted.push(b), { code: 1, stderr: 'HTTP 502' }));
    writeFileSync(join(repo, 'body.md'), '## Why\n\nfilled\n');
    const result = step(['ready', '--body-file', join(repo, 'body.md')], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(posted, [`${MARK}\n${readFileSync(note(), 'utf8')}`]);
    assert.ok(existsSync(note()));
    assert.match(result.fix, /lifecycle\.mjs handoff --pr 141/);
    assert.match(result.fix, /HTTP 502/);
  });

  it('finds the PR from the branch when --pr is not given', () => {
    writeFileSync(note(), '# Hand-off\n');
    const h = harness({ answers: [[`gh pr view ${BRANCH} --json number`, { stdout: '{"number":141}' }]] });
    const result = step(['handoff'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pr, 141);
  });

  it('refuses to post when there is no note, and posts nothing', () => {
    const h = harness();
    const result = step(['handoff', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /handoff\.md/);
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr comment')));
  });

  it('--restore writes a missing note from the newest marked comment', () => {
    const h = harness({ answers: [comments(`${MARK}\n# Hand-off\n- QA run: 1\n`, 'looks good', `${MARK}\r\n# Hand-off\n- QA run: 2\n`, 'later chatter')] });
    const result = step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readFileSync(note(), 'utf8'), '# Hand-off\n- QA run: 2\n');
  });

  it('--restore orders by creation time, not by list position', () => {
    const h = harness({
      answers: [['gh pr view 141 --json comments', { stdout: JSON.stringify({ comments: [
        { body: `${MARK}\nnewer\n`, createdAt: '2026-10-06T12:00:00Z' },
        { body: `${MARK}\nolder\n`, createdAt: '2026-10-06T09:00:00Z' },
      ] }) }]],
    });
    step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(readFileSync(note(), 'utf8'), 'newer\n');
  });

  it('--restore ignores a comment that only quotes the marker mid-text', () => {
    const h = harness({ answers: [comments(`${MARK}\nreal\n`, `see the ${MARK} above\nfake\n`)] });
    step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(readFileSync(note(), 'utf8'), 'real\n');
  });

  it('--restore keeps an existing note and fetches nothing', () => {
    writeFileSync(note(), 'local\n');
    const h = harness({ answers: [comments(`${MARK}\nremote\n`)] });
    const result = step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(result.ok, true);
    assert.equal(readFileSync(note(), 'utf8'), 'local\n');
    assert.ok(!h.calls.some((c) => c.includes('--json comments')));
  });

  it('--restore with no marked comment stops, names the fix and writes nothing', () => {
    const h = harness({ answers: [comments('just a comment')] });
    const result = step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /no recorded QA run/);
    assert.equal(existsSync(note()), false);
  });
});

describe('merge', () => {
  beforeEach(() => {
    fixture();
    writeFileSync(join(featureDir, 'handoff.md'), '# Hand-off\n');
  });

  const diff = ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n+- 2026-10-05 · ready · Foundations · no change\n' }];

  it('merges, runs finish with the absolute finish-comment path, commits the log to the specs repository, comments once, deletes handoff.md', () => {
    writeFileSync(join(featureDir, 'finish-comment.md'), '**Decisions**\n- one\n');
    let comment = '';
    const h = harness({ answers: [diff, ['gh pr comment', (cmd) => { comment = readFileSync(cmd.match(/--body-file (\S+)/)[1], 'utf8'); return {}; }]] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.equal(calls[0], 'gh pr view --json number,state,url,title,headRefName');
    assert.equal(calls[1], 'gh pr merge 141 --merge');
    assert.equal(calls[2], 'gh pr view 141 --json mergeCommit --jq .mergeCommit.oid');
    assert.equal(calls[3], 'git worktree list --porcelain');
    assert.equal(calls[4], `node scripts/test-services.ts down ${repo}`);
    assert.equal(calls[5], `node .claude/scripts/notion-sync.mjs finish --pr 141 --body-file ${join(featureDir, 'finish-comment.md')} --story ST-696`);
    assert.equal(calls[6], `git -C specs diff -U0 -- ${FEATURE}/notion-sync.md`);
    assert.equal(calls[7], `node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 finish -- ${FEATURE}/notion-sync.md`);
    assert.match(calls[8], /^gh pr comment 141 --body-file \S+$/);
    assert.equal(calls.length, 9);
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
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs finish --pr 141 --no-comment --story ST-696'));
  });

  it('refuses exactly when the merge gate does, prints its refusal, and runs nothing after it', () => {
    const message = 'Merge gate (Constitution VII): PR #141 cannot merge: no agent-review success on abc1234.';
    const h = harness({ refuse: { prefix: 'gh pr merge', message } });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'gate: gh pr merge 141 --merge');
    assert.equal(result.fix, message);
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr merge')));
    assert.equal(h.calls.at(-1), 'gh pr view --json number,state,url,title,headRefName');
    assert.ok(!h.calls.some((c) => c.includes('test-services')), 'no stack is stopped for a PR that did not merge');
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });

  it('skips the merge on a PR already merged and finishes the rest', () => {
    const h = harness({ answers: [diff, ['gh pr view --json number,state,url', { stdout: JSON.stringify({ number: 141, state: 'MERGED', url: PR_URL }) }]] });
    const result = step(['merge', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr merge')));
    assert.ok(!h.calls.some((c) => c.includes('notion-sync.mjs')));
    assert.ok(h.calls.some((c) => c.startsWith('gh pr comment 141')));
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${repo}`), 'a rerun stops the stack again');
  });

  it('stops at Notion exit 3 after the merge with finish left and the rerun', () => {
    const h = harness({ answers: [['node .claude/scripts/notion-sync.mjs finish', { code: 3, stdout: 'notion-sync: no NOTION_TOKEN, use the connector\n' }]] });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-notion-sync finish']);
    assert.equal(result.then, 'node .claude/scripts/lifecycle.mjs merge --pr 141 --notion-done');
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${repo}`), 'the stack is stopped before the Notion finish can stop the step');
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr comment')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });
});

describe('merge stops the merged worktree test stack', () => {
  beforeEach(() => fixture());

  const diff = ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n' }];
  const WT = '/machine/motor-fix/.claude/worktrees/696-lifecycle-script';
  const viewHead = ['gh pr view --json number,state,url,title,headRefName', { stdout: JSON.stringify({ number: 141, state: 'OPEN', url: PR_URL, title: TITLE, headRefName: BRANCH }) }];
  const worktrees = ['git worktree list --porcelain', { stdout: `worktree /machine/motor-fix\nHEAD 1\nbranch refs/heads/main\n\nworktree ${WT}\nHEAD 2\nbranch refs/heads/${BRANCH}\n\nworktree /machine/motor-fix/.claude/worktrees/loose\nHEAD 3\ndetached\n` }];
  const down = (out) => ['node scripts/test-services.ts down', out];
  const stopped = { stdout: '{"project":"mf-test-696-lifecycle-script-abc123","stopped":true}\n' };

  it('stops the stack of the worktree carrying the PR head branch, before the Notion finish, and reports it', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, down(stopped)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const at = h.calls.indexOf(`node scripts/test-services.ts down ${WT}`);
    assert.ok(at > h.calls.indexOf('gh pr merge 141 --merge'), 'after the merge');
    assert.ok(at < h.calls.findIndex((c) => c.includes('notion-sync.mjs finish')), 'before the finish');
    assert.deepEqual(result.test_stack, { project: 'mf-test-696-lifecycle-script-abc123', stopped: true });
    assert.ok(result.did.includes('test stack mf-test-696-lifecycle-script-abc123 stopped'));
  });

  it('judges the worktree list with the gates like every other git command', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, down(stopped)] });
    step(['merge'], h.io);
    assert.ok(h.gated.some((c) => c.replace(/"/g, '') === 'git worktree list --porcelain'));
  });

  it('falls back to the checkout it runs in when no worktree carries the branch', () => {
    const h = harness({ answers: [diff, viewHead, ['git worktree list --porcelain', { stdout: 'worktree /machine/motor-fix\nHEAD 1\nbranch refs/heads/main\n' }], down(stopped)] });
    step(['merge'], h.io);
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${repo}`));
  });

  const finishesAnyway = (h, result) => {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.test_stack.stopped, false);
    assert.ok(h.calls.some((c) => c.includes('notion-sync.mjs finish')));
    assert.ok(h.calls.some((c) => c.startsWith('node .claude/scripts/specs-repo.mjs commit')));
    assert.ok(h.calls.some((c) => c.startsWith('gh pr comment 141')));
    assert.ok(result.did.some((d) => d.startsWith('test stack not stopped: ')), JSON.stringify(result.did));
  };

  it('finishes the merge when Docker is not there, with the reason', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, down({ stdout: '{"project":"mf-test-x","stopped":false,"reason":"docker unavailable"}\n' })] });
    const result = step(['merge'], h.io);
    finishesAnyway(h, result);
    assert.deepEqual(result.test_stack, { project: 'mf-test-x', stopped: false, reason: 'docker unavailable' });
  });

  it('finishes the merge when the stop exits non-zero', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, down({ code: 1, stderr: 'node: boom\n' })] });
    const result = step(['merge'], h.io);
    finishesAnyway(h, result);
    assert.match(result.test_stack.reason, /boom/);
  });

  it('finishes the merge when the stop prints nothing it can read', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, down({ stdout: 'garbage\n' })] });
    const result = step(['merge'], h.io);
    finishesAnyway(h, result);
  });

  it('finishes the merge when the stop throws', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, ['node scripts/test-services.ts down', () => { throw new Error('spawn node ENOENT'); }]] });
    const result = step(['merge'], h.io);
    finishesAnyway(h, result);
    assert.match(result.test_stack.reason, /ENOENT/);
  });

  it('finishes the merge when the worktree list cannot be read, stopping the stack of the checkout it runs in', () => {
    const h = harness({ answers: [diff, viewHead, ['git worktree list --porcelain', { code: 128, stderr: 'fatal' }], down(stopped)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${repo}`));
  });

  it('reads the head branch over REST in a cloud session', () => {
    const cloud = { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' };
    const rest = ['gh api repos/{owner}/{repo}/pulls/141 --jq', { stdout: `${JSON.stringify({ number: 141, state: 'MERGED', merge_commit_sha: 'feed1234beef', title: TITLE, head: BRANCH })}\n` }];
    const h = harness({ env: cloud, answers: [diff, rest, worktrees, down(stopped)] });
    const result = step(['merge', '--pr', '141', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.some((c) => c.startsWith('gh api repos/{owner}/{repo}/pulls/141 --jq') && c.includes('head: .head.ref')));
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${WT}`));
  });
});

describe('merge in a cloud session: REST only', () => {
  beforeEach(() => {
    fixture();
    writeFileSync(join(featureDir, 'handoff.md'), '# Hand-off\n');
  });

  const cloud = { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' };
  const diff = ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n' }];
  // What gh prints after lifecycle's --jq: the state MERGED once merged, else upper-cased.
  const restView = (pr) => ['gh api repos/{owner}/{repo}/pulls/141 --jq', { stdout: `${JSON.stringify(pr)}\n` }];
  const open = restView({ number: 141, state: 'OPEN', merge_commit_sha: null });
  const MERGE = 'gh api -X PUT repos/{owner}/{repo}/pulls/141/merge -f merge_method=merge';

  it('reads, merges, reads the merge commit and comments over REST, never through gh pr', () => {
    let merged = false;
    let comment = '';
    const h = harness({
      env: cloud,
      answers: [
        diff,
        ['gh api repos/{owner}/{repo}/pulls/141 --jq', () => ({ stdout: `${JSON.stringify({ number: 141, state: merged ? 'MERGED' : 'OPEN', merge_commit_sha: merged ? 'feed1234beef' : null })}\n` })],
        [MERGE, () => ((merged = true), {})],
        ['gh api -X POST repos/{owner}/{repo}/issues/141/comments', (cmd) => ((comment = readFileSync(cmd.match(/body=@(\S+)/)[1], 'utf8')), {})],
      ],
    });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.merged, 'feed123');
    assert.equal(h.calls.filter((c) => c.startsWith('gh pr ')).length, 0);
    assert.equal(h.calls.filter((c) => c === MERGE).length, 1);
    assert.ok(h.gated.some((c) => c.replace(/"/g, '') === MERGE), 'the merge gate judged the REST merge');
    assert.match(comment, /^## Finish log/);
    assert.match(comment, /Merged as feed1234beef/);
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
  });

  it('refuses exactly when the merge gate does, and merges nothing', () => {
    const message = 'Merge gate (Constitution VII): PR #141 cannot merge: agent-review is pending.';
    const h = harness({ env: cloud, answers: [open], refuse: { prefix: 'gh api -X PUT "repos/{owner}/{repo}/pulls/141/merge"', message } });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.fix, message);
    assert.ok(!h.calls.some((c) => c.startsWith('gh api -X PUT')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });

  it('skips the merge on a PR already merged', () => {
    const h = harness({ env: cloud, answers: [diff, restView({ number: 141, state: 'MERGED', merge_commit_sha: 'feed1234beef' })] });
    const result = step(['merge', '--pr', '141', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('gh api -X PUT')));
  });

  it('needs --pr: without GraphQL the branch cannot be resolved to its PR', () => {
    const h = harness({ env: cloud });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /--pr/);
    assert.ok(!h.calls.some((c) => c.startsWith('gh ')));
  });

  it('keeps the comment for a rerun over REST when posting it fails', () => {
    const h = harness({
      env: cloud,
      answers: [diff, restView({ number: 141, state: 'MERGED', merge_commit_sha: 'feed1234beef' }), ['gh api -X POST repos/{owner}/{repo}/issues/141/comments', { code: 1, stderr: 'HTTP 502' }]],
    });
    const result = step(['merge', '--pr', '141', '--notion-done'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.then, /^gh api -X POST "repos\/\{owner\}\/\{repo\}\/issues\/141\/comments" -F body=@\S+ && rm/);
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

  for (const argv of [['open', '--title', TITLE], ['ready', '--body-file', 'b.md'], ['merge', '--pr', '141']]) {
    it(`${argv[0]} on main runs nothing and pushes nothing`, () => {
      const h = harness({ branch: 'main' });
      const result = step(argv, h.io);
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
    assert.match(result.fix, /open \| ready \| merge \| handoff/);
  });

  it.each([
    ['merge', '--help', '--pr', '188'],
    ['merge', '-h'],
    ['open', '--title', TITLE, '--help'],
    ['handoff', '--help'],
  ])('answers %s %s with its usage and touches nothing', (...argv) => {
    const h = harness();
    const result = step(argv, h.io);
    assert.equal(result.ok, true);
    assert.equal(result.help, true);
    assert.match(result.usage, /usage: lifecycle\.mjs/);
    assert.deepEqual(h.calls, []);
  });

  it.each([
    [['merge', '--pr', '188', '--yes'], /unknown flag --yes for merge/],
    [['ready', '--body-file', 'b.md', '--pr', '9'], /unknown flag --pr for ready/],
    [['merge', '--restore'], /unknown flag --restore for merge/],
    [['merge', '188'], /unexpected argument 188/],
    [['merge', '--pr'], /--pr needs a value/],
    [['merge', '--pr', '--notion-done'], /--pr needs a value/],
  ])('refuses %j before it runs anything', (argv, why) => {
    const h = harness();
    const result = step(argv, h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'usage');
    assert.match(result.fix, why);
    assert.deepEqual(h.calls, []);
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
    const failed = step(['merge', '--pr', '141'], m.io);
    assert.equal(failed.ok, false);
    assert.ok(finish && !existsSync(finish), finish);
    rmSync(dirname(failed.comment), { recursive: true, force: true });
  });

  it('keeps the finish comment and names the command that posts it when the comment fails', () => {
    writeFileSync(join(featureDir, 'handoff.md'), 'note\n');
    const h = harness({ answers: [['git -C specs diff -U0', { stdout: '+- 2026-10-05 · finish · ST-696 · QA → Done\n' }], ['gh pr comment', { code: 1, stderr: 'HTTP 502' }]] });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.match(readFileSync(result.comment, 'utf8'), /finish · ST-696 · QA → Done/);
    assert.equal(result.then, `gh pr comment 141 --body-file ${result.comment} && rm -f ${join(featureDir, 'handoff.md')} && rm -rf ${dirname(result.comment)}`);
    assert.ok(existsSync(join(featureDir, 'handoff.md')));
    rmSync(dirname(result.comment), { recursive: true, force: true });
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
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-702 feature records -- ${FEATURE}`), h.calls.join('\n'));
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

  it('commits the log to the specs repository before posting the finish comment', () => {
    const h = harness();
    step(['merge', '--pr', '141'], h.io);
    const restore = h.calls.findIndex((c) => c.includes('specs-repo.mjs commit') && c.includes('finish'));
    const comment = h.calls.findIndex((c) => c.startsWith('gh pr comment'));
    assert.ok(restore > -1 && restore < comment, h.calls.join('\n'));
  });
});

describe('in a cloud session, where GitHub answers GraphQL with 403', () => {
  const CLOUD_ENV = { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' };
  const API = 'gh api repos/{owner}/{repo}/';
  const pull = { number: 141, title: TITLE, html_url: PR_URL, state: 'open', draft: true, merged_at: null, head: { ref: BRANCH, sha: 'abc' }, labels: [] };
  const json = (value) => ({ stdout: JSON.stringify(value) });
  const graphql = (calls) => calls.filter((c) => /^gh (pr|label) /.test(c));
  beforeEach(() => fixture());

  it('open lists, labels and opens the draft through REST, and the gates still judge gh pr create', () => {
    const h = harness({
      env: CLOUD_ENV,
      answers: [
        ['git rev-list --count origin/main..HEAD', { stdout: '1\n' }],
        [`${API}pulls?head={owner}:${BRANCH}&state=open`, json([[]])],
        [`${API}labels -X POST`, json({})],
        [`${API}pulls -X POST`, json(pull)],
        [`${API}issues/141/labels -X POST`, json([])],
      ],
    });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pr, 141);
    assert.deepEqual(graphql(h.calls), []);
    assert.ok(h.gated.some((c) => c.startsWith('gh pr create --draft')));
    assert.ok(h.gated.some((c) => c.startsWith('gh pr list --head')));
  });

  it('ready publishes the body, marks ready and posts the note through REST', () => {
    let i = 0;
    const h = harness({
      env: CLOUD_ENV,
      answers: [
        ['git diff --cached --quiet', () => ({ code: [1, 1][i++] ?? 0 })],
        [`${API}pulls?head={owner}:${BRANCH}&state=all`, json([[pull]])],
        [`${API}pulls/141 -X GET`, json(pull)],
        [`${API}pulls/141 -X PATCH`, json(pull)],
        [`${API}pulls/141/ccr/ready_for_review -X POST`, json({})],
        [`${API}issues/141/comments -X POST`, json({})],
      ],
    });
    writeFileSync(join(repo, 'body.md'), '## Why\n\nfilled\n');
    const result = step(['ready', '--body-file', join(repo, 'body.md'), '--decisions', 'none'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(graphql(h.calls), []);
    const api = h.calls.filter((c) => c.startsWith('gh api'));
    assert.ok(api.some((c) => c.startsWith(`${API}pulls/141 -X PATCH`)));
    assert.ok(api.some((c) => c.startsWith(`${API}pulls/141/ccr/ready_for_review -X POST`)));
    assert.ok(api.some((c) => c.startsWith(`${API}issues/141/comments -X POST`)));
    for (const asked of ['gh pr ready 141', `gh pr edit 141 --body-file ${join(repo, 'body.md')}`]) assert.ok(h.gated.includes(asked), asked);
    assert.ok(existsSync(join(featureDir, 'handoff.md')));
  });

  it('handoff --restore reads the comments through REST', () => {
    const MARK = '<!-- speckit-handoff -->';
    const h = harness({
      env: CLOUD_ENV,
      answers: [
        [`${API}pulls/141 -X GET`, json(pull)],
        [`${API}issues/141/comments?per_page=100 -X GET`, json([[{ user: { login: 'george-hutanu' }, body: `${MARK}\n# Hand-off\n- QA run: 3\n`, created_at: '2026-10-06T10:00:00Z' }]])],
      ],
    });
    const result = step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readFileSync(join(featureDir, 'handoff.md'), 'utf8'), '# Hand-off\n- QA run: 3\n');
    assert.deepEqual(graphql(h.calls), []);
  });

  it('on the laptop the same steps call gh pr as before', () => {
    const h = harness({ answers: [['git rev-list --count origin/main..HEAD', { stdout: '1\n' }], ['gh pr list', { stdout: '\n' }]] });
    step(['open', '--title', TITLE], h.io);
    assert.ok(h.calls.some((c) => c.startsWith('gh pr create --draft')));
    assert.ok(!h.calls.some((c) => c.startsWith('gh api')));
  });
});

// A branch whose folder number is not its story's: the title must win over the folder.
describe('the story: --story, the PR title, feature.json, then the folder number', () => {
  const OTHER = '854-precompact-pr-signal';
  const T660 = 'fix(harness): ST-660 precompact PR signal';
  const state = () => JSON.parse(readFileSync(join(repo, '.specify', 'feature.json'), 'utf8'));
  const view = (title, prState = 'OPEN') => ['gh pr view --json number,state,url,title', { stdout: JSON.stringify({ number: 244, state: prState, url: PR_URL, title }) }];
  const readyView = (title) => [`gh pr view ${OTHER} --json number,title,isDraft,url`, { stdout: JSON.stringify({ number: 244, title, isDraft: true, url: PR_URL }) }];
  const diff = ['git -C specs diff -U0 --', { stdout: '' }];
  const sideEffects = (calls) => calls.filter((c) => /^(git push|git commit|gh pr merge|gh pr ready|gh pr edit|gh pr create|node \.claude\/scripts\/(notion-sync|specs-repo)\.mjs)/.test(c));

  beforeEach(() => {
    fixture();
    mkdirSync(join(repo, 'specs', OTHER), { recursive: true });
    writeFileSync(join(repo, 'specs', OTHER, 'spec.md'), '# Spec\n');
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ level: 1, level_for: `specs/${OTHER}`, feature_directory: `specs/${OTHER}` }));
  });

  // @traces 891-FR-001 891-FR-002 891-FR-005
  it('merge finishes the story the PR title names, not the folder number, and never says ST-854', () => {
    const h = harness({ branch: OTHER, answers: [diff, view(T660), ['gh pr view 244 --json mergeCommit', { stdout: 'feed1234beef\n' }]] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(h.calls.find((c) => !c.startsWith('git rev-parse') && !c.startsWith('gh auth')), 'gh pr view --json number,state,url,title,headRefName');
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs finish --pr 244 --no-comment --story ST-660'), h.calls.join('\n'));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/notion-sync.md`), h.calls.join('\n'));
    assert.ok(!h.calls.some((c) => c.includes('ST-854')), h.calls.join('\n'));
  });

  // @traces 891-FR-001 891-FR-005
  it('falls back to the folder number, with no refusal, when no other source names a story', () => {
    const h = harness({ branch: OTHER, answers: [diff, view('chore(harness): a title without a story')] });
    const result = step(['merge', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-854 finish -- ${OTHER}/notion-sync.md`), h.calls.join('\n'));
  });

  // @traces 891-FR-001 891-FR-002
  it('reads the title over REST in a cloud session', () => {
    const rest = ['gh api repos/{owner}/{repo}/pulls/244 --jq', { stdout: `${JSON.stringify({ number: 244, state: 'MERGED', merge_commit_sha: 'feed1234beef', title: T660 })}\n` }];
    const h = harness({ branch: OTHER, env: { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' }, answers: [diff, rest, ['gh api -X POST', {}]] });
    const result = step(['merge', '--pr', '244'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(h.calls.find((c) => c.startsWith('gh api repos/{owner}/{repo}/pulls/244 --jq')), /title/);
    assert.ok(h.calls.includes('node .claude/scripts/notion-sync.mjs finish --pr 244 --no-comment --story ST-660'), h.calls.join('\n'));
  });

  // @traces 891-FR-004 891-FR-005
  it('open --story records the story for this feature, keeping the other keys, and a later merge reads it back', () => {
    const o = harness({ branch: OTHER, answers: [['git rev-list', { stdout: '1\n' }], ['gh pr list', { stdout: '244\n' }]] });
    const opened = step(['open', '--title', 'fix(harness): precompact PR signal', '--story', 'ST-660'], o.io);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.ok(o.calls.includes('node .claude/scripts/notion-sync.mjs start --pr 244 --story ST-660'), o.calls.join('\n'));
    assert.deepEqual(state(), { level: 1, level_for: `specs/${OTHER}`, feature_directory: `specs/${OTHER}`, story: 'ST-660', story_for: `specs/${OTHER}` });
    const m = harness({ branch: OTHER, answers: [diff, view('fix(harness): precompact PR signal')] });
    const merged = step(['merge', '--notion-done'], m.io);
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.ok(m.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/notion-sync.md`), m.calls.join('\n'));
  });

  // @traces 891-FR-001 891-FR-004 891-FR-005
  it('ignores a recorded story whose story_for names another feature', () => {
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${OTHER}`, story: 'ST-661', story_for: `specs/${FEATURE}` }));
    const h = harness({ branch: OTHER, answers: [diff, view(T660)] });
    const result = step(['merge', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/notion-sync.md`), h.calls.join('\n'));
  });

  // @traces 891-FR-002 891-FR-003 891-FR-005
  it('merge refuses --story against a title that names another story, before the merge and with feature.json untouched', () => {
    const before = readFileSync(join(repo, '.specify', 'feature.json'), 'utf8');
    const h = harness({ branch: OTHER, answers: [view('fix(harness): ST-661 something else')] });
    const result = step(['merge', '--story', 'ST-660'], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'story');
    assert.match(result.fix, /--story ST-660/);
    assert.match(result.fix, /title ST-661/);
    assert.deepEqual(sideEffects(h.calls), []);
    assert.equal(readFileSync(join(repo, '.specify', 'feature.json'), 'utf8'), before);
  });

  // @traces 891-FR-003 891-FR-005
  it('ready refuses a recorded story against a title that names another, before anything is published', () => {
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${OTHER}`, story: 'ST-661', story_for: `specs/${OTHER}` }));
    const body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n\nfilled\n');
    const h = harness({ branch: OTHER, answers: [readyView(T660)] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'story');
    assert.match(result.fix, /feature\.json ST-661/);
    assert.match(result.fix, /title ST-660/);
    assert.deepEqual(sideEffects(h.calls), []);
    assert.ok(!h.calls.some((c) => c.startsWith('node .claude/scripts/level.mjs')), h.calls.join('\n'));
  });

  // @traces 891-FR-003
  it('compares stories by number, so ST-0660 and ST-660 agree', () => {
    const h = harness({ branch: OTHER, answers: [diff, view(T660)] });
    const result = step(['merge', '--story', 'ST-0660', '--notion-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/notion-sync.md`), h.calls.join('\n'));
  });

  // @traces 891-FR-004 891-FR-005
  it('a malformed --story is a usage error before any git or gh call, and handoff takes none', () => {
    for (const argv of [['merge', '--story', '660'], ['ready', '--body-file', 'b.md', '--story', 'st-660'], ['handoff', '--story', 'ST-660']]) {
      const h = harness({ branch: OTHER });
      const result = step(argv, h.io);
      assert.equal(result.ok, false, argv.join(' '));
      assert.equal(result.stopped, 'usage', argv.join(' '));
      assert.deepEqual(h.calls, [], argv.join(' '));
    }
  });
});
