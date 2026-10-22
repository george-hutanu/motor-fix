import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble, auditLine, pickMode, readState } from './session-context.mjs';

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
    const out = assemble({ head, mode: 'MODE', tail, max: 1000 });
    assert.deepEqual(out.split('\n\n'), ['HEAD', 'MODE', 'TAIL']);
  });

  it('never drops the branch state or the gate list', () => {
    const out = assemble({ head, mode: 'm'.repeat(500), tail, max: 20 });
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

  // @traces 1360-FR-009
  it('injects no instinct, whatever its confidence', () => {
    mkdirSync(join(repo, '.specify/memory/instincts'), { recursive: true });
    writeFileSync(
      join(repo, '.specify/memory/instincts/loud.md'),
      '---\nid: loud\ntrigger: when loud\ndomain: t\nconfidence: 0.95\nscope: project\nstatus: active\ncreated: 2026-01-01\nlast_seen: 2026-01-01\nreinforced: 1\n---\n\nact on loud\n\n## Evidence\n- seen\n',
    );
    const out = run().stdout;
    assert.doesNotMatch(out, /when loud|Instincts/);
  });

  // @traces 1360-FR-007
  it('prints one context-audit line in the head when the context file grew past its baseline', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), 'one rule that changes behaviour\nanother rule that changes behaviour\nthird\n');
    writeFileSync(join(repo, '.specify/context-baseline.json'), JSON.stringify({ lines: 2 }));
    const out = run({ SPECKIT_CONTEXT_MAX_CHARS: '10' }).stdout;
    const lines = out.split('\n').filter((l) => l.startsWith('context-audit:'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /CLAUDE\.local\.md grew from 2 to 3 non-empty lines \(\+1\).*node \.claude\/scripts\/context-audit\.mjs/);
  });

  // @traces 1360-FR-007
  it('prints no context-audit line when the file held its size with no findings', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), 'one rule that changes behaviour\n');
    writeFileSync(join(repo, '.specify/context-baseline.json'), JSON.stringify({ lines: 1 }));
    assert.doesNotMatch(run().stdout, /context-audit:/);
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

describe('session context — the context-file audit line', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'session-audit-'));
    mkdirSync(join(repo, '.specify'), { recursive: true });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  // @traces 1360-FR-007
  it('names the finding count when the audit finds lines worth re-reading', () => {
    writeFileSync(join(repo, 'CLAUDE.local.md'), 'The ~~old~~ rule.\nThe lint step used to be eslint.\n');
    writeFileSync(join(repo, '.specify/context-baseline.json'), JSON.stringify({ lines: 10 }));
    assert.match(auditLine(repo), /^context-audit: CLAUDE\.local\.md has \d+ line\(s\) worth re-reading; run node \.claude\/scripts\/context-audit\.mjs$/);
  });

  // @traces 1360-FR-007
  it('stays silent when there is no context file, no baseline or the baseline is unreadable', () => {
    assert.equal(auditLine(repo), '');
    writeFileSync(join(repo, 'CLAUDE.local.md'), 'a rule\nb rule\n');
    assert.equal(auditLine(repo), '');
    writeFileSync(join(repo, '.specify/context-baseline.json'), '{not json');
    assert.equal(auditLine(repo), '');
  });
});
