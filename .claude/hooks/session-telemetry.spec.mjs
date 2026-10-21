import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Stop hook run by a session that moved into a worktree: its ledger goes
// where every reader looks (the main checkout), and what it records about the
// feature comes from the worktree it is in, not from the checkout it started in.

const HOOK = new URL('./session-telemetry.mjs', import.meta.url).pathname;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'SPECIFY_FEATURE_DIRECTORY'));
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: 'pipe', encoding: 'utf8', env });
const assistant = (id, timestamp) =>
  `${JSON.stringify({ type: 'assistant', timestamp, message: { id, usage: { input_tokens: 3, output_tokens: 4 }, content: [] } })}\n`;

// @traces 1361-watch-schedule-qa-telemetry-FR-009
describe('session telemetry — a session working in a worktree', () => {
  let scratch;
  let main;
  let linked;
  let transcript;
  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'session-telemetry-')));
    main = join(scratch, 'main');
    linked = join(scratch, 'wt');
    mkdirSync(main);
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', '-b', '777-thing', linked);
    mkdirSync(join(linked, 'specs/777-thing'), { recursive: true });
    writeFileSync(join(linked, 'specs/777-thing/spec.md'), '# Spec\n');
    mkdirSync(join(linked, '.specify'), { recursive: true });
    writeFileSync(join(linked, '.specify/feature.json'), JSON.stringify({ feature_directory: 'specs/777-thing', level: 2, level_for: 'specs/777-thing' }));
    writeFileSync(join(linked, '.specify/run-state.json'), JSON.stringify({ status: 'in-progress', phase: 'implement', feature: 'specs/777-thing' }));
    transcript = join(scratch, 'sess-w.jsonl');
    writeFileSync(transcript, assistant('m1', '2026-10-21T10:00:00Z') + assistant('m2', '2026-10-21T10:15:00Z'));
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  const runHook = (payload) =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 'sess-w', transcript_path: transcript, ...payload }),
      encoding: 'utf8',
      env: { ...env, CLAUDE_PROJECT_DIR: main, SPECKIT_FEATURE_LEVEL: '' },
    });

  it('writes the ledger under the main checkout, naming the worktree', () => {
    assert.equal(runHook({ cwd: linked }).status, 0);
    const file = join(main, '.specify/telemetry/sess-w.json');
    assert.ok(existsSync(file), 'the ledger is in the main checkout');
    assert.equal(existsSync(join(linked, '.specify/telemetry/sess-w.json')), false, 'and not in the worktree');
    const r = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(r.worktree, linked);
    assert.equal(r.started, '2026-10-21T10:00:00Z');
    assert.equal(r.updated, '2026-10-21T10:15:00Z');
  });

  it('reads the feature, level, phase and branch from the worktree, not from the checkout the session started in', () => {
    runHook({ cwd: linked });
    const r = JSON.parse(readFileSync(join(main, '.specify/telemetry/sess-w.json'), 'utf8'));
    assert.equal(r.feature, '777-thing');
    assert.equal(r.level, 2);
    assert.equal(r.phase, 'implement');
    assert.equal(r.branch, '777-thing');
    assert.deepEqual(Object.keys(r.buckets), ['2/implement']);
    assert.equal(r.buckets['2/implement'].first, '2026-10-21T10:00:00Z');
    assert.equal(r.buckets['2/implement'].last, '2026-10-21T10:15:00Z');
  });

  it('reads from a subfolder of the worktree as from its root', () => {
    mkdirSync(join(linked, 'apps'), { recursive: true });
    runHook({ cwd: join(linked, 'apps') });
    const r = JSON.parse(readFileSync(join(main, '.specify/telemetry/sess-w.json'), 'utf8'));
    assert.equal(r.worktree, linked);
    assert.equal(r.feature, '777-thing');
  });

  it('folds the worktree\'s own too-heavy mark and removes it there', () => {
    const mark = { feature: 'specs/777-thing', level: 2, file: 'x.mjs', at: '2026-10-21T10:00:00Z' };
    mkdirSync(join(linked, '.specify/telemetry'), { recursive: true });
    writeFileSync(join(linked, '.specify/telemetry/pending.json'), JSON.stringify({ too_heavy: [mark] }));
    runHook({ cwd: linked });
    const r = JSON.parse(readFileSync(join(main, '.specify/telemetry/sess-w.json'), 'utf8'));
    assert.deepEqual(r.too_heavy, [mark]);
    assert.equal(existsSync(join(linked, '.specify/telemetry/pending.json')), false);
  });

  it('falls back to CLAUDE_PROJECT_DIR when the payload names no cwd', () => {
    runHook({});
    const r = JSON.parse(readFileSync(join(main, '.specify/telemetry/sess-w.json'), 'utf8'));
    assert.equal(r.worktree, main);
    assert.equal(r.branch, 'main');
    assert.equal(r.feature, null);
  });
});
