import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from './watch.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-10-04T12:00:00Z');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-adv-')));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  mkdirSync(join(repo, '.specify'));
  writeFileSync(join(repo, '.specify', '.gitignore'), 'feature.json\n');
  writeFileSync(join(repo, '.gitignore'), '.specify/**/.cache/\n.specify/run-state.json\n');
  git(repo, 'add', '.');
  const at = new Date(NOW).toISOString();
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at } });
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(repo, 'remote', 'add', 'origin', join(root, 'origin.git'));
  git(repo, 'push', '-q', 'origin', 'main');
  const add = (name, branch) => {
    const path = join(root, name);
    git(repo, 'worktree', 'add', '-q', '-b', branch, path);
    return path;
  };
  return { root, repo, add };
}

const quietCommit = (path, minutesAgo) => {
  const date = new Date(NOW - minutesAgo * MIN).toISOString();
  writeFileSync(join(path, `f${minutesAgo}.txt`), 'x\n');
  git(path, 'add', '.');
  execFileSync('git', ['commit', '-q', '-m', 'w'], { cwd: path, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
  git(path, 'push', '-q', 'origin', 'HEAD');
};

const env = (over = {}) => ({ now: NOW, gh: () => [], alive: (pid) => pid === 4242, pidAlive: () => false, claudeDir: '/nonexistent/claude', remove: (path) => ({ path, removed: false, reason: 'not run in tests' }), ...over });
const slug = (path) => path.replace(/[^A-Za-z0-9]/g, '-');

const transcript = (claudeDir, project, session, file, minutesAgo) => {
  const dir = join(claudeDir, 'projects', project, session, 'subagents');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, '{}\n');
  utimesSync(path, new Date(NOW - minutesAgo * MIN), new Date(NOW - minutesAgo * MIN));
};

const lockedAgent = (f, name, branch = '912-adv') => {
  const a = f.add('agent-adv', branch);
  quietCommit(a, 120);
  git(f.repo, 'worktree', 'lock', '--reason', `claude agent ${name} (pid 4242 start Sun Oct  4 08:07:18 2026)`, a);
  return a;
};

const rowOf = (f, a, deps) => collect(f.repo, deps).rows.find((x) => x.path === a);

describe('a subagent transcript, attacked', () => {
  it('does not look up a lock name that carries a dot, even when a transcript of that exact name is fresh', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agent.tx');
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent.tx.jsonl', 5);
      const r = rowOf(f, a, env({ claudeDir }));
      assert.equal(r.holder, 'none');
      assert.equal(r.fix, 'resume');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('does not look up a lock name that climbs out of the subagents folder', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, '../subagents/agent-tx');
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 5);
      assert.equal(rowOf(f, a, env({ claudeDir })).holder, 'none');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  // git's porcelain quotes a non-ASCII lock reason, so the holder of such a lock is
  // 464-FR-003's to judge; what this feature owes is that no transcript is read for it.
  it('does not look up a unicode lock name', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agént-1');
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agént-1.jsonl', 5);
      assert.notEqual(rowOf(f, a, env({ claudeDir })).activity.source, 'transcript');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('accepts a name made of letters, digits, underscore and hyphen', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'Agent_9-x');
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'Agent_9-x.jsonl', 5);
      const r = rowOf(f, a, env({ claudeDir }));
      assert.equal(r.holder, 'live');
      assert.equal(r.activity.source, 'transcript');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('counts the newest transcript when several sessions hold the same agent name, whatever their folder order', () => {
    for (const [oldSession, newSession] of [['a-old', 'z-new'], ['z-old', 'a-new']]) {
      const f = fixture();
      try {
        const a = lockedAgent(f, 'agent-tx');
        const claudeDir = join(f.root, 'claude');
        transcript(claudeDir, slug(f.repo), oldSession, 'agent-tx.jsonl', 300);
        transcript(claudeDir, slug(f.repo), newSession, 'agent-tx.jsonl', 5);
        const r = rowOf(f, a, env({ claudeDir }));
        assert.equal(r.holder, 'live', `${oldSession}/${newSession}`);
        assert.equal(r.activity.at, NOW - 5 * MIN, `${oldSession}/${newSession}`);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    }
  });

  it('counts the newest transcript across several project folders of the same checkout', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agent-tx');
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 300);
      transcript(claudeDir, slug(join(f.repo, '.worktrees', 'w')), 's2', 'agent-tx.jsonl', 5);
      assert.equal(rowOf(f, a, env({ claudeDir })).activity.at, NOW - 5 * MIN);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('does not read a transcript under a sibling repository whose slug begins with this one', () => {
    for (const sibling of ['repo-two', 'repo2']) {
      const f = fixture();
      try {
        const a = lockedAgent(f, 'agent-tx');
        const claudeDir = join(f.root, 'claude');
        transcript(claudeDir, slug(join(f.root, sibling)), 's1', 'agent-tx.jsonl', 5);
        const r = rowOf(f, a, env({ claudeDir }));
        assert.equal(r.holder, 'none', sibling);
        assert.equal(r.fix, 'resume', sibling);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    }
  });

  it('counts a transcript dated after now as activity at its time', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agent-tx');
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', -10);
      const r = rowOf(f, a, env({ claudeDir }));
      assert.equal(r.holder, 'live');
      assert.equal(r.activity.at, NOW + 10 * MIN);
      assert.equal(r.activity.source, 'transcript');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('never matches a session lock to a transcript', () => {
    const f = fixture();
    try {
      const a = f.add('agent-adv', '912-adv');
      quietCommit(a, 120);
      git(f.repo, 'worktree', 'lock', '--reason', 'claude session agent-tx (pid 4242 start Sun Oct  4 08:07:18 2026)', a);
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 5);
      assert.notEqual(rowOf(f, a, env({ claudeDir })).activity.source, 'transcript');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('never matches a lock set by hand to a transcript', () => {
    const f = fixture();
    try {
      const a = f.add('agent-adv', '912-adv');
      quietCommit(a, 120);
      git(f.repo, 'worktree', 'lock', '--reason', 'agent-tx', a);
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 5);
      assert.notEqual(rowOf(f, a, env({ claudeDir })).activity.source, 'transcript');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('keeps a closer-phase claude agent lock holding nothing whatever its fresh transcript', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agent-tx');
      quietCommit(a, 1);
      writeFileSync(join(a, '.specify', 'run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'closer', updated: new Date(NOW - MIN).toISOString() }));
      const claudeDir = join(f.root, 'claude');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 1);
      const r = rowOf(f, a, env({ claudeDir }));
      assert.equal(r.holder, 'none');
      assert.equal(r.fix, 'resume');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reads the pass as before when the Claude directory is unreadable', () => {
    const f = fixture();
    const claudeDir = join(f.root, 'claude');
    try {
      const a = lockedAgent(f, 'agent-tx');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 5);
      chmodSync(join(claudeDir, 'projects'), 0o000);
      const r = rowOf(f, a, env({ claudeDir }));
      assert.equal(r.holder, 'none');
      assert.equal(r.fix, 'resume');
    } finally {
      chmodSync(join(claudeDir, 'projects'), 0o755);
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reads the pass as before when a project folder is unreadable', () => {
    const f = fixture();
    const claudeDir = join(f.root, 'claude');
    try {
      const a = lockedAgent(f, 'agent-tx');
      transcript(claudeDir, slug(f.repo), 's1', 'agent-tx.jsonl', 5);
      chmodSync(join(claudeDir, 'projects', slug(f.repo)), 0o000);
      assert.equal(rowOf(f, a, env({ claudeDir })).holder, 'none');
    } finally {
      chmodSync(join(claudeDir, 'projects', slug(f.repo)), 0o755);
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reads the pass as before when the Claude directory is a file', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agent-tx');
      const claudeDir = join(f.root, 'claude-file');
      writeFileSync(claudeDir, 'not a directory');
      assert.equal(rowOf(f, a, env({ claudeDir })).holder, 'none');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reads the pass as before when the transcript is a directory named like the file', () => {
    const f = fixture();
    try {
      const a = lockedAgent(f, 'agent-tx');
      const claudeDir = join(f.root, 'claude');
      mkdirSync(join(claudeDir, 'projects', slug(f.repo), 's1', 'subagents', 'agent-tx.jsonl'), { recursive: true });
      assert.equal(rowOf(f, a, env({ claudeDir })).holder, 'none');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
