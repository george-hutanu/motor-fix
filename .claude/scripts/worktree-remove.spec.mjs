// @traces 977-FR-001
// @traces 977-FR-002
// @traces 977-FR-003
// @traces 977-FR-004
// @traces 977-FR-005
// @traces 977-FR-006
// @traces 977-FR-008
// @traces 977-FR-013
import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeWorktree } from './worktree-remove.mjs';

const NOW = new Date(2026, 9, 8, 14, 5, 9);
const BRANCH = '901-some-story';

let base;
let main;
let wt;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'wt-remove-')));
  main = join(base, 'motor-fix');
  wt = join(main, '.worktrees', BRANCH);
  mkdirSync(join(wt, 'specs', '.git'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const porcelain = (extra = '') =>
  `worktree ${main}\nHEAD 1111\nbranch refs/heads/main\n\nworktree ${wt}\nHEAD 2222\n${extra || `branch refs/heads/${BRANCH}`}\n`;

/** A fake `run`: the first answer whose prefix matches wins; every call is recorded. */
function fake(answers = []) {
  const calls = [];
  const table = [
    ...answers,
    ['git -C', (cmd) => (cmd.includes('worktree list --porcelain') ? { stdout: porcelain() } : null)],
    ['git -C', (cmd) => (cmd.endsWith('specs rev-parse --abbrev-ref HEAD') ? { stdout: 'trunk\n' } : null)],
    [`git -C ${wt} rev-list --count HEAD --not --remotes`, { stdout: '0\n' }],
    ['gh pr list', { stdout: JSON.stringify([{ number: 77, state: 'MERGED' }]) }],
    ['node', { stdout: '{"project":"mf-test-x-abc123","stopped":true}\n' }],
  ];
  const run = (file, args, opts = {}) => {
    const cmd = [file, ...args].join(' ');
    calls.push({ cmd, cwd: opts.cwd });
    for (const [prefix, answer] of table) {
      if (!cmd.startsWith(prefix)) continue;
      const out = typeof answer === 'function' ? answer(cmd) : answer;
      if (out) return { code: 0, stdout: '', stderr: '', ...out };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls, cmds: () => calls.map((c) => c.cmd) };
}

const CHANGING = [/ add -A/, /scripts\/test-services\.ts down/, /worktree remove/, /branch -D/, /worktree prune/, /docker volume rm/];
const changing = (cmds) => cmds.filter((c) => CHANGING.some((re) => re.test(c)));
const backfill = () => join(main, '.work', 'worktree-backfill', '2026-10-08');

function opts(f, extra = {}) {
  const commits = [];
  return {
    commits,
    options: {
      run: f.run,
      cwd: main,
      now: NOW,
      commitSpecs: (o) => (commits.push(o), { ok: true, committed: false, pushed: false }),
      ...extra,
    },
  };
}

describe('refusals change nothing', () => {
  const refused = (f, o, result, reason) => {
    assert.equal(result.removed, false, JSON.stringify(result));
    assert.match(result.reason, reason);
    assert.deepEqual(changing(f.cmds()), [], f.cmds().join('\n'));
    assert.deepEqual(o.commits, []);
    assert.equal(existsSync(join(main, '.work')), false);
    assert.equal(existsSync(wt), true);
  };

  it('refuses a path git does not list as a worktree', () => {
    const f = fake();
    const o = opts(f);
    refused(f, o, removeWorktree(join(base, 'elsewhere'), o.options), /^not a worktree$/);
  });

  it('refuses a listed worktree whose folder is gone', () => {
    rmSync(wt, { recursive: true });
    mkdirSync(main, { recursive: true });
    const f = fake([[`git -C ${main} worktree list`, { stdout: porcelain() }]]);
    const o = opts(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.equal(result.reason, 'not a worktree');
    assert.deepEqual(changing(f.cmds()), []);
  });

  it('refuses the main checkout', () => {
    const f = fake();
    const o = opts(f, { cwd: base });
    refused(f, o, removeWorktree(main, o.options), /^main checkout$/);
  });

  it('refuses when it runs from inside the worktree, or below it', () => {
    for (const cwd of [wt, join(wt, 'specs')]) {
      const f = fake();
      const o = opts(f, { cwd });
      refused(f, o, removeWorktree(wt, o.options), /^run from inside the worktree$/);
    }
  });

  it('refuses a worktree locked by a live session or by hand, and goes on past a lock whose process ended', () => {
    const locked = (lock) => fake([['git -C', (cmd) => (cmd.includes('worktree list') ? { stdout: porcelain(`branch refs/heads/${BRANCH}\nlocked ${lock}`) } : null)]]);
    let f = locked(`claude agent agent-a1 (pid ${process.pid} start Sun Oct  4 08:07:18 2026)`);
    let o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), new RegExp(`^locked by a live session \\(pid ${process.pid}\\)$`));
    f = locked('kept while I look at it');
    o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^locked: kept while I look at it$/);
    f = locked('claude agent agent-a1 (pid 999999 start Sun Oct  4 08:07:18 2026)');
    assert.equal(removeWorktree(wt, opts(f, { alive: () => false }).options).removed, true);
  });

  it('admits a live session lock only when the caller says the removal is deliberate, never a hand lock', () => {
    const locked = (lock) => fake([['git -C', (cmd) => (cmd.includes('worktree list') ? { stdout: porcelain(`branch refs/heads/${BRANCH}\nlocked ${lock}`) } : null)]]);
    let f = locked(`claude agent agent-a1 (pid ${process.pid} start Sun Oct  4 08:07:18 2026)`);
    assert.equal(removeWorktree(wt, opts(f, { admitLiveLock: true }).options).removed, true);
    f = locked('kept while I look at it');
    const o = opts(f, { admitLiveLock: true });
    refused(f, o, removeWorktree(wt, o.options), /^locked: kept while I look at it$/);
  });

  it('refuses a worktree whose head has commits on no remote', () => {
    const f = fake([[`git -C ${wt} rev-list --count HEAD --not --remotes`, { stdout: '3\n' }]]);
    const o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^unpushed commits: 3$/);
  });

  it('refuses when the unpushed count cannot be read', () => {
    const f = fake([[`git -C ${wt} rev-list`, { code: 128, stderr: 'fatal: bad HEAD' }]]);
    const o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^unpushed commits: unknown/);
  });

  it('refuses a worktree whose PR is open, even beside an older closed one', () => {
    const f = fake([['gh pr list', { stdout: JSON.stringify([{ number: 80, state: 'CLOSED' }, { number: 79, state: 'OPEN' }]) }]]);
    const o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^PR #79 open$/);
    assert.ok(f.cmds().some((c) => c.startsWith(`gh pr list --state all --head ${BRANCH}`)));
  });

  it('refuses when gh fails or prints nothing it can read', () => {
    for (const answer of [{ code: 1, stderr: 'HTTP 502' }, { stdout: 'garbage' }]) {
      const f = fake([['gh pr list', answer]]);
      const o = opts(f);
      refused(f, o, removeWorktree(wt, o.options), /^PR state unreadable/);
    }
  });

  it('refuses a worktree with no PR unless the caller admits it', () => {
    const f = fake([['gh pr list', { stdout: '[]' }]]);
    const o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^no PR$/);
  });

  it('treats a detached head as no PR: refused unless admitted, and asks gh nothing', () => {
    const f = fake([['git -C', (cmd) => (cmd.includes('worktree list') ? { stdout: porcelain('detached') } : null)]]);
    const o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^no PR$/);
    assert.ok(!f.cmds().some((c) => c.startsWith('gh ')));
  });

  it('refuses when the worktree list cannot be read', () => {
    const f = fake([['git -C', (cmd) => (cmd.includes('worktree list') ? { code: 128, stderr: 'fatal' } : null)]]);
    const o = opts(f);
    refused(f, o, removeWorktree(wt, o.options), /^not a worktree/);
  });
});

describe('backup', () => {
  it('commits and pushes the specs clone through specs-repo with the backfill message', () => {
    const f = fake();
    const o = opts(f, { commitSpecs: (x) => (o.commits.push(x), { ok: true, committed: true, pushed: true }) });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.deepEqual(o.commits, [{ root: wt, message: `chore(specs): backfill ${BRANCH} before removal` }]);
    assert.equal(result.backup.specs, 'pushed');
  });

  it('says there was nothing to back up when specs-repo committed and pushed nothing', () => {
    const f = fake();
    const o = opts(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.backup.specs, 'nothing to back up');
  });

  it('writes the specs difference from origin/trunk as a patch when the push fails', () => {
    const f = fake([[`git -C ${join(wt, 'specs')} diff --binary --cached origin/trunk`, { stdout: 'diff --git a/x b/x\n+note\n' }]]);
    const o = opts(f, { commitSpecs: () => ({ ok: false, error: 'push refused' }) });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true, JSON.stringify(result));
    const file = join(backfill(), `${BRANCH}-140509.specs.patch`);
    assert.equal(result.backup.specs, `patch ${file}`);
    assert.equal(readFileSync(file, 'utf8'), 'diff --git a/x b/x\n+note\n');
    const cmds = f.cmds();
    assert.ok(cmds.indexOf(`git -C ${join(wt, 'specs')} add -A`) < cmds.indexOf(`git -C ${join(wt, 'specs')} diff --binary --cached origin/trunk`));
  });

  it('refuses the removal, touching nothing else, when the push and the specs patch both fail', () => {
    const f = fake([[`git -C ${join(wt, 'specs')} diff`, { code: 128, stderr: 'fatal: bad revision origin/trunk' }]]);
    const o = opts(f, { commitSpecs: () => ({ ok: false, error: 'push refused' }) });
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^backup failed: .*origin\/trunk/);
    const cmds = f.cmds();
    assert.ok(!cmds.some((c) => /test-services|worktree remove|branch -D|worktree prune/.test(c)), cmds.join('\n'));
    assert.equal(existsSync(wt), true);
  });

  it('skips the specs backup for a worktree with no specs clone, and says so', () => {
    rmSync(join(wt, 'specs'), { recursive: true });
    const f = fake();
    const o = opts(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.removed, true);
    assert.equal(result.backup.specs, 'none');
    assert.deepEqual(o.commits, []);
  });

  it('saves uncommitted product changes, untracked ones included, as a patch on the head', () => {
    const f = fake([[`git -C ${wt} diff --binary HEAD`, { stdout: 'diff --git a/apps/x.ts b/apps/x.ts\n' }]]);
    const o = opts(f);
    const result = removeWorktree(wt, o.options);
    const file = join(backfill(), `${BRANCH}-140509.product.patch`);
    assert.equal(result.backup.product, `patch ${file}`);
    assert.equal(readFileSync(file, 'utf8'), 'diff --git a/apps/x.ts b/apps/x.ts\n');
    const cmds = f.cmds();
    assert.ok(cmds.indexOf(`git -C ${wt} add -A --intent-to-add`) < cmds.indexOf(`git -C ${wt} diff --binary HEAD`));
  });

  it('writes no product file for a clean tree, and says so', () => {
    const f = fake();
    const o = opts(f);
    const result = removeWorktree(wt, o.options);
    assert.equal(result.backup.product, 'clean');
    assert.equal(existsSync(backfill()), false);
  });

  it('never overwrites an earlier patch of the same name and time', () => {
    mkdirSync(backfill(), { recursive: true });
    writeFileSync(join(backfill(), `${BRANCH}-140509.product.patch`), 'earlier\n');
    const f = fake([[`git -C ${wt} diff --binary HEAD`, { stdout: 'later\n' }]]);
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(readFileSync(join(backfill(), `${BRANCH}-140509.product.patch`), 'utf8'), 'earlier\n');
    assert.equal(readdirSync(backfill()).length, 2);
    assert.match(result.backup.product, /140509-1\.product\.patch$/);
  });

  it('refuses, keeping the worktree, when every patch name for that second is taken', () => {
    mkdirSync(backfill(), { recursive: true });
    for (let i = 0; i < 1000; i++) writeFileSync(join(backfill(), `${BRANCH}-140509${i ? `-${i}` : ''}.product.patch`), 'earlier\n');
    const f = fake([[`git -C ${wt} diff --binary HEAD`, { stdout: 'later\n' }]]);
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^backup failed: no free name for /);
    assert.ok(!f.cmds().some((c) => /test-services|worktree remove|branch -D/.test(c)));
  });

  it('refuses the removal when the product diff cannot be read', () => {
    const f = fake([[`git -C ${wt} diff --binary HEAD`, { code: 128, stderr: 'fatal: index locked' }]]);
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /^backup failed: .*index locked/);
    assert.ok(!f.cmds().some((c) => /test-services|worktree remove|branch -D/.test(c)));
  });
});

describe('the stack and the removal', () => {
  it('takes the stack down with volumes from the worktree, then removes, deletes the branch and prunes, in order', () => {
    const f = fake();
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(result.path, wt);
    assert.equal(result.reason, undefined);
    assert.deepEqual(result.test_stack, { project: 'mf-test-x-abc123', stopped: true });
    const cmds = f.cmds();
    const at = (re) => cmds.findIndex((c) => re.test(c));
    const down = f.calls[at(/test-services\.ts down/)];
    assert.match(down.cmd, new RegExp(`scripts/test-services\\.ts down ${wt} --volumes$`));
    assert.equal(down.cwd, wt);
    assert.ok(at(/ add -A --intent-to-add/) < at(/test-services/));
    assert.ok(at(/test-services/) < at(/worktree remove --force --force /));
    assert.ok(cmds.includes(`git -C ${main} worktree remove --force --force ${wt}`), cmds.join('\n'));
    assert.ok(at(/worktree remove/) < at(/branch -D/));
    assert.ok(cmds.includes(`git -C ${main} branch -D ${BRANCH}`));
    assert.ok(at(/branch -D/) < at(/worktree prune/));
    assert.equal(cmds.at(-1), `git -C ${main} worktree prune`);
  });

  it('removes a closed PR worktree as well as a merged one', () => {
    const f = fake([['gh pr list', { stdout: JSON.stringify([{ number: 77, state: 'CLOSED' }]) }]]);
    assert.equal(removeWorktree(wt, opts(f).options).removed, true);
  });

  it('removes a no-PR worktree when the caller admits it', () => {
    const f = fake([['gh pr list', { stdout: '[]' }]]);
    assert.equal(removeWorktree(wt, opts(f, { admitNoPr: true }).options).removed, true);
  });

  it('skips the branch delete on a detached head and says so', () => {
    const f = fake([['git -C', (cmd) => (cmd.includes('worktree list') ? { stdout: porcelain('detached') } : null)]]);
    const result = removeWorktree(wt, opts(f, { admitNoPr: true }).options);
    assert.equal(result.removed, true);
    assert.equal(result.branch, 'detached: no branch deleted');
    assert.ok(!f.cmds().some((c) => c.includes('branch -D')));
  });

  it('goes on when Docker is absent or the down fails, and reports it', () => {
    for (const answer of [
      { stdout: '{"project":"mf-test-x","stopped":false,"reason":"docker unavailable"}\n' },
      { code: 1, stderr: 'node: boom\n' },
      { stdout: 'garbage\n' },
    ]) {
      const f = fake([['node', answer]]);
      const result = removeWorktree(wt, opts(f).options);
      assert.equal(result.removed, true, JSON.stringify(result));
      assert.equal(result.test_stack.stopped, false);
      assert.ok(result.test_stack.reason);
    }
  });

  it('goes on when the stack command throws', () => {
    const f = fake([['node', () => { throw new Error('spawn node ENOENT'); }]]);
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(result.removed, true);
    assert.match(result.test_stack.reason, /ENOENT/);
  });

  it('stops at the first failing step with the backup and stack kept in the result, and never retries', () => {
    const f = fake([[`git -C ${main} worktree remove`, { code: 128, stderr: 'fatal: busy' }]]);
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /worktree remove.*busy/);
    assert.equal(result.backup.product, 'clean');
    assert.equal(result.test_stack.stopped, true);
    const cmds = f.cmds();
    assert.equal(cmds.filter((c) => c.includes('worktree remove')).length, 1);
    assert.ok(!cmds.some((c) => c.includes('branch -D') || c.includes('worktree prune')));
  });

  it('reports a branch that would not delete as not removed, and does not prune', () => {
    const f = fake([[`git -C ${main} branch -D`, { code: 1, stderr: 'error: branch not found' }]]);
    const result = removeWorktree(wt, opts(f).options);
    assert.equal(result.removed, false);
    assert.match(result.reason, /branch -D.*not found/);
    assert.ok(!f.cmds().some((c) => c.includes('worktree prune')));
  });
});

describe('the command', () => {
  const cli = join(import.meta.dirname, 'worktree-remove.mjs');

  it('prints one JSON line and exits 1 for a refusal', () => {
    const r = spawnSync(process.execPath, [cli, join(base, 'nowhere')], { encoding: 'utf8', cwd: base });
    assert.equal(r.status, 1, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { path: join(base, 'nowhere'), removed: false, reason: 'not a worktree' });
  });

  it('exits 2 with its usage when the path is missing or a flag is unknown', () => {
    for (const args of [[], [wt, '--admit-no-pr']]) {
      const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: base });
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /usage/i);
    }
  });

  it('refuses a real worktree from the command and leaves it in place', () => {
    const repo = join(base, 'real');
    const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    git('worktree', 'add', '-q', '-b', 'loose', join(repo, '.worktrees', 'loose'));
    const r = spawnSync(process.execPath, [cli, join(repo, '.worktrees', 'loose')], { encoding: 'utf8', cwd: repo, env: { ...process.env, GH_TOKEN: 'x', GH_HOST: 'invalid.localhost' } });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).removed, false);
    assert.equal(existsSync(join(repo, '.worktrees', 'loose')), true);
  });

  it('from the command, goes past a live session lock (the tail removing its own worktree) but not a hand lock', () => {
    const repo = join(base, 'locks');
    const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const cli1 = (name, reason) => {
      git('worktree', 'add', '-q', '-b', name, join(repo, '.worktrees', name));
      git('worktree', 'lock', '--reason', reason, join(repo, '.worktrees', name));
      const r = spawnSync(process.execPath, [cli, join(repo, '.worktrees', name)], { encoding: 'utf8', cwd: repo });
      return JSON.parse(r.stdout).reason;
    };
    assert.doesNotMatch(cli1('live', `claude agent agent-a1 (pid ${process.pid} start Sun Oct  4 08:07:18 2026)`), /^locked/);
    assert.equal(cli1('hand', 'kept while I look at it'), 'locked: kept while I look at it');
  });
});

// @traces 977-FR-011
// @traces 977-FR-012
describe('the docs name the one removal', () => {
  const root = join(import.meta.dirname, '..', '..');
  const read = (p) => readFileSync(join(root, p), 'utf8');

  it('AGENTS.md states the rule, and the tail and the watch skill run the shared command', () => {
    const agents = read('AGENTS.md');
    assert.match(agents, /A worktree goes once its PR merges or closes, or after 7 idle days with no\s+PR/);
    assert.match(agents, /\.claude\/scripts\/worktree-remove\.mjs/);
    assert.match(read('.claude/skills/speckit-auto/tail.md'), /`ExitWorktree` \(keep\) and run\s+`node <worktree>\/\.claude\/scripts\/worktree-remove\.mjs <worktree>` from the\s+main checkout/);
    assert.match(read('.claude/skills/speckit-watch/SKILL.md'), /`remove`: worktrees whose PR merged or closed[\s\S]*worktree-remove\.mjs/);
  });
});
