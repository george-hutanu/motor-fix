import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gcScan,
  hookCandidates,
  instinctCandidates,
  permissionCandidates,
  skillAndAgentCandidates,
  telemetryCandidates,
  trashCandidates,
} from './gc-scan.mjs';
import { saveInstinct } from './instincts.mjs';

// GC proposes; it never deletes. The property worth pinning hardest is the
// silence rule: with no telemetry recorded, "never invoked" is not a claim this
// scan is allowed to make.

let repo;
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
  return file;
};
const paths = (candidates) => candidates.map((c) => c.path);
const age = (file, days) => {
  const when = new Date(Date.now() - days * 86400000);
  utimesSync(file, when, when);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gc-'));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('gc-scan — skills and agents', () => {
  const ledger = (skills) =>
    write(`.specify/telemetry/s1.json`, { session_id: 's1', turns: 1, skills, agents: {}, tools: {}, tokens: {} });

  it('says nothing when no session was ever recorded', () => {
    mkdirSync(join(repo, '.claude/skills/never-used'), { recursive: true });
    assert.deepEqual(skillAndAgentCandidates(repo), []);
  });

  it('proposes a skill that no recorded session invoked', () => {
    mkdirSync(join(repo, '.claude/skills/used'), { recursive: true });
    mkdirSync(join(repo, '.claude/skills/unused'), { recursive: true });
    write('.claude/agents/quiet.md', '---\nname: quiet\n---\n');
    ledger({ used: 3 });
    assert.deepEqual(paths(skillAndAgentCandidates(repo)), ['.claude/skills/unused', '.claude/agents/quiet.md']);
  });

  it('proposes disabling rather than deleting', () => {
    mkdirSync(join(repo, '.claude/skills/unused'), { recursive: true });
    ledger({});
    assert.equal(skillAndAgentCandidates(repo)[0].action, 'disable');
  });
});

describe('gc-scan — hooks and permissions', () => {
  it('proposes a hook script no registry entry names', () => {
    write('.claude/hooks/registry.json', { hooks: [{ id: 'a:b', script: 'live.mjs' }], helpers: [{ script: 'helper.js' }] });
    write('.claude/hooks/live.mjs', '// live\n');
    write('.claude/hooks/helper.js', '// helper\n');
    write('.claude/hooks/run-hook.mjs', '// wrapper\n');
    write('.claude/hooks/forgotten.sh', '# orphan\n');
    assert.deepEqual(paths(hookCandidates(repo)), ['.claude/hooks/forgotten.sh']);
  });

  it('finds duplicate and already-covered permission entries', () => {
    const found = permissionCandidates({
      permissions: { allow: ['Bash(npm test)', 'Bash(npm test)', 'Bash(git status:*)', 'Bash(git status --short)'] },
    });
    assert.equal(found.filter((c) => c.why === 'duplicate entry').length, 1);
    assert.ok(found.some((c) => /already covered by/.test(c.why)));
  });

  it('leaves a tidy allow-list alone', () => {
    assert.deepEqual(permissionCandidates({ permissions: { allow: ['Bash(npm test)', 'Bash(npm run lint)'] } }), []);
  });
});

describe('gc-scan — instincts, telemetry, trash', () => {
  it('proposes retired and faded instincts only', () => {
    const base = { trigger: 't', domain: 'd', scope: 'project', created: '2026-01-01', last_seen: '2026-01-01', reinforced: 1, action: 'a', evidence: [] };
    saveInstinct(repo, { ...base, id: 'strong', confidence: 0.8, status: 'active' });
    saveInstinct(repo, { ...base, id: 'faded', confidence: 0.2, status: 'active' });
    saveInstinct(repo, { ...base, id: 'done', confidence: 0.9, status: 'retired' });
    assert.deepEqual(paths(instinctCandidates(repo)).sort(), [
      '.specify/memory/instincts/done.md',
      '.specify/memory/instincts/faded.md',
    ]);
  });

  it('proposes only telemetry older than the window', () => {
    const fresh = write('.specify/telemetry/fresh.json', { session_id: 'fresh' });
    const old = write('.specify/telemetry/old.json', { session_id: 'old' });
    age(old, 200);
    age(fresh, 1);
    assert.deepEqual(paths(telemetryCandidates(repo)), ['.specify/telemetry/old.json']);
  });

  it('proposes emptying trash only past the undo window', () => {
    const recent = write('.specify/_gc_trash/2026-09-01-thing', 'x');
    const ancient = write('.specify/_gc_trash/2026-01-01-thing', 'x');
    age(recent, 2);
    age(ancient, 90);
    assert.deepEqual(paths(trashCandidates(repo)), ['.specify/_gc_trash/2026-01-01-thing']);
  });
});

describe('gc-scan — the whole sweep', () => {
  it('returns nothing for a clean repo', () => {
    assert.deepEqual(gcScan(repo), []);
  });

  it('survives a settings.json that does not parse', () => {
    write('.claude/settings.json', '{ broken');
    assert.deepEqual(gcScan(repo), []);
  });

  it('groups every channel it found into one list', () => {
    write('.claude/hooks/registry.json', { hooks: [] });
    write('.claude/hooks/orphan.sh', '# x\n');
    write('.claude/settings.json', { permissions: { allow: ['Bash(a)', 'Bash(a)'] } });
    const channels = new Set(gcScan(repo).map((c) => c.channel));
    assert.deepEqual([...channels].sort(), ['hooks', 'permissions']);
  });
});

// --- the jev lane -----------------------------------------------------------
// Injected transport and an explicit key: the lane must be exercised without
// a network and without depending on whether this machine has credentials.
const jevReply = (answers) => async () => ({ ok: true, json: async () => ({ answers, usage: { input_tokens: 1, output_tokens: 1 } }) });
const withKey = async (fn) => {
  const saved = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test-key';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
};

describe('rankCandidates', () => {
  const candidates = [
    { channel: 'skills', path: 'a', why: 'never invoked', action: 'disable' },
    { channel: 'worktrees', path: 'b', why: 'no branch remains', action: 'trash' },
  ];

  it('orders the least likely to be missed first and annotates each one', async () => {
    const { rankCandidates } = await import('./gc-scan.mjs');
    const result = await withKey(() =>
      rankCandidates(candidates, {
        repo: '/nonexistent',
        fetchImpl: jevReply({ c_0: { score: 1.8, confidence: 0.9, legend: { 2: 'still earning its place' } }, c_1: { score: 0.1, confidence: 0.9, legend: { 0: 'clearly finished with' } } }),
      }),
    );
    assert.deepEqual(result.candidates.map((c) => c.path), ['b', 'a']);
    assert.equal(result.candidates[0].keep.label, 'clearly finished with');
  });

  it('hands back the candidates untouched when the lane is unavailable', async () => {
    const { rankCandidates } = await import('./gc-scan.mjs');
    const result = await withKey(() =>
      rankCandidates(candidates, { repo: '/nonexistent', fetchImpl: async () => ({ ok: false, status: 503 }) }),
    );
    assert.equal(result.unavailable, true);
    assert.deepEqual(result.candidates.map((c) => c.path), ['a', 'b']);
    assert.equal(result.candidates[0].keep, undefined);
  });

  it('asks nothing when there is nothing to reclaim', async () => {
    const { rankCandidates } = await import('./gc-scan.mjs');
    let called = false;
    const result = await rankCandidates([], { repo: '/nonexistent', fetchImpl: async () => { called = true; } });
    assert.equal(called, false);
    assert.deepEqual(result.candidates, []);
  });
});
