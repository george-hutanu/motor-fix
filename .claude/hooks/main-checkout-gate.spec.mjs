import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The main checkout is a mirror of origin/main: an edit to a file git tracks
// there blocks the fast-forward that keeps it current (ST-1035). The gate
// refuses that edit and nothing else: worktrees, untracked and ignored paths,
// other repositories (the specs clone) and the owner's override go through,
// and a git failure never refuses.

const HOOK = new URL('./main-checkout-gate.mjs', import.meta.url).pathname;

let scratch;
let repo;
let wt;
let cloud;
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

const commitAll = (dir, files) => {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
};

const baseEnv = () => {
  const env = { ...process.env };
  delete env.SPECKIT_ALLOW_MAIN_EDIT;
  delete env.CLAUDE_CODE_REMOTE;
  return env;
};

/** Run the gate as Claude Code would: the payload on stdin, the session's checkout in CLAUDE_PROJECT_DIR. */
const gate = ({ session = repo, input, tool = 'Edit', env = {}, cwd = session }) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: input }),
    cwd,
    encoding: 'utf8',
    env: { ...baseEnv(), CLAUDE_PROJECT_DIR: session, ...env },
  });

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'main-checkout-gate-')));
  repo = join(scratch, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commitAll(repo, { 'README.md': 'hi\n', 'docs/a.md': 'a\n', 'nb.ipynb': '{}\n', '.gitignore': '.work/\n/specs\n' });

  wt = join(scratch, 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);

  const specs = join(scratch, 'specs-clone');
  mkdirSync(specs);
  git(specs, 'init', '-q', '-b', 'trunk');
  commitAll(specs, { 'x.md': 'x\n' });
  symlinkSync(specs, join(repo, 'specs'));

  cloud = join(scratch, 'cloud');
  mkdirSync(cloud);
  git(cloud, 'init', '-q', '-b', 'main');
  commitAll(cloud, { 'README.md': 'hi\n' });
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('main checkout gate — refuses', () => {
  // @traces 1035-FR-001
  it('an edit to a tracked file in the main checkout, naming the file, the rule and the override', () => {
    const run = gate({ input: { file_path: join(repo, 'README.md') } });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /main-checkout-gate/);
    assert.match(run.stderr, /README\.md/);
    assert.match(run.stderr, /PR from a worktree/);
    assert.match(run.stderr, /SPECKIT_ALLOW_MAIN_EDIT=1/);
  });

  it('a Write given a path relative to the session', () => {
    assert.equal(gate({ tool: 'Write', input: { file_path: 'docs/a.md', content: 'b\n' } }).status, 2);
  });

  it('a NotebookEdit, read from notebook_path', () => {
    assert.equal(gate({ tool: 'NotebookEdit', input: { notebook_path: join(repo, 'nb.ipynb') } }).status, 2);
  });

  it("a worktree session's edit to the main checkout's file by absolute path", () => {
    assert.equal(gate({ session: wt, input: { file_path: join(repo, 'README.md') } }).status, 2);
  });

  it('any value of the override but 1', () => {
    assert.equal(gate({ input: { file_path: join(repo, 'README.md') }, env: { SPECKIT_ALLOW_MAIN_EDIT: 'true' } }).status, 2);
  });
});

describe('main checkout gate — lets through', () => {
  // @traces 1035-FR-002
  const passes = (args) => {
    const run = gate(args);
    assert.equal(run.status, 0, run.stderr);
    return run;
  };

  it('a tracked file in a worktree', () => {
    passes({ session: wt, input: { file_path: join(wt, 'README.md') } });
  });

  it("a main-checkout session's edit to a worktree's file", () => {
    passes({ input: { file_path: join(wt, 'docs/a.md') } });
  });

  it('a new file, an ignored one and one under a missing directory', () => {
    passes({ input: { file_path: join(repo, 'new.md') } });
    passes({ input: { file_path: join(repo, 'docs', 'new.md') } });
    passes({ input: { file_path: join(repo, '.work/notes/x.md') } });
    passes({ input: { file_path: join(repo, 'missing/deeper/file.md') } });
  });

  it('a file in the specs clone, reached through the specs symlink', () => {
    passes({ input: { file_path: join(repo, 'specs', 'x.md') } });
  });

  it('the owner override, saying once that it is in force', () => {
    const run = passes({ input: { file_path: join(repo, 'README.md') }, env: { SPECKIT_ALLOW_MAIN_EDIT: '1' } });
    assert.match(run.stderr, /SPECKIT_ALLOW_MAIN_EDIT/);
    assert.equal(run.stderr.trim().split('\n').length, 1);
  });

  it('a cloud session on its story branch, but not on main', () => {
    assert.equal(gate({ session: cloud, input: { file_path: join(cloud, 'README.md') }, env: { CLAUDE_CODE_REMOTE: 'true' } }).status, 2);
    git(cloud, 'checkout', '-q', '-b', 'story');
    try {
      passes({ session: cloud, input: { file_path: join(cloud, 'README.md') }, env: { CLAUDE_CODE_REMOTE: 'true' } });
    } finally {
      git(cloud, 'checkout', '-q', 'main');
    }
  });
});

describe('main checkout gate — fails open', () => {
  // @traces 1035-FR-003
  it('with no path in the payload', () => {
    assert.equal(gate({ input: {} }).status, 0);
  });

  it('when git cannot run', () => {
    const empty = join(scratch, 'no-git');
    mkdirSync(empty, { recursive: true });
    assert.equal(gate({ input: { file_path: join(repo, 'README.md') }, env: { PATH: empty } }).status, 0);
  });

  it('outside any repository', () => {
    const plain = join(scratch, 'plain');
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'f.md'), 'f\n');
    assert.equal(gate({ session: plain, input: { file_path: join(plain, 'f.md') } }).status, 0);
    assert.equal(gate({ input: { file_path: join(plain, 'f.md') } }).status, 0);
  });

  it('in well under two seconds', () => {
    const started = Date.now();
    gate({ input: { file_path: join(repo, 'README.md') } });
    assert.ok(Date.now() - started < 2000);
  });
});

describe('main checkout gate — wiring', () => {
  const claude = join(import.meta.dirname, '..');
  const root = join(claude, '..');

  // @traces 1035-FR-004
  it('is registered as a refusing pre-edit gate for every edit tool and called from settings', () => {
    const { hooks } = JSON.parse(readFileSync(join(claude, 'hooks', 'registry.json'), 'utf8'));
    const entry = hooks.find((h) => h.id === 'pre:edit:main-checkout');
    assert.ok(entry, 'no registry entry');
    assert.equal(entry.event, 'PreToolUse');
    assert.equal(entry.matcher, 'Edit|Write|MultiEdit|NotebookEdit');
    assert.equal(entry.script, 'main-checkout-gate.mjs');
    assert.deepEqual(entry.profiles, ['standard', 'strict']);
    assert.equal(entry.fail_closed, true);
    const groups = JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).hooks.PreToolUse;
    const group = groups.find((g) => g.hooks.some((h) => h.command.endsWith('run-hook.mjs pre:edit:main-checkout')));
    assert.equal(group?.matcher, 'Edit|Write|MultiEdit|NotebookEdit');
  });

  // @traces 1035-FR-008
  it('is described where the lifecycle and the watch are', () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const seventh = agents.slice(agents.indexOf('  7. Merge on'), agents.indexOf('  Technical debt'));
    assert.match(seventh, /git -C <main> merge --ff-only origin\/main/);
    assert.match(seventh, /ff-main/);
    const watch = readFileSync(join(claude, 'skills', 'speckit-watch', 'SKILL.md'), 'utf8');
    assert.doesNotMatch(watch, /shown, never fixed/);
    assert.match(watch, /`behind` \(fix `ff-main`/);
    assert.match(watch, /`dirty: <files>`/);
  });

  // @traces 1035-FR-010
  it('has its eval cases: a tracked file refused, a new file let through', () => {
    const file = join(claude, 'evals', 'cases', 'main-checkout-gate.json');
    assert.ok(existsSync(file));
    const cases = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(cases.map((c) => [c.hook, c.expect.exit]), [['pre:edit:main-checkout', 2], ['pre:edit:main-checkout', 0]]);
  });
});
