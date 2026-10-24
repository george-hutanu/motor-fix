import { afterEach, describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gateEnv, runGates, step } from './lifecycle.mjs';

const root = join(import.meta.dirname, '..', '..');
const FEATURE = '696-lifecycle-script';
const BRANCH = FEATURE;
const TITLE = 'chore(harness): ST-696 lifecycle steps as one script call each';
const PR_URL = 'https://github.com/george-hutanu/motor-fix/pull/141';

let repo;
let featureDir;

function fixture({ trackerScript = true } = {}) {
  repo = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696 (Task)\n');
  writeFileSync(join(featureDir, 'tracker-sync.md'), `# Tracker sync — ${FEATURE}\n\n- 2026-10-05 · start · ST-696 · To do → Planning\n`);
  writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## Why\n\n_(fill in: why)_\n\n## Story\n\n_(fill in: the story link)_\n\n## Spec folder\n\n_(fill in: specs/NNN-slug)_\n');
  if (trackerScript) writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
}

/**
 * Stubbed git, gh, gates and tracker CLI. `answers` maps a command prefix to a
 * result; the first prefix that matches wins. Every call and gate is recorded.
 */
const REST = 'gh api repos/{owner}/{repo}/';
// The branch has no PR: gh's PR reads go over REST, the branch's pulls first.
const MERGE = 'gh api -X PUT repos/{owner}/{repo}/pulls/141/merge -f merge_method=merge';
const HEAD_STATUSES = 'gh api repos/{owner}/{repo}/commits/abcdef1234567890/statuses?per_page=100';
const NO_PR = [`${REST}pulls?head=`, { stdout: '[[]]' }];
/** The branch's pull as REST answers it, overriding the harness default. */
const pullAt = (props) => {
  const p = defaultPull(props.head?.ref ?? BRANCH, props);
  return [
    [`${REST}pulls?head=`, (cmd) => ({ stdout: JSON.stringify([/state=all/.test(cmd) || p.state === 'open' ? [p] : []]) })],
    [`${REST}pulls/${p.number} -X GET`, { stdout: JSON.stringify(p) }],
  ];
};
function defaultPull(branch, props = {}) {
  return { number: 141, state: 'open', merged_at: null, draft: true, title: TITLE, html_url: PR_URL, merge_commit_sha: 'feed1234beef', head: { ref: branch, sha: 'abcdef1234567890' }, labels: [], ...props };
}
const restComments = (comments) => [`${REST}issues/141/comments?per_page=100 -X GET`, { stdout: JSON.stringify([comments]) }];

function harness({ branch = BRANCH, env = { GH_TOKEN: 'tok-george' }, answers = [], refuse = null } = {}) {
  const calls = [];
  const gated = [];
  const envs = [];
  const base = [
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${branch}\n` }],
    ['git rev-parse HEAD', { stdout: 'abcdef1234567890\n' }],
    ['git merge-base HEAD origin/main', { stdout: 'b45e0000\n' }],
    ['git rev-parse origin/main', { stdout: 'ma1n0000\n' }],
    ['gh auth token -u george-hutanu', { stdout: 'tok-from-gh\n' }],
    ['gh pr create', { stdout: `${PR_URL}\n` }],
    ...pullAt({ head: { ref: branch, sha: 'abcdef1234567890' } }),
    ['node .claude/scripts/tracker-sync.mjs start', { stdout: '{"status":"Planning"}\n' }],
    ['node .claude/scripts/tracker-sync.mjs finish', { stdout: '{"status":"Done"}\n' }],
    // A commit with no statuses, as REST answers it: the merge reads head's before merging.
    [`${REST}commits/`, { stdout: '[]' }],
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

  it('makes the start commit, pushes, opens the labelled draft, then runs the tracker start and pr', () => {
    const h = harness({ answers: [['git rev-list --count origin/main..HEAD', { stdout: '0\n' }], NO_PR] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pr, 141);
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.equal(calls.length, 8, calls.join('\n'));
    assert.equal(calls[0], 'git rev-list --count origin/main..HEAD');
    assert.equal(calls[1], 'git commit --allow-empty -m chore(harness): ST-696 start lifecycle steps as one script call each');
    assert.equal(calls[2], `git push -u origin ${BRANCH}`);
    assert.equal(calls[3], `${REST}pulls?head={owner}:${BRANCH}&state=open&per_page=100 -X GET --paginate --slurp`);
    assert.equal(calls[4], 'gh label create scope: harness --force');
    assert.match(calls[5], /^gh pr create --draft --base main --head 696-lifecycle-script --title chore\(harness\): ST-696 lifecycle steps as one script call each --body-file \S+ --label planning --label tooling --label scope: harness$/);
    assert.equal(calls[6], 'node .claude/scripts/tracker-sync.mjs start --pr 141 --story ST-696');
    assert.equal(calls[7], 'node .claude/scripts/tracker-sync.mjs pr 141 --story ST-696');
  });

  it('opens the draft from the PR template with the story and spec folder filled in', () => {
    let body = '';
    const h = harness({
      answers: [
        ['git rev-list', { stdout: '0\n' }],
        NO_PR,
        ['gh pr create', (cmd) => { body = readFileSync(cmd.match(/--body-file (\S+)/)[1], 'utf8'); return { stdout: `${PR_URL}\n` }; }],
      ],
    });
    step(['open', '--title', TITLE], h.io);
    assert.match(body, /## Why/);
    assert.ok(body.includes('_(fill in: the story link)_'), body);
    assert.ok(body.includes(`specs/${FEATURE}`), body);
  });

  it('adds breaking for a title with ! and the type label from the title', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '2\n' }], NO_PR] });
    step(['open', '--title', 'feat(api)!: ST-696 change the contract'], h.io);
    const create = h.calls.find((c) => c.startsWith('gh pr create'));
    assert.match(create, /--label planning --label feature --label breaking --label scope: api$/);
  });

  it('a second open makes no commit, opens no second PR, and still pushes and links', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '3\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.some((c) => c.startsWith('git commit')));
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr create')));
    assert.ok(h.calls.includes(`git push -u origin ${BRANCH}`));
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs pr 141 --story ST-696'));
  });

  it('stops at a failing tracker event and lists the events left and the rerun', () => {
    const h = harness({
      answers: [['git rev-list', { stdout: '1\n' }], ['node .claude/scripts/tracker-sync.mjs start', { code: 1, stdout: 'tracker-sync: GitHub refused\n' }]],
    });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-tracker-sync start', 'speckit-tracker-sync pr 141']);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs open --title "${TITLE}" --tracker-done`);
    assert.equal(h.calls.at(-1), 'node .claude/scripts/tracker-sync.mjs start --pr 141 --story ST-696');
  });

  it('treats a missing tracker-sync.mjs like a failing event', () => {
    fixture({ trackerScript: false });
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-tracker-sync start', 'speckit-tracker-sync pr 141']);
    assert.ok(!h.calls.some((c) => c.startsWith('node .claude/scripts/tracker-sync.mjs')));
  });

  it('--tracker-done skips the tracker events', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }]] });
    const result = step(['open', '--title', TITLE, '--tracker-done'], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.some((c) => c.includes('tracker-sync')));
  });

  it("points a feature.json left on the last feature at this branch's spec folder before anything runs", () => {
    mkdirSync(join(repo, 'specs', '685-news-relay'), { recursive: true });
    writeFileSync(join(repo, 'specs', '685-news-relay', 'spec.md'), '# Spec\n');
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ level: 2, feature_directory: 'specs/685-news-relay' }));
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(JSON.parse(readFileSync(join(repo, '.specify', 'feature.json'), 'utf8')).feature_directory, `specs/${FEATURE}`);
    assert.equal(result.did[0], `feature.json → specs/${FEATURE}`);
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs start --pr 141 --story ST-696'), h.calls.join('\n'));
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
    const h = harness({ answers: [staged([1, 1]), MERGE_BASE] });
    const result = step(['ready', '--body-file', body, '--decisions', 'none'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const calls = ofTool(h.calls).filter((c) => !c.startsWith('git rev-parse'));
    assert.deepEqual(calls, [
      `${REST}pulls?head={owner}:${BRANCH}&state=all&per_page=100 -X GET --paginate --slurp`,
      `${REST}pulls/141 -X GET`,
      'node .claude/scripts/level.mjs check --ready --json',
      'git status --porcelain',
      'git write-tree',
      ...LOCAL,
      `node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 feature records -- ${FEATURE}`,
      `node scripts/pr-body-check.ts --body-file ${body} --title ${TITLE}`,
      `gh pr edit 141 --body-file ${body}`,
      'gh pr ready 141',
      'node .claude/scripts/tracker-sync.mjs qa --pr 141 --story ST-696',
      `node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 qa -- ${FEATURE}/tracker-sync.md`,
    ]);
    const note = readFileSync(join(featureDir, 'handoff.md'), 'utf8');
    assert.match(note, /PR: #141 https:\/\/github.com\/george-hutanu\/motor-fix\/pull\/141 · branch 696-lifecycle-script · worktree \S+ · head abcdef1234567890/);
    assert.match(note, /- Tracker: issue ST-696 \(ST-696\) · events in specs\/696-lifecycle-script\/tracker-sync\.md/);
    assert.match(note, /Open decisions: none/);
    assert.ok(result.did.includes('handoff comment skipped (not a cloud session)'), JSON.stringify(result.did));
  });

  // @traces 317-FR-001
  it('writes the run\'s repair count into the note', () => {
    writeFileSync(join(repo, '.specify', 'run-state.json'), JSON.stringify({ status: 'in-progress', repair_iterations: 2 }));
    const h = harness({ answers: [staged([1, 1]), MERGE_BASE] });
    assert.equal(step(['ready', '--body-file', body, '--decisions', 'none'], h.io).ok, true);
    assert.match(readFileSync(join(featureDir, 'handoff.md'), 'utf8'), /^- Repair iterations: 2$/m);
  });

  // @traces 1324-FR-006
  // @traces 1324-FR-012
  it('files no deferred.md bullet and writes no Deferred line, even with a deferred.md in the feature', () => {
    writeFileSync(join(featureDir, 'deferred.md'), '# Deferred\n\n- MEDIUM: tidy `x.mjs` (code-reviewer)\n');
    const h = harness({ answers: [staged([1, 1])] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => /tracker-sync\.mjs debt/.test(c)), h.calls.join('\n'));
    assert.doesNotMatch(readFileSync(join(featureDir, 'handoff.md'), 'utf8'), /Deferred/);
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
    const h = harness({ answers: [staged([0, 0]), ...pullAt({ draft: false })] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.includes('gh pr ready 141'));
  });

  it('stops at a failing qa event with the event left and the rerun', () => {
    const h = harness({ answers: [staged([0]), ['node .claude/scripts/tracker-sync.mjs qa', { code: 1, stdout: 'tracker-sync: GitHub refused\n' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-tracker-sync qa']);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs ready --body-file ${body} --tracker-done`);
    assert.equal(h.calls.at(-1), 'node .claude/scripts/tracker-sync.mjs qa --pr 141 --story ST-696');
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
    const h = harness({ answers: [NO_PR] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /lifecycle\.mjs open/);
  });
});

const LOCAL = [
  'node scripts/observability-inventory.ts',
  'node scripts/structure-check.ts --base origin/main',
  'npm run lint',
  'git merge-base HEAD origin/main',
  'sh scripts/heavy.sh sh -c JEST_SUITE=unit TZ=UTC NX_DAEMON=false npx nx affected -t typecheck test --base=b45e0000',
];
const MERGE_BASE = ['git merge-base HEAD origin/main', { stdout: 'b45e0000\n' }];
const ofLocal = (calls) => calls.filter((c) => /^(node scripts\/|npm run lint|sh scripts\/heavy\.sh|git merge-base)/.test(c));

describe('check: the CI-only checks and the affected tests before a push', () => {
  beforeEach(() => fixture());

  // @traces 1355-FR-001
  // @traces 1355-FR-002
  it('runs the draft body check, the inventory, the folder rules, lint, then the affected typecheck and unit tests', () => {
    const h = harness({ answers: [MERGE_BASE] });
    const result = step(['check'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const local = ofLocal(h.calls);
    assert.match(local[0], new RegExp(`^node scripts/pr-body-check\\.ts --body-file \\S+ --title ${TITLE.replace(/[()]/g, '\\$&')} --draft$`));
    assert.deepEqual(local.slice(1), LOCAL);
  });

  // @traces 1355-FR-001
  it('checks every section, not only the headings, once the PR is ready', () => {
    const h = harness({ answers: [MERGE_BASE, ...pullAt({ draft: false })] });
    assert.equal(step(['check'], h.io).ok, true);
    const body = h.calls.find((c) => c.startsWith('node scripts/pr-body-check.ts'));
    assert.doesNotMatch(body, /--draft/);
  });

  // @traces 1355-FR-001
  it('skips the body check, saying so, when the branch has no PR yet', () => {
    const h = harness({ answers: [MERGE_BASE, NO_PR] });
    const result = step(['check'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('node scripts/pr-body-check.ts')));
    assert.ok(result.did.some((d) => /pr-body-check skipped/.test(d)), JSON.stringify(result.did));
  });

  // @traces 1355-FR-001
  // @traces 1355-FR-002
  for (const [prefix, name, output] of [
    ['node scripts/pr-body-check.ts', 'pr-body-check', 'Missing heading: ## Why'],
    ['node scripts/observability-inventory.ts', 'observability-inventory', 'inventory: no entry for queue mail'],
    ['node scripts/structure-check.ts', 'structure-check', 'apps/web/src/x.ts: inline template'],
    ['npm run lint', 'lint', 'lint/style/useTemplate'],
    ['sh scripts/heavy.sh', 'affected typecheck and unit tests', 'FAIL apps/api/src/a.spec.ts'],
  ]) {
    it(`stops at a failing ${name} with its output and runs nothing after it`, () => {
      const h = harness({ answers: [MERGE_BASE, [prefix, { code: 1, stdout: `${output}\n` }]] });
      const result = step(['check'], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, name);
      assert.match(result.fix, new RegExp(output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(result.fix, /lifecycle\.mjs check/);
      const local = ofLocal(h.calls);
      assert.ok(local.at(-1).startsWith(prefix), local.join('\n'));
    });
  }

  // @traces 1355-FR-001
  for (const [prefix, name] of [
    ['node scripts/observability-inventory.ts', 'observability-inventory'],
    ['node scripts/structure-check.ts', 'structure-check'],
    ['npm run lint', 'lint'],
    ['sh scripts/heavy.sh', 'affected typecheck and unit tests'],
  ]) it(`ready runs ${name} after the level check and before the records commit; a failing one leaves the PR a draft`, () => {
    const body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n\nfilled\n');
    const h = harness({ answers: [MERGE_BASE, [prefix, { code: 1, stdout: 'refused\n' }]] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, name);
    assert.ok(h.calls.includes('node .claude/scripts/level.mjs check --ready --json'));
    assert.ok(!h.calls.some((c) => c.includes('specs-repo.mjs commit') || c.startsWith('gh pr edit') || c.startsWith('gh pr ready')), h.calls.join('\n'));
  });
});

// @traces 1011-FR-001 1011-FR-003
describe('check caps the memory of the affected Jest runs', () => {
  beforeEach(() => fixture());

  const stepEnv = (h) => h.envs.find((e) => e.cmd.startsWith('sh scripts/heavy.sh')).env;

  it('runs the affected tests with two Jest workers, recycled past 1GB, by default', () => {
    const h = harness({ answers: [MERGE_BASE] });
    assert.equal(step(['check'], h.io).ok, true);
    const env = stepEnv(h);
    assert.equal(env.JEST_MAX_WORKERS, '2');
    assert.equal(env.JEST_IDLE_MEMORY, '1GB');
    assert.equal(env.GH_TOKEN, 'tok-george', 'the rest of the env is passed through');
  });

  it('keeps the caps already set in the env', () => {
    const h = harness({ env: { GH_TOKEN: 'tok-george', JEST_MAX_WORKERS: '3', JEST_IDLE_MEMORY: '2GB' }, answers: [MERGE_BASE] });
    assert.equal(step(['check'], h.io).ok, true);
    const env = stepEnv(h);
    assert.equal(env.JEST_MAX_WORKERS, '3');
    assert.equal(env.JEST_IDLE_MEMORY, '2GB');
  });

  it('caps only the test step: the other checks run with the env as it was', () => {
    const h = harness({ answers: [MERGE_BASE] });
    assert.equal(step(['check'], h.io).ok, true);
    const lint = h.envs.find((e) => e.cmd === 'npm run lint').env;
    assert.equal(lint.JEST_MAX_WORKERS, undefined);
    assert.equal(lint.JEST_IDLE_MEMORY, undefined);
  });
});

// @traces 749-FR-002 749-FR-003
describe('check and ready reuse a passing proof of the local checks for the same clean tree', () => {
  beforeEach(() => fixture());

  const TREE = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
  const proofFile = () => join(repo, '.specify', '.cache', 'local-checks.json');
  const tree = (sha = TREE, base = 'b45e0000', status = '', main = 'ma1n0000') => [
    ['git status --porcelain', { stdout: status }],
    ['git write-tree', { stdout: `${sha}\n` }],
    ['git merge-base HEAD origin/main', { stdout: `${base}\n` }],
    ['git rev-parse origin/main', { stdout: `${main}\n` }],
  ];
  const ran = (h) => h.calls.filter((c) => /^(node scripts\/(observability|structure)|npm run lint|sh scripts\/heavy\.sh)/.test(c));

  // @traces 1358-FR-014
  // @traces 1358-FR-015
  it('runs the local checks once, then reuses the proof on a second check of the same tree', () => {
    const first = harness({ answers: tree() });
    assert.equal(step(['check'], first.io).ok, true);
    assert.equal(ran(first).length, 4);
    assert.ok(existsSync(proofFile()), 'a passing check on a clean tree records a proof');
    const second = harness({ answers: tree() });
    const result = step(['check'], second.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(ran(second), [], second.calls.join('\n'));
    assert.ok(result.did.includes(`local checks: reused proof ${TREE.slice(0, 7)}`), JSON.stringify(result.did));
    assert.ok(second.calls.some((c) => c.startsWith('node scripts/pr-body-check.ts')), 'the PR body is not part of the proof');
  });

  // @traces 1358-FR-014
  it('lets ready reuse the proof check wrote', () => {
    assert.equal(step(['check'], harness({ answers: tree() }).io).ok, true);
    const body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n\nfilled\n');
    const h = harness({ answers: tree() });
    const result = step(['ready', '--body-file', body], h.io);
    assert.deepEqual(ran(h), [], h.calls.join('\n'));
    assert.ok(result.did.includes(`local checks: reused proof ${TREE.slice(0, 7)}`), JSON.stringify(result));
  });

  // @traces 1358-FR-014
  // @traces 1358-FR-015
  for (const status of [' M apps/api/src/a.ts\n', '?? scratch.txt\n']) {
    it(`runs the checks and records no proof when git status shows ${status.trim()}`, () => {
      assert.equal(step(['check'], harness({ answers: tree() }).io).ok, true);
      rmSync(proofFile());
      const h = harness({ answers: tree(TREE, 'b45e0000', status) });
      assert.equal(step(['check'], h.io).ok, true);
      assert.equal(ran(h).length, 4);
      assert.ok(!existsSync(proofFile()), 'a dirty worktree records nothing');
      writeFileSync(proofFile(), JSON.stringify({ tree: TREE, base: 'b45e0000', main: 'ma1n0000', at: 'x' }));
      const again = harness({ answers: tree(TREE, 'b45e0000', status) });
      step(['check'], again.io);
      assert.equal(ran(again).length, 4, 'a dirty worktree never reuses a proof');
    });
  }

  // @traces 1358-FR-015
  for (const [label, sha, base] of [
    ['another tree', 'ffff9999', 'b45e0000'],
    ['another merge base', TREE, 'c0ffee00'],
  ]) {
    it(`runs the checks for ${label}`, () => {
      step(['check'], harness({ answers: tree() }).io);
      const h = harness({ answers: tree(sha, base) });
      const result = step(['check'], h.io);
      assert.equal(ran(h).length, 4);
      assert.ok(!result.did.some((d) => /reused proof/.test(d)));
      assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).tree, sha.trim(), 'the proof is overwritten with the tree just checked');
    });
  }

  // @traces 1358-FR-014
  // @traces 1358-FR-015
  it('runs the checks again when origin/main moved and the merge base did not', () => {
    step(['check'], harness({ answers: tree() }).io);
    const h = harness({ answers: tree(TREE, 'b45e0000', '', 'm0ved000') });
    const result = step(['check'], h.io);
    assert.equal(ran(h).length, 4, h.calls.join('\n'));
    assert.ok(!result.did.some((d) => /reused proof/.test(d)));
    assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).main, 'm0ved000');
    assert.equal(h.calls.filter((c) => c === 'git merge-base HEAD origin/main').length, 1, 'the merge base is read once');
  });

  // @traces 1358-FR-015
  it('runs the checks when there is no proof', () => {
    const h = harness({ answers: tree() });
    step(['check'], h.io);
    assert.equal(ran(h).length, 4);
  });

  // @traces 1358-FR-014
  it('reads and writes no proof when git write-tree prints nothing or fails', () => {
    mkdirSync(dirname(proofFile()), { recursive: true });
    writeFileSync(proofFile(), JSON.stringify({ tree: '', base: 'b45e0000', at: 'x' }));
    const h = harness({ answers: tree('') });
    assert.equal(step(['check'], h.io).ok, true);
    assert.equal(ran(h).length, 4);
    assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).at, 'x');
    const failed = harness({ answers: [['git write-tree', { code: 128, stderr: 'fatal: error building trees' }], ...tree()] });
    const result = step(['check'], failed.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ran(failed).length, 4);
    assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).at, 'x');
  });

  // @traces 1358-FR-014
  it('reads and writes no proof when the merge base is empty', () => {
    const h = harness({ answers: tree(TREE, '') });
    assert.equal(step(['check'], h.io).ok, false);
    assert.ok(!existsSync(proofFile()));
  });
});

describe('handoff: the note survives a fresh VM as a marked PR comment', () => {
  const MARK = '<!-- speckit-handoff -->';
  const note = () => join(featureDir, 'handoff.md');
  const comments = (...bodies) => restComments(bodies.map((body, i) => ({ user: { login: 'george-hutanu' }, body, created_at: `2026-10-06T10:0${i}:00Z` })));
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
    assert.deepEqual(posted, [`${MARK}\n# Hand-off\n- QA run: 9 · head abc · lap 2 · url\n- Repair iterations: 1\n`]);
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
    const h = harness();
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
      answers: [restComments([
        { body: `${MARK}\nnewer\n`, created_at: '2026-10-06T12:00:00Z' },
        { body: `${MARK}\nolder\n`, created_at: '2026-10-06T09:00:00Z' },
      ])],
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
    assert.ok(!h.calls.some((c) => c.includes('/comments')));
  });

  // @traces 317-FR-003
  it('--restore pages through every comment and restores a note found on page 2', () => {
    const noise = Array.from({ length: 100 }, (_, i) => ({ body: `comment ${i}`, created_at: '2026-10-06T09:00:00Z' }));
    const h = harness({
      answers: [[`${REST}issues/141/comments?per_page=100 -X GET`, { stdout: JSON.stringify([noise, [{ body: `${MARK}\npage two\n`, created_at: '2026-10-06T11:00:00Z' }]]) }]],
    });
    const result = step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readFileSync(note(), 'utf8'), 'page two\n');
    assert.ok(h.calls.some((c) => c.startsWith(`${REST}issues/141/comments?per_page=100 -X GET --paginate`)), h.calls.join('\n'));
  });

  it('--restore with no marked comment stops, names the fix and writes nothing', () => {
    const h = harness({ answers: [comments('just a comment')] });
    const result = step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /no recorded QA run/);
    assert.equal(existsSync(note()), false);
  });
});

// @traces 317-FR-001 317-FR-002
describe('handoff: the repair count survives a fresh VM in the note', () => {
  const MARK = '<!-- speckit-handoff -->';
  const note = () => join(featureDir, 'handoff.md');
  const stateFile = () => join(repo, '.specify', 'run-state.json');
  const repairs = () => JSON.parse(readFileSync(stateFile(), 'utf8')).repair_iterations;
  const setRepairs = (n) => writeFileSync(stateFile(), JSON.stringify({ status: 'in-progress', repair_iterations: n }));
  const marked = (body) => restComments([{ user: { login: 'george-hutanu' }, body: `${MARK}\n${body}`, created_at: '2026-10-06T10:00:00Z' }]);
  beforeEach(() => fixture());

  it('rewrites the count line from run state before it posts', () => {
    setRepairs(3);
    writeFileSync(note(), '# Hand-off\n- QA run: 9 · head abc · lap 4 · url\n- Repair iterations: 2\n');
    assert.equal(step(['handoff', '--pr', '141'], harness().io).ok, true);
    assert.equal(readFileSync(note(), 'utf8'), '# Hand-off\n- QA run: 9 · head abc · lap 4 · url\n- Repair iterations: 3\n');
  });

  it('adds the count line to a note that has none, and posts it in a cloud session', () => {
    setRepairs(5);
    writeFileSync(note(), '# Hand-off\n- QA run: 9 · head abc · lap 6 · url\n');
    const posted = [];
    const h = harness({ env: { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' } });
    const run = h.io.run;
    h.io.run = (file, args, opts = {}) => {
      if ([file, ...args].join(' ').includes('issues/141/comments -X POST')) {
        posted.push(JSON.parse(opts.input).body);
        return { code: 0, stdout: '{}', stderr: '' };
      }
      return run(file, args, opts);
    };
    assert.equal(step(['handoff', '--pr', '141'], h.io).ok, true);
    assert.equal(posted.length, 1);
    assert.match(posted[0], /^- Repair iterations: 5$/m);
  });

  it('restores the count from the lap when run state is gone, so the next lap is 8 and the cap still blocks', async () => {
    const h = harness({ answers: [marked('# Hand-off\n- QA run: 9 · head abc · lap 7 · url\n')] });
    assert.equal(step(['handoff', '--restore', '--pr', '141'], h.io).ok, true);
    assert.equal(repairs(), 6);
    const { main } = await import('./run-state.mjs');
    const env = { SPECKIT_MAX_REPAIR_ITERATIONS: '7' };
    assert.equal(main(['repair'], repo, env), 0);
    assert.equal(repairs() + 1, 8);
    assert.equal(main(['repair'], repo, env), 1);
    assert.equal(JSON.parse(readFileSync(stateFile(), 'utf8')).blocking_condition, 'repair-loop-exceeded');
  });

  it('takes the count line when it is higher than the lap says', () => {
    const h = harness({ answers: [marked('# Hand-off\n- QA run: 9 · head abc · lap 3 · url\n- Repair iterations: 4\n')] });
    step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(repairs(), 4);
  });

  it('never lowers a run state that is already higher', () => {
    setRepairs(8);
    const h = harness({ answers: [marked('# Hand-off\n- QA run: 9 · head abc · lap 3 · url\n')] });
    step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(repairs(), 8);
  });

  it('restores the count from a note that is already there, fetching nothing', () => {
    writeFileSync(note(), '# Hand-off\n- Repair iterations: 2\n');
    const h = harness();
    assert.equal(step(['handoff', '--restore', '--pr', '141'], h.io).ok, true);
    assert.equal(repairs(), 2);
    assert.ok(!h.calls.some((c) => c.includes('/comments')));
  });

  it('leaves run state alone for a note with neither a count nor a lap', () => {
    const h = harness({ answers: [marked('# Hand-off\n- QA run: none\n')] });
    step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(existsSync(stateFile()), false);
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
    assert.equal(calls[0], `${REST}pulls?head={owner}:${BRANCH}&state=all&per_page=100 -X GET --paginate --slurp`);
    assert.equal(calls[1], `${REST}pulls/141 -X GET`);
    assert.equal(calls[2], HEAD_STATUSES);
    assert.equal(calls[3], MERGE);
    assert.equal(calls[4], `${REST}pulls/141 -X GET`);
    assert.equal(calls[5], 'git worktree list --porcelain');
    assert.equal(calls[6], `node scripts/test-services.ts down ${repo}`);
    assert.equal(calls[7], `node .claude/scripts/tracker-sync.mjs finish --pr 141 --body-file ${join(featureDir, 'finish-comment.md')} --story ST-696`);
    assert.equal(calls[8], `git -C specs diff -U0 -- ${FEATURE}/tracker-sync.md`);
    assert.equal(calls[9], `node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 finish -- ${FEATURE}/tracker-sync.md`);
    assert.match(calls[10], /^gh pr comment 141 --body-file \S+$/);
    assert.equal(calls.length, 11);
    assert.match(comment, /^## Finish log/);
    assert.match(comment, /feed1234beef/);
    assert.match(comment, /- one/);
    assert.match(comment, /finish · ST-696 · QA → Done/);
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
    // @traces 1324-FR-006
    assert.ok(!('ready_logged' in result) && !('review' in result), JSON.stringify(result));
  });

  // @traces 1018-FR-005
  it('reads the finish log through the features folder of a moved clone, committing the path under specs/', () => {
    const clone = join(repo, '.motor-fix-specs');
    mkdirSync(clone);
    renameSync(join(repo, 'specs'), join(clone, 'specs'));
    for (const args of [['init', '-q', '-b', 'trunk'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'seed']]) {
      execFileSync('git', args, { cwd: clone, stdio: 'ignore' });
    }
    symlinkSync('.motor-fix-specs/specs', join(repo, 'specs'));
    const h = harness({ answers: [['git -C .motor-fix-specs/specs diff -U0 --', diff[1]]] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`git -C .motor-fix-specs/specs diff -U0 -- ${FEATURE}/tracker-sync.md`), h.calls.join('\n'));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 finish -- ${FEATURE}/tracker-sync.md`));
  });

  // An old clone still at specs/ that fast-forwarded past trunk's move holds
  // the feature at specs/specs/<feature>; feature.json still names specs/<feature>.
  it('finds the feature under specs/specs in an old clone past the move and commits its path under the features folder', () => {
    const clone = join(repo, 'specs');
    renameSync(featureDir, join(repo, FEATURE));
    mkdirSync(join(clone, 'specs'));
    renameSync(join(repo, FEATURE), join(clone, 'specs', FEATURE));
    for (const args of [['init', '-q', '-b', 'trunk'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'seed']]) {
      execFileSync('git', args, { cwd: clone, stdio: 'ignore' });
    }
    featureDir = join(clone, 'specs', FEATURE);
    const h = harness({ answers: [['git -C specs/specs diff -U0 --', diff[1]]] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`git -C specs/specs diff -U0 -- ${FEATURE}/tracker-sync.md`), h.calls.join('\n'));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 finish -- ${FEATURE}/tracker-sync.md`));
  });

  it('passes --no-comment when there is no finish-comment.md', () => {
    const h = harness({ answers: [diff] });
    step(['merge'], h.io);
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs finish --pr 141 --no-comment --story ST-696'));
  });

  it('refuses exactly when the merge gate does, prints its refusal, and runs nothing after it', () => {
    const message = 'Merge gate (Constitution VII): PR #141 cannot merge: no agent-review success on abc1234.';
    const h = harness({ refuse: { prefix: 'gh api -X PUT', message } });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, `gate: ${MERGE}`);
    assert.equal(result.fix, message);
    assert.ok(!h.calls.includes(MERGE));
    assert.equal(h.calls.at(-1), HEAD_STATUSES);
    assert.ok(!h.calls.some((c) => c.includes('test-services')), 'no stack is stopped for a PR that did not merge');
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });

  it('skips the merge on a PR already merged and finishes the rest', () => {
    const h = harness({ answers: [diff, ...pullAt({ state: 'closed', merged_at: '2026-10-05T10:00:00Z' })] });
    const result = step(['merge', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.includes(MERGE));
    assert.ok(!h.calls.some((c) => c.includes('tracker-sync.mjs')));
    assert.ok(h.calls.some((c) => c.startsWith('gh pr comment 141')));
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${repo}`), 'a rerun stops the stack again');
  });

  it('stops at a failing finish after the merge with finish left and the rerun', () => {
    const h = harness({ answers: [['node .claude/scripts/tracker-sync.mjs finish', { code: 1, stdout: 'tracker-sync: GitHub refused\n' }]] });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.left, ['speckit-tracker-sync finish']);
    assert.equal(result.then, 'node .claude/scripts/lifecycle.mjs merge --pr 141 --tracker-done');
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${repo}`), 'the stack is stopped before the tracker finish can stop the step');
    assert.ok(!h.calls.some((c) => c.startsWith('gh pr comment')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });
});

// A passing lap's medium and low findings are fixed after it, and the finish
// comment lists each one before the PR may merge (Constitution VII step 5).
describe('merge after a passing lap that reported findings', () => {
  beforeEach(() => fixture());
  const FROM = '1'.repeat(40);
  const FIX = '2'.repeat(40);
  const review = (description) => ({ stdout: JSON.stringify([{ context: 'agent-review', state: 'success', description }]) });
  const own = (n) => [HEAD_STATUSES, review(`No blocking findings; ${n} in all. Booted 2/2.`)];
  const carriedFixes = [
    [HEAD_STATUSES, review(`carried from ${FROM}: QA fixes`)],
    [`gh api repos/{owner}/{repo}/commits/${FROM}/statuses`, review('No blocking findings; 2 in all. Booted 2/2.')],
    [`gh api repos/{owner}/{repo}/compare/${FROM}...abcdef1234567890`, { stdout: JSON.stringify({ status: 'ahead', commits: [{ sha: FIX }, { sha: 'abcdef1234567890' }] }) }],
  ];
  const comment = (text) => writeFileSync(join(featureDir, 'finish-comment.md'), text);
  const stoppedBeforeMerge = (result, h) => {
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.stopped, 'Fixed after QA');
    assert.match(result.fix, /finish-comment\.md/);
    assert.ok(!h.calls.includes(MERGE), 'nothing merged');
  };

  // @traces 1362-FR-007
  it('stops before the merge while the finish comment does not list every finding the lap reported', () => {
    let h = harness({ answers: [own(2)] });
    stoppedBeforeMerge(step(['merge'], h.io), h);
    comment('## Fixed after QA\n\n- medium: the empty list answered 500\n');
    h = harness({ answers: [own(2)] });
    const result = step(['merge'], h.io);
    stoppedBeforeMerge(result, h);
    assert.match(result.fix, /2 findings/);
    comment('## Fixed after QA\n\n- the empty list answered 500\n- the label overflowed\n');
    h = harness({ answers: [own(2)] });
    stoppedBeforeMerge(step(['merge'], h.io), h);
  });

  // @traces 1362-FR-007
  it('merges on an own success once the list names each finding with its severity, and posts it', () => {
    comment('**Decisions**\n- one\n\n## Fixed after QA\n\n- medium: the empty list answered 500\n- low: the label overflowed at 320 px\n');
    let posted = '';
    const h = harness({ answers: [own(2), ['gh pr comment', (cmd) => { posted = readFileSync(cmd.match(/--body-file (\S+)/)[1], 'utf8'); return {}; }]] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(MERGE));
    assert.match(posted, /## Fixed after QA[\s\S]*- low: the label overflowed/);
  });

  // @traces 1362-FR-007
  it('needs no list after a lap with no findings', () => {
    const h = harness({ answers: [own(0)] });
    assert.equal(step(['merge'], h.io).ok, true);
    assert.ok(h.calls.includes(MERGE));
  });

  // @traces 1362-FR-007
  it('under a QA-fixes carry, takes the count from the named lap and needs each line to name a fix commit after it', () => {
    comment('## Fixed after QA\n\n- medium: the empty list answered 500 (2222222)\n- low: the label overflowed\n');
    let h = harness({ answers: carriedFixes });
    const result = step(['merge'], h.io);
    stoppedBeforeMerge(result, h);
    assert.match(result.fix, /commit/);
    comment('## Fixed after QA\n\n- medium: the empty list answered 500 (2222222)\n- low: the label overflowed (1111111)\n');
    h = harness({ answers: carriedFixes });
    stoppedBeforeMerge(step(['merge'], h.io), h);
    comment('## Fixed after QA\n\n- medium: the empty list answered 500 (2222222)\n- low: the label overflowed (abcdef1)\n');
    h = harness({ answers: carriedFixes });
    assert.equal(step(['merge'], h.io).ok, true);
    assert.ok(h.calls.includes(MERGE));
  });

  // A fix can live outside the PR's commits: in the specs repo (a tasks.md
  // line) or in the git-ignored QA flows file. Each counts when it is made
  // after the named lap's success was posted (ST-1378).
  const LAP_AT = '2026-10-20T10:00:00Z';
  const SPECS = 'cafe1234';
  const SPECS_COMPARE = `gh api repos/george-hutanu/motor-fix-specs/compare/${SPECS}...trunk`;
  const lapAt = (at) => ({ stdout: JSON.stringify([{ context: 'agent-review', state: 'success', description: 'No blocking findings; 2 in all. Booted 2/2.', created_at: at }]) });
  const carriedAt = (at = LAP_AT) => [carriedFixes[0], [carriedFixes[1][0], lapAt(at)], carriedFixes[2]];
  const specsCommit = (status, date) => [SPECS_COMPARE, { stdout: JSON.stringify({ status, base_commit: { sha: `${SPECS}${'0'.repeat(32)}`, commit: { committer: { date } } } }) }];
  const flows = (mtime) => {
    const file = join(repo, '.specify', '.cache', 'qa-flows-141.mjs');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'export default async () => [];\n');
    utimesSync(file, mtime, mtime);
  };
  const SPECS_LINE = `- low: tasks.md missed the T004 line (specs@${SPECS})\n`;
  const FLOWS_LINE = '- low: the 320 px screenshot was taken before the list loaded (qa-flows-141.mjs only)\n';
  const PR_LINE = '- medium: the empty list answered 500 (2222222)\n';

  // @traces 1378-FR-001
  it('under a QA-fixes carry, counts a specs-repo commit on trunk made after the lap', () => {
    comment(`## Fixed after QA\n\n${PR_LINE}${SPECS_LINE}`);
    const h = harness({ answers: [...carriedAt(), specsCommit('ahead', '2026-10-20T11:00:00Z')] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(MERGE));
  });

  // @traces 1378-FR-001
  it('under a QA-fixes carry, counts a change to this PR\'s QA flows file made after the lap', () => {
    comment(`## Fixed after QA\n\n${PR_LINE}${FLOWS_LINE}`);
    flows(new Date('2026-10-20T11:00:00Z'));
    const h = harness({ answers: carriedAt() });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(MERGE));
  });

  // @traces 1378-FR-001
  it('still stops on a line naming nothing, a stale or off-trunk specs commit, or a missing or stale flows file', () => {
    comment(`## Fixed after QA\n\n${PR_LINE}- low: tasks.md missed the T004 line\n`);
    let h = harness({ answers: carriedAt() });
    stoppedBeforeMerge(step(['merge'], h.io), h);

    comment(`## Fixed after QA\n\n${PR_LINE}${SPECS_LINE}`);
    const stopsWith = (answers, reason) => {
      const hh = harness({ answers });
      const result = step(['merge'], hh.io);
      stoppedBeforeMerge(result, hh);
      assert.match(result.fix, reason);
    };
    stopsWith([...carriedAt(), specsCommit('ahead', '2026-10-20T09:00:00Z')], /specs@cafe1234: committed before the lap/);
    stopsWith([...carriedAt(), specsCommit('diverged', '2026-10-20T11:00:00Z')], /specs@cafe1234: off trunk \(diverged\)/);
    stopsWith([...carriedAt(), [SPECS_COMPARE, { code: 1, stdout: '', stderr: 'Not Found' }]], /specs@cafe1234: lookup failed \(Not Found\)/);

    comment(`## Fixed after QA\n\n${PR_LINE}${FLOWS_LINE}`);
    stopsWith(carriedAt(), /qa-flows-141\.mjs: no such file/);
    flows(new Date('2026-10-20T09:00:00Z'));
    stopsWith(carriedAt(), /qa-flows-141\.mjs: not modified after the lap/);
  });

  // @traces 1378-FR-001
  it('counts neither new form when the named lap\'s success carries no time', () => {
    comment(`## Fixed after QA\n\n${PR_LINE}${FLOWS_LINE}`);
    flows(new Date('2026-10-20T11:00:00Z'));
    let h = harness({ answers: carriedFixes });
    stoppedBeforeMerge(step(['merge'], h.io), h);
    comment(`## Fixed after QA\n\n${PR_LINE}${SPECS_LINE}`);
    h = harness({ answers: [...carriedFixes, specsCommit('ahead', '2026-10-20T11:00:00Z')] });
    const result = step(['merge'], h.io);
    stoppedBeforeMerge(result, h);
    assert.match(result.fix, /carries no time/);
  });
});

describe('merge stops the merged worktree test stack', () => {
  beforeEach(() => fixture());

  const diff = ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n' }];
  const WT = '/machine/motor-fix/.claude/worktrees/696-lifecycle-script';
  const viewHead = pullAt({})[1];
  const worktrees = ['git worktree list --porcelain', { stdout: `worktree /machine/motor-fix\nHEAD 1\nbranch refs/heads/main\n\nworktree ${WT}\nHEAD 2\nbranch refs/heads/${BRANCH}\n\nworktree /machine/motor-fix/.claude/worktrees/loose\nHEAD 3\ndetached\n` }];
  const down = (out) => ['node scripts/test-services.ts down', out];
  const stopped = { stdout: '{"project":"mf-test-696-lifecycle-script-abc123","stopped":true}\n' };

  it('stops the stack of the worktree carrying the PR head branch, before the tracker finish, and reports it', () => {
    const h = harness({ answers: [diff, viewHead, worktrees, down(stopped)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const at = h.calls.indexOf(`node scripts/test-services.ts down ${WT}`);
    assert.ok(at > h.calls.indexOf(MERGE), 'after the merge');
    assert.ok(at < h.calls.findIndex((c) => c.includes('tracker-sync.mjs finish')), 'before the finish');
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
    assert.ok(h.calls.some((c) => c.includes('tracker-sync.mjs finish')));
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
    const h = harness({ env: cloud, answers: [diff, ...pullAt({ state: 'closed', merged_at: '2026-10-05T10:00:00Z' }), worktrees, down(stopped)] });
    const result = step(['merge', '--pr', '141', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`${REST}pulls/141 -X GET`));
    assert.ok(h.calls.includes(`node scripts/test-services.ts down ${WT}`));
  });
});

// @traces 977-FR-009
describe('merge removes the merged worktree as its last step', () => {
  beforeEach(() => {
    fixture();
    writeFileSync(join(featureDir, 'handoff.md'), '# Hand-off\n');
  });

  const diff = ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n' }];
  const WT = '/machine/motor-fix/.worktrees/696-lifecycle-script';
  const list = (path, lock = '') => ['git worktree list --porcelain', { stdout: `worktree /machine/motor-fix\nHEAD 1\nbranch refs/heads/main\n\nworktree ${path}\nHEAD 2\nbranch refs/heads/${BRANCH}\n${lock}` }];
  const REMOVE = `node .claude/scripts/worktree-remove.mjs ${WT}`;
  const viewHead = pullAt({})[1];
  const removed = { stdout: `${JSON.stringify({ path: WT, removed: true, backup: { specs: 'pushed', product: 'clean' }, test_stack: { project: 'p', stopped: true } })}\n` };
  const removal = (out) => ['node .claude/scripts/worktree-remove.mjs', out];

  it('removes the branch worktree through the shared removal after the finish comment and the hand-off note', () => {
    const h = harness({ answers: [diff, viewHead, list(WT), removal(removed)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(h.calls.at(-1), REMOVE);
    assert.ok(h.calls.indexOf(REMOVE) > h.calls.findIndex((c) => c.startsWith('gh pr comment 141')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), false);
    assert.equal(result.worktree.removed, true);
    assert.equal(result.worktree.path, WT);
    assert.ok(result.did.includes(`worktree ${WT} removed`), JSON.stringify(result.did));
  });

  it('never removes the checkout it runs in, and says so', () => {
    const h = harness({ answers: [diff, viewHead, list(repo)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.some((c) => c.includes('worktree-remove')));
    assert.deepEqual(result.worktree, { path: repo, removed: false, reason: 'own checkout' });
  });

  it('removes nothing when no worktree carries the branch', () => {
    const h = harness({ answers: [diff, viewHead, ['git worktree list --porcelain', { stdout: 'worktree /machine/motor-fix\nHEAD 1\nbranch refs/heads/main\n' }]] });
    const result = step(['merge'], h.io);
    assert.ok(!h.calls.some((c) => c.includes('worktree-remove')));
    assert.equal(result.worktree.removed, false);
  });

  it('leaves a worktree a live session holds, however long it has been quiet', () => {
    const h = harness({ answers: [diff, viewHead, list(WT, `locked claude agent agent-a1 (pid ${process.pid})\n`)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true);
    assert.ok(!h.calls.some((c) => c.includes('worktree-remove')));
    assert.equal(result.worktree.removed, false);
    assert.match(result.worktree.reason, new RegExp(`held by a live session \\(pid ${process.pid}\\)`));
  });

  it('removes a worktree whose lock names a process that has ended', () => {
    const h = harness({ answers: [diff, viewHead, list(WT, 'locked claude agent agent-a1 (pid 999999)\n'), removal(removed)] });
    const result = step(['merge'], h.io);
    assert.equal(h.calls.at(-1), REMOVE);
    assert.equal(result.worktree.removed, true);
  });

  const mergedAnyway = (result) => {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.worktree.removed, false);
    assert.ok(result.did.some((d) => d.startsWith('worktree not removed: ')), JSON.stringify(result.did));
  };

  it('finishes the merge when the removal refuses, with its reason', () => {
    const h = harness({ answers: [diff, viewHead, list(WT), removal({ code: 1, stdout: `${JSON.stringify({ path: WT, removed: false, reason: 'unpushed commits: 2' })}\n` })] });
    const result = step(['merge'], h.io);
    mergedAnyway(result);
    assert.equal(result.worktree.reason, 'unpushed commits: 2');
  });

  it('finishes the merge when the removal prints nothing it can read, or throws', () => {
    for (const answer of [{ code: 1, stderr: 'boom' }, () => { throw new Error('spawn node ENOENT'); }]) {
      fixture();
      writeFileSync(join(featureDir, 'handoff.md'), '# Hand-off\n');
      const h = harness({ answers: [diff, viewHead, list(WT), removal(answer)] });
      const result = step(['merge'], h.io);
      mergedAnyway(result);
      assert.match(result.worktree.reason, /boom|ENOENT/);
    }
  });

  it('removes nothing when the step stops before its end', () => {
    const h = harness({ answers: [viewHead, list(WT), ['node .claude/scripts/tracker-sync.mjs finish', { code: 1, stdout: 'no token\n' }]] });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false);
    assert.ok(!h.calls.some((c) => c.includes('worktree-remove')));
  });
});

describe('merge in a cloud session: REST only', () => {
  beforeEach(() => {
    fixture();
    writeFileSync(join(featureDir, 'handoff.md'), '# Hand-off\n');
  });

  const cloud = { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' };
  const diff = ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-05 · finish · ST-696 · QA → Done\n' }];
  const merged = pullAt({ state: 'closed', merged_at: '2026-10-05T10:00:00Z' });

  it('reads, merges, reads the merge commit and comments over REST, never through gh pr', () => {
    let merged = false;
    let comment = '';
    const h = harness({
      env: cloud,
      answers: [
        diff,
        [`${REST}pulls/141 -X GET`, () => ({ stdout: JSON.stringify(defaultPull(BRANCH, merged ? { state: 'closed', merged_at: '2026-10-05T10:00:00Z' } : { merge_commit_sha: null })) })],
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
    const h = harness({ env: cloud, refuse: { prefix: 'gh api -X PUT "repos/{owner}/{repo}/pulls/141/merge"', message } });
    const result = step(['merge', '--pr', '141'], h.io);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.fix, message);
    assert.ok(!h.calls.some((c) => c.startsWith('gh api -X PUT')));
    assert.equal(existsSync(join(featureDir, 'handoff.md')), true);
  });

  it('skips the merge on a PR already merged', () => {
    const h = harness({ env: cloud, answers: [diff, ...merged] });
    const result = step(['merge', '--pr', '141', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('gh api -X PUT')));
  });

  // @traces 1323-FR-002
  it('finds the branch PR over REST without --pr', () => {
    const h = harness({ env: cloud, answers: [diff, ...merged] });
    const result = step(['merge', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`${REST}pulls?head={owner}:${BRANCH}&state=all&per_page=100 -X GET --paginate --slurp`), h.calls.join('\n'));
    assert.equal(h.calls.filter((c) => c.startsWith('gh pr ')).length, 0);
  });

  it('keeps the comment for a rerun over REST when posting it fails', () => {
    const h = harness({
      env: cloud,
      answers: [diff, ...merged, ['gh api -X POST repos/{owner}/{repo}/issues/141/comments', { code: 1, stderr: 'HTTP 502' }]],
    });
    const result = step(['merge', '--pr', '141', '--tracker-done'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.then, /^gh api -X POST "repos\/\{owner\}\/\{repo\}\/issues\/141\/comments" -F body=@\S+ && rm/);
  });
});

describe('gates, main and identity', () => {
  beforeEach(() => fixture());

  it('judges every git and gh command with the gates before it runs, in the same order', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '0\n' }], NO_PR] });
    step(['open', '--title', TITLE], h.io);
    // A gh PR read is judged as written, then runs as its REST calls.
    const tools = h.calls.filter((c) => /^(git|gh) /.test(c) && !c.startsWith('gh auth token') && !c.startsWith(REST));
    const gated = h.gated.map((c) => c.replace(/"/g, ''));
    const writes = gated.filter((c) => !/^gh pr (list|view|checks) /.test(c));
    assert.equal(writes.length, tools.length);
    writes.forEach((command, i) => assert.equal(command, tools[i]));
    assert.ok(gated.some((c) => c.startsWith(`gh pr list --head ${BRANCH}`)), gated.join('\n'));
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
      const h = harness({ answers: [['git rev-list', { stdout: '0\n' }], NO_PR, ['git diff --cached --quiet', { code: 1 }]] });
      step(argv, h.io);
      for (const push of h.calls.filter((c) => c.startsWith('git push'))) assert.equal(push, `git push -u origin ${BRANCH}`);
    }
  });

  it('runs gh with the caller GH_TOKEN, or george-hutanu\'s token when unset', () => {
    const own = harness({ answers: [['git rev-list', { stdout: '1\n' }]] });
    step(['open', '--title', TITLE, '--tracker-done'], own.io);
    assert.ok(own.envs.filter((e) => e.cmd.startsWith('gh ')).every((e) => e.env.GH_TOKEN === 'tok-george'));
    assert.ok(!own.calls.includes('gh auth token -u george-hutanu'));

    const none = harness({ env: {}, answers: [['git rev-list', { stdout: '1\n' }]] });
    step(['open', '--title', TITLE, '--tracker-done'], none.io);
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
    assert.match(result.fix, /open \| check \| ready \| merge \| handoff/);
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
    [['merge', '--pr', '--tracker-done'], /--pr needs a value/],
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
    const o = harness({ answers: [['git rev-list', { stdout: '1\n' }], NO_PR, ['gh pr create', (cmd) => { body = cmd.match(/--body-file (\S+)/)[1]; return { code: 1, stderr: 'boom' }; }]] });
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
        ...pullAt({ title: 'fix(web): ST-702 a fix' }),
      ],
    });
    step(['ready', '--body-file', body], h.io);
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-702 feature records -- ${FEATURE}`), h.calls.join('\n'));
  });

  it('removes the draft body temp file after gh pr create', () => {
    let file = '';
    const h = harness({
      answers: [['git rev-list', { stdout: '1\n' }], NO_PR, ['gh pr create', (cmd) => { file = cmd.match(/--body-file (\S+)/)[1]; return { stdout: `${PR_URL}\n` }; }]],
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
    const h = harness({ answers: [['node .claude/scripts/tracker-sync.mjs qa', { code: 1 }]] });
    const result = step(['ready', '--body-file', body, '--decisions', 'keep "x" as is'], h.io);
    assert.equal(result.then, `node .claude/scripts/lifecycle.mjs ready --body-file ${body} --decisions "keep \\"x\\" as is" --tracker-done`);
  });

  it('quotes the title and the body path in the reruns', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['node .claude/scripts/tracker-sync.mjs start', { code: 1 }]] });
    const title = 'feat(api): ST-696 a $HOME `x` "y"';
    assert.equal(step(['open', '--title', title], h.io).then, 'node .claude/scripts/lifecycle.mjs open --title "feat(api): ST-696 a \\$HOME \\`x\\` \\"y\\"" --tracker-done');
    const spaced = join(repo, 'my body.md');
    writeFileSync(spaced, '## Why\n');
    const r = harness({ answers: [['node .claude/scripts/tracker-sync.mjs qa', { code: 1 }]] });
    assert.equal(step(['ready', '--body-file', spaced], r.io).then, `node .claude/scripts/lifecycle.mjs ready --body-file "${spaced}" --tracker-done`);
  });

  it('takes the start commit ST from the title when it has one', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '0\n' }]] });
    step(['open', '--title', 'fix(web): ST-701 a fix', '--tracker-done'], h.io);
    assert.ok(h.calls.includes('git commit --allow-empty -m chore(web): ST-701 start a fix'), h.calls.join('\n'));
  });

  it('stops when gh pr create prints no PR URL', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], NO_PR, ['gh pr create', { stdout: 'something else\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.match(result.stopped, /^gh pr create/);
    assert.ok(!h.calls.some((c) => c.includes('tracker-sync')));
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

  // @traces 1361-FR-006
  it('ready labels the PR qa: on-push before marking it ready, so its pull_request run is the head\'s one QA run', () => {
    let i = 0;
    const h = harness({
      env: CLOUD_ENV,
      answers: [
        ['git diff --cached --quiet', () => ({ code: [1, 1][i++] ?? 0 })],
        [`${API}pulls?head={owner}:${BRANCH}&state=all`, json([[pull]])],
        [`${API}pulls/141 -X GET`, json(pull)],
        [`${API}pulls/141 -X PATCH`, json(pull)],
        [`${API}pulls/141/ccr/ready_for_review -X POST`, json({})],
        [`${API}labels -X POST`, json({})],
        [`${API}issues/141/labels -X POST`, json([])],
        [`${API}issues/141/comments -X POST`, json({})],
      ],
    });
    writeFileSync(join(repo, 'body.md'), '## Why\n\nfilled\n');
    const result = step(['ready', '--body-file', join(repo, 'body.md'), '--decisions', 'none'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    const at = (prefix) => h.gated.findIndex((c) => c.startsWith(prefix));
    const create = at('gh label create "qa: on-push" --force');
    const add = at('gh pr edit 141 --add-label "qa: on-push"');
    assert.notEqual(create, -1, h.gated.join('\n'));
    assert.ok(create < add && add < at('gh pr ready 141'), h.gated.join('\n'));
    assert.ok(h.calls.some((c) => c.startsWith(`${API}issues/141/labels -X POST`)), h.calls.join('\n'));
    assert.deepEqual(graphql(h.calls), []);
  });

  // @traces 1361-FR-006
  it('ready on the laptop adds no qa: on-push label: the dispatched run is the head\'s one run there', () => {
    const h = harness({ answers: [['git diff --cached --quiet', { code: 1 }]] });
    writeFileSync(join(repo, 'body.md'), '## Why\n\nfilled\n');
    const result = step(['ready', '--body-file', join(repo, 'body.md')], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.includes('qa: on-push')), h.calls.join('\n'));
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

  // @traces 1323-FR-001
  it('on the laptop the writes stay gh pr, the reads go over REST', () => {
    const h = harness({ answers: [['git rev-list --count origin/main..HEAD', { stdout: '1\n' }], NO_PR] });
    step(['open', '--title', TITLE], h.io);
    assert.ok(h.calls.some((c) => c.startsWith('gh pr create --draft')));
    const api = h.calls.filter((c) => c.startsWith('gh api'));
    assert.ok(api.length > 0 && api.every((c) => / -X GET( |$)/.test(c)), api.join('\n'));
  });
});

// A branch whose folder number is not its story's: the title must win over the folder.
describe('the story: --story, the PR title, feature.json, then the folder number', () => {
  const OTHER = '854-precompact-pr-signal';
  const T660 = 'fix(harness): ST-660 precompact PR signal';
  const state = () => JSON.parse(readFileSync(join(repo, '.specify', 'feature.json'), 'utf8'));
  const view = (title, props = {}) => pullAt({ number: 244, title, head: { ref: OTHER, sha: 'abcdef1234567890' }, ...props });
  const diff = ['git -C specs diff -U0 --', { stdout: '' }];
  const sideEffects = (calls) => calls.filter((c) => /^(git push|git commit|gh api -X PUT|gh pr ready|gh pr edit|gh pr create|node \.claude\/scripts\/(tracker-sync|specs-repo)\.mjs)/.test(c));

  beforeEach(() => {
    fixture();
    mkdirSync(join(repo, 'specs', OTHER), { recursive: true });
    writeFileSync(join(repo, 'specs', OTHER, 'spec.md'), '# Spec\n');
    // @traces 1037-FR-003
    writeFileSync(join(repo, 'specs', OTHER, 'tracker-sync.md'), '# Tracker sync\n');
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ level: 1, level_for: `specs/${OTHER}`, feature_directory: `specs/${OTHER}` }));
  });

  // @traces 891-FR-001 891-FR-002 891-FR-005
  it('merge finishes the story the PR title names, not the folder number, and never says ST-854', () => {
    const h = harness({ branch: OTHER, answers: [diff, ...view(T660)] });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(h.calls.find((c) => !c.startsWith('git rev-parse') && !c.startsWith('gh auth')), `${REST}pulls?head={owner}:${OTHER}&state=all&per_page=100 -X GET --paginate --slurp`);
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs finish --pr 244 --no-comment --story ST-660'), h.calls.join('\n'));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/tracker-sync.md`), h.calls.join('\n'));
    assert.ok(!h.calls.some((c) => c.includes('ST-854')), h.calls.join('\n'));
  });

  // @traces 891-FR-001 891-FR-005
  it('falls back to the folder number, with no refusal, when no other source names a story', () => {
    const h = harness({ branch: OTHER, answers: [diff, ...view('chore(harness): a title without a story')] });
    const result = step(['merge', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-854 finish -- ${OTHER}/tracker-sync.md`), h.calls.join('\n'));
  });

  // @traces 891-FR-001 891-FR-002
  it('reads the title over REST in a cloud session', () => {
    const rest = view(T660, { state: 'closed', merged_at: '2026-10-05T10:00:00Z' });
    const h = harness({ branch: OTHER, env: { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' }, answers: [diff, ...rest, ['gh api -X POST', {}]] });
    const result = step(['merge', '--pr', '244'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`${REST}pulls/244 -X GET`), h.calls.join('\n'));
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs finish --pr 244 --no-comment --story ST-660'), h.calls.join('\n'));
  });

  // @traces 891-FR-004 891-FR-005
  it('open --story records the story for this feature, keeping the other keys, and a later merge reads it back', () => {
    const o = harness({ branch: OTHER, answers: [['git rev-list', { stdout: '1\n' }], ...view('fix(harness): precompact PR signal')] });
    const opened = step(['open', '--title', 'fix(harness): precompact PR signal', '--story', 'ST-660'], o.io);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.ok(o.calls.includes('node .claude/scripts/tracker-sync.mjs start --pr 244 --story ST-660'), o.calls.join('\n'));
    assert.deepEqual(state(), { level: 1, level_for: `specs/${OTHER}`, feature_directory: `specs/${OTHER}`, story: 'ST-660', story_for: `specs/${OTHER}` });
    const m = harness({ branch: OTHER, answers: [diff, ...view('fix(harness): precompact PR signal')] });
    const merged = step(['merge', '--tracker-done'], m.io);
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.ok(m.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/tracker-sync.md`), m.calls.join('\n'));
  });

  // @traces 891-FR-001 891-FR-004 891-FR-005
  it('ignores a recorded story whose story_for names another feature', () => {
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${OTHER}`, story: 'ST-661', story_for: `specs/${FEATURE}` }));
    const h = harness({ branch: OTHER, answers: [diff, ...view(T660)] });
    const result = step(['merge', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/tracker-sync.md`), h.calls.join('\n'));
  });

  // @traces 891-FR-002 891-FR-003 891-FR-005
  it('merge refuses --story against a title that names another story, before the merge and with feature.json untouched', () => {
    const before = readFileSync(join(repo, '.specify', 'feature.json'), 'utf8');
    const h = harness({ branch: OTHER, answers: [...view('fix(harness): ST-661 something else')] });
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
    const h = harness({ branch: OTHER, answers: [...view(T660)] });
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
    const h = harness({ branch: OTHER, answers: [diff, ...view(T660)] });
    const result = step(['merge', '--story', 'ST-0660', '--tracker-done'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-660 finish -- ${OTHER}/tracker-sync.md`), h.calls.join('\n'));
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

// @traces 1036-FR-013 1036-FR-014
describe('every feature runs tracker-sync.mjs', () => {
  const ISSUE = 'https://github.com/george-hutanu/motor-fix-specs/issues/60';
  let body;
  beforeEach(() => {
    fixture();
    writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696\n');
    writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
    body = join(repo, 'body.md');
    writeFileSync(body, '## Why\n\nfilled\n');
  });
  const staged = ['git diff --cached --quiet', { code: 1 }];
  const tracker = [
    ['node .claude/scripts/tracker-sync.mjs start', { stdout: '{"event":"start"}\n' }],
    ['node .claude/scripts/tracker-sync.mjs qa', { stdout: `{"event":"qa","issue":60,"url":"${ISSUE}"}\n` }],
    ['node .claude/scripts/tracker-sync.mjs finish', { stdout: '{"event":"finish"}\n' }],
  ];

  it('open runs start and pr through tracker-sync.mjs', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ...tracker] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs start --pr 141 --story ST-696'), h.calls.join('\n'));
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs pr 141 --story ST-696'));
  });

  it('a failing tracker-sync stops the step with its output and a --tracker-done rerun', () => {
    const h = harness({ answers: [['git rev-list', { stdout: '1\n' }], ['node .claude/scripts/tracker-sync.mjs start', { code: 64, stderr: 'tracker-sync: bad\n' }]] });
    const result = step(['open', '--title', TITLE], h.io);
    assert.equal(result.ok, false);
    assert.equal(result.stopped, 'tracker-sync start');
    assert.match(result.fix, /tracker-sync: bad/);
    const done = harness({ answers: [['git rev-list', { stdout: '1\n' }]] });
    assert.equal(step(['open', '--title', TITLE, '--tracker-done'], done.io).ok, true);
    assert.ok(!done.calls.some((c) => c.includes('tracker-sync')));
  });

  it('ready runs qa, commits tracker-sync.md and names the issue in handoff.md', () => {
    const h = harness({ answers: [staged, ...tracker] });
    const result = step(['ready', '--body-file', body], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs qa --pr 141 --story ST-696'));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 qa -- ${FEATURE}/tracker-sync.md`), h.calls.join('\n'));
    const note = readFileSync(join(featureDir, 'handoff.md'), 'utf8');
    assert.ok(note.includes(`- Tracker: issue ${ISSUE} (ST-696) · events in specs/${FEATURE}/tracker-sync.md`), note);
  });

  it('merge runs finish and posts the lines tracker-sync.md gained', () => {
    let comment = '';
    const h = harness({
      answers: [
        ['git -C specs diff -U0 --', { stdout: '+++ b/x\n+- 2026-10-10 · finish · ST-696 · QA → Done\n+- 2026-10-10 · ready · EP-6 · no change\n' }],
        ['gh pr comment', (cmd) => { comment = readFileSync(cmd.match(/--body-file (\S+)/)[1], 'utf8'); return {}; }],
        ...tracker,
      ],
    });
    const result = step(['merge'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(h.calls.includes('node .claude/scripts/tracker-sync.mjs finish --pr 141 --no-comment --story ST-696'), h.calls.join('\n'));
    assert.ok(h.calls.includes(`git -C specs diff -U0 -- ${FEATURE}/tracker-sync.md`));
    assert.ok(h.calls.includes(`node .claude/scripts/specs-repo.mjs commit chore(specs): ST-696 finish -- ${FEATURE}/tracker-sync.md`));
    assert.match(comment, /ready · EP-6/);
  });
});
