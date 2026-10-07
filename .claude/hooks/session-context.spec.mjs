import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble, pickMode, readState } from './session-context.mjs';

// What a new session is told. Two properties are worth pinning: the mode must
// follow the feature's actual state rather than the branch name, and the budget
// must drop guidance before it drops the branch state or the gate list — those
// are what a resumed session cannot rediscover cheaply.

const HOOK = new URL('./session-context.mjs', import.meta.url).pathname;

describe('session context — mode selection', () => {
  it('is planning with no feature, or a feature with no tasks yet', () => {
    assert.equal(pickMode({ feature: null }), 'planning');
    assert.equal(pickMode({ feature: '002-x', hasTasks: false }), 'planning');
  });

  it('is red-first while the feature has open tasks and no tagged tests', () => {
    assert.equal(pickMode({ feature: '002-x', hasTasks: true, openTasks: 4, hasTestTokens: false }), 'red-first');
  });

  it('is implement once tagged tests exist', () => {
    assert.equal(pickMode({ feature: '002-x', hasTasks: true, openTasks: 4, hasTestTokens: true }), 'implement');
  });

  it('is harden when every task is checked off', () => {
    assert.equal(pickMode({ feature: '002-x', hasTasks: true, openTasks: 0, hasTestTokens: true }), 'harden');
  });
});

describe('session context — the budget', () => {
  const head = 'HEAD';
  const tail = 'TAIL';

  it('keeps everything when it fits', () => {
    const out = assemble({ head, mode: 'MODE', instincts: 'INSTINCTS', tail, max: 1000 });
    assert.deepEqual(out.split('\n\n'), ['HEAD', 'MODE', 'INSTINCTS', 'TAIL']);
  });

  it('drops the instincts before the mode guidance', () => {
    const mode = 'm'.repeat(40);
    const out = assemble({ head, mode, instincts: 'i'.repeat(40), tail, max: 60 });
    assert.ok(out.includes(mode));
    assert.ok(!out.includes('iiii'));
    assert.match(out, /trimmed to fit/);
  });

  it('never drops the branch state or the gate list', () => {
    const out = assemble({ head, mode: 'm'.repeat(500), instincts: 'i'.repeat(500), tail, max: 20 });
    assert.ok(out.startsWith('HEAD'));
    assert.ok(out.includes('TAIL'));
  });

  it('says nothing about trimming when there was nothing to trim', () => {
    assert.doesNotMatch(assemble({ head, tail, max: 1000 }), /trimmed/);
  });
});

describe('session context — as a hook', () => {
  let repo;
  const run = (env = {}) =>
    spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
    });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'session-ctx-'));
    mkdirSync(join(repo, '.specify/contexts'), { recursive: true });
    writeFileSync(join(repo, '.specify/contexts/planning.md'), 'PLANNING GUIDANCE\n');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('prints the mode context for the current state', () => {
    const out = run().stdout;
    assert.match(out, /mode: planning/);
    assert.match(out, /PLANNING GUIDANCE/);
    assert.match(out, /Constitution:/);
  });

  it('injects only instincts above the confidence threshold', () => {
    mkdirSync(join(repo, '.specify/memory/instincts'), { recursive: true });
    const instinct = (id, confidence) =>
      writeFileSync(
        join(repo, `.specify/memory/instincts/${id}.md`),
        `---\nid: ${id}\ntrigger: when ${id}\ndomain: t\nconfidence: ${confidence}\nscope: project\nstatus: active\ncreated: 2026-01-01\nlast_seen: 2026-01-01\nreinforced: 1\n---\n\nact on ${id}\n\n## Evidence\n- seen\n`,
      );
    instinct('loud', 0.9);
    instinct('quiet', 0.4);
    const out = run().stdout;
    assert.match(out, /when loud/);
    assert.doesNotMatch(out, /when quiet/);
  });

  it('prints nothing at all when switched off', () => {
    assert.equal(run({ SPECKIT_CONTEXT_OFF: '1' }).stdout, '');
  });

  // The plan pointer used to be a line /speckit-plan rewrote in the
  // tracked CLAUDE.local.md, so every merge made the other open branches
  // conflict on it. It is derived here, per checkout, from feature.json.
  const feature = (withPlan) => {
    const dir = join(repo, 'specs/007-pointer');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), '# spec\n');
    if (withPlan) writeFileSync(join(dir, 'plan.md'), '# plan\n');
    writeFileSync(join(repo, '.specify/feature.json'), JSON.stringify({ feature_directory: 'specs/007-pointer' }));
  };

  it('names the active plan from feature.json', () => {
    feature(true);
    assert.equal(readState(repo).plan, 'specs/007-pointer/plan.md');
    assert.match(run().stdout, /^Active plan \(stack, structure, commands\): specs\/007-pointer\/plan\.md$/m);
  });

  it('names no plan before the feature has one', () => {
    feature(false);
    assert.equal(readState(repo).plan, '');
    assert.doesNotMatch(run().stdout, /Active plan/);
  });

  it('keeps the plan pointer when the budget trims everything else', () => {
    feature(true);
    assert.match(run({ SPECKIT_CONTEXT_MAX_CHARS: '10' }).stdout, /Active plan .*specs\/007-pointer\/plan\.md/);
  });

  it('reads a repo with no feature without failing', () => {
    const state = readState(repo);
    assert.equal(state.feature, null);
    assert.equal(run().status, 0);
  });
});
