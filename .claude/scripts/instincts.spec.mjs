import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decayed,
  formatInstinct,
  instinctsDir,
  loadInstincts,
  parseInstinct,
  saveInstinct,
  selectForInjection,
} from './instincts.mjs';

// Instincts are the only thing in this repo that writes itself into a future
// session's context, so the tests care most about two properties: a round trip
// must not lose evidence, and decay must be a function of a supplied clock
// rather than of when the suite happens to run.

const SCRIPT = new URL('./instincts.mjs', import.meta.url).pathname;

const sample = {
  id: 'temp-dirs',
  trigger: 'when a test writes task data',
  domain: 'testing',
  confidence: 0.7,
  scope: 'project',
  status: 'active',
  created: '2026-01-01',
  last_seen: '2026-01-01',
  reinforced: 2,
  action: 'Point TASKR_DATA_DIR at a temp dir, never the real store.',
  evidence: ['2026-01-01: the suite wrote to the real store'],
};

describe('instincts — the file format', () => {
  it('round-trips every field', () => {
    const parsed = parseInstinct(formatInstinct(sample));
    assert.deepEqual(parsed, sample);
  });

  it('keeps multi-line actions and multiple evidence lines', () => {
    const rich = { ...sample, action: 'Line one.\n\nLine two.', evidence: ['a', 'b'] };
    const parsed = parseInstinct(formatInstinct(rich));
    assert.equal(parsed.action, 'Line one.\n\nLine two.');
    assert.deepEqual(parsed.evidence, ['a', 'b']);
  });

  it('rejects a file with no frontmatter or no trigger', () => {
    assert.equal(parseInstinct('just prose'), null);
    assert.equal(parseInstinct('---\nid: x\n---\nbody'), null);
  });

  it('defaults the fields an older file may not carry', () => {
    const parsed = parseInstinct('---\nid: x\ntrigger: when y\n---\ndo z\n');
    assert.equal(parsed.confidence, 0.5);
    assert.equal(parsed.status, 'active');
    assert.equal(parsed.scope, 'project');
    assert.equal(parsed.reinforced, 1);
  });
});

describe('instincts — selection for a session', () => {
  const make = (id, confidence, status = 'active') => ({ ...sample, id, confidence, status });

  it('takes the most confident few, above the threshold', () => {
    const picked = selectForInjection(
      [make('a', 0.9), make('b', 0.75), make('c', 0.71), make('d', 0.7)],
      { max: 2, min: 0.7 },
    );
    assert.deepEqual(picked.map((i) => i.id), ['a', 'b']);
  });

  it('never injects a retired or low-confidence instinct', () => {
    const picked = selectForInjection([make('a', 0.9, 'retired'), make('b', 0.4)], { max: 5, min: 0.7 });
    assert.deepEqual(picked, []);
  });
});

describe('instincts — decay', () => {
  const at = (iso) => ({ now: Date.parse(iso), days: 30 });

  it('leaves a fresh instinct alone', () => {
    assert.equal(decayed(sample, at('2026-01-20')).confidence, 0.7);
  });

  it('fades 0.1 per elapsed period', () => {
    assert.equal(decayed(sample, at('2026-02-05')).confidence, 0.6);
    assert.equal(decayed(sample, at('2026-04-05')).confidence, 0.4);
  });

  it('retires an instinct that falls under 0.3', () => {
    const faded = decayed(sample, at('2026-06-01'));
    assert.ok(faded.confidence < 0.3);
    assert.equal(faded.status, 'retired');
  });

  it('never goes negative, and ignores an unparseable date', () => {
    assert.equal(decayed(sample, at('2030-01-01')).confidence, 0);
    assert.equal(decayed({ ...sample, last_seen: 'whenever', created: '' }, at('2030-01-01')).confidence, 0.7);
  });
});

describe('instincts — the CLI', () => {
  let repo;
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'instincts-'));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('records, lists and injects an instinct', () => {
    const add = run('add', '--id', 'x-gate', '--trigger', 'when y', '--action', 'do z', '--domain', 'harness', '--confidence', '0.8', '--evidence', '2026-01-01: saw it');
    assert.equal(add.status, 0);
    assert.match(run('list').stdout, /x-gate/);
    assert.match(run('inject').stdout, /when y: do z/);
    assert.equal(loadInstincts(repo).length, 1);
  });

  it('merges evidence instead of duplicating a file', () => {
    run('add', '--id', 'x', '--trigger', 't', '--action', 'a', '--evidence', 'first');
    run('add', '--id', 'x', '--trigger', 't', '--action', 'a', '--evidence', 'second');
    const [instinct] = loadInstincts(repo);
    assert.deepEqual(instinct.evidence, ['first', 'second']);
    assert.equal(instinct.reinforced, 2);
  });

  it('reinforce raises confidence and caps it', () => {
    run('add', '--id', 'x', '--trigger', 't', '--action', 'a', '--confidence', '0.9');
    run('reinforce', 'x');
    run('reinforce', 'x');
    assert.equal(loadInstincts(repo)[0].confidence, 0.95);
  });

  it('retire keeps the file but takes it out of injection', () => {
    run('add', '--id', 'x', '--trigger', 't', '--action', 'a', '--confidence', '0.9');
    run('retire', 'x');
    assert.equal(loadInstincts(repo)[0].status, 'retired');
    assert.equal(run('inject').stdout.trim(), '');
    assert.match(run('list').stdout, /No instincts recorded|^$/);
  });

  it('decay rewrites the files it faded', () => {
    saveInstinct(repo, { ...sample, id: 'old', last_seen: '2026-01-01' });
    const out = run('decay', '--now', '2026-03-05T00:00:00Z');
    assert.match(out.stdout, /old: 0.70 → 0.50/);
    assert.equal(loadInstincts(repo)[0].confidence, 0.5);
  });

  it('refuses to reinforce something that does not exist', () => {
    const out = run('reinforce', 'ghost');
    assert.equal(out.status, 1);
    assert.match(out.stderr, /No instinct "ghost"/);
  });

  it('ignores a README and any unparseable file in the directory', () => {
    mkdirSync(instinctsDir(repo), { recursive: true });
    writeFileSync(join(instinctsDir(repo), 'README.md'), '# not an instinct\n');
    writeFileSync(join(instinctsDir(repo), 'broken.md'), 'no frontmatter here\n');
    saveInstinct(repo, sample);
    assert.deepEqual(loadInstincts(repo).map((i) => i.id), ['temp-dirs']);
    assert.match(readFileSync(join(instinctsDir(repo), 'temp-dirs.md'), 'utf8'), /^---\n/);
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

const instinct = (id, confidence, trigger) => ({
  id,
  trigger,
  action: `do ${id}`,
  domain: 'workflow',
  confidence,
  status: 'active',
  reinforced: 1,
  evidence: [],
});

describe('selectByRelevance', () => {
  const pool = [
    instinct('commits', 0.9, 'when writing a commit message'),
    instinct('gates', 0.85, 'after editing a hook'),
    instinct('scanner', 0.8, 'when touching scanner plugins'),
    instinct('docs', 0.75, 'when editing a README'),
  ];

  it('picks by relevance to the session, not by confidence order', async () => {
    const { selectByRelevance } = await import('./instincts.mjs');
    const picked = await withKey(() =>
      selectByRelevance(pool, {
        max: 2,
        repo: '/nonexistent',
        feature: '019-scanner-thing',
        mode: 'implement',
        fetchImpl: jevReply({
          i_0: { score: 0.1, confidence: 0.9 },
          i_1: { score: 0.2, confidence: 0.9 },
          i_2: { score: 1.9, confidence: 0.9 },
          i_3: { score: 1.1, confidence: 0.9 },
        }),
      }),
    );
    assert.deepEqual(picked.map((i) => i.id), ['scanner', 'docs']);
  });

  it('falls back to the confidence order when the lane is unavailable', async () => {
    const { selectByRelevance } = await import('./instincts.mjs');
    const picked = await withKey(() =>
      selectByRelevance(pool, { max: 2, repo: '/nonexistent', fetchImpl: async () => ({ ok: false, status: 500 }) }),
    );
    assert.deepEqual(picked.map((i) => i.id), ['commits', 'gates']);
  });

  it('asks nothing when the shortlist already fits the budget', async () => {
    const { selectByRelevance } = await import('./instincts.mjs');
    let called = false;
    const picked = await selectByRelevance(pool.slice(0, 2), {
      max: 3,
      repo: '/nonexistent',
      fetchImpl: async () => {
        called = true;
      },
    });
    assert.equal(called, false);
    assert.equal(picked.length, 2);
  });

  it('never returns a retired or low-confidence instinct', async () => {
    const { selectByRelevance } = await import('./instincts.mjs');
    const mixed = [...pool, { ...instinct('retired', 0.95, 'x'), status: 'retired' }, instinct('weak', 0.4, 'y')];
    const picked = await withKey(() =>
      selectByRelevance(mixed, {
        max: 6,
        repo: '/nonexistent',
        fetchImpl: jevReply(Object.fromEntries(pool.map((_, i) => [`i_${i}`, { score: 1, confidence: 0.9 }]))),
      }),
    );
    assert.deepEqual(picked.map((i) => i.id).sort(), ['commits', 'docs', 'gates', 'scanner']);
  });
});

describe('triggeredBy', () => {
  const pool = [instinct('gates', 0.9, 'after editing a hook'), instinct('docs', 0.8, 'when editing a README')];

  it('reports only the triggers the evidence actually shows, strongest first', async () => {
    const { triggeredBy } = await import('./instincts.mjs');
    const { fired } = await withKey(() =>
      triggeredBy(pool, 'diff --git a/.claude/hooks/red-first-gate.mjs', {
        repo: '/nonexistent',
        fetchImpl: jevReply({ t_0: { noul: 0.91 }, t_1: { noul: 0.05 } }),
      }),
    );
    assert.deepEqual(fired.map((f) => f.instinct.id), ['gates']);
    assert.equal(fired[0].value, 0.91);
  });

  it('ignores retired instincts and reports an unavailable lane as such', async () => {
    const { triggeredBy } = await import('./instincts.mjs');
    const retiredOnly = [{ ...instinct('old', 0.9, 'x'), status: 'retired' }];
    assert.deepEqual((await triggeredBy(retiredOnly, 'evidence', { repo: '/nonexistent' })).fired, []);

    const result = await withKey(() =>
      triggeredBy(pool, 'evidence', { repo: '/nonexistent', fetchImpl: async () => ({ ok: false, status: 500 }) }),
    );
    assert.equal(result.unavailable, true);
    assert.deepEqual(result.fired, []);
  });
});
