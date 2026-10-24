import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from './lifecycle.mjs';

const FEATURE = '696-lifecycle-script';
const TITLE = 'chore(harness): ST-696 lifecycle steps as one script call each';
const PR_URL = 'https://github.com/george-hutanu/motor-fix/pull/141';
const REST = 'gh api repos/{owner}/{repo}/';
const MARK = '<!-- speckit-handoff -->';
const CLOUD = { GH_TOKEN: 'proxy-injected', CLAUDE_CODE_REMOTE: 'true' };

let repo;
let featureDir;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'lifecycle-adv-'));
  featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696 (Task)\n');
  writeFileSync(join(featureDir, 'tracker-sync.md'), `# Tracker sync\n\n- 2026-10-05 · start · ST-696 · To do → Planning\n`);
  writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## Why\n\n_(fill in: why)_\n');
  writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const note = () => join(featureDir, 'handoff.md');
const stateFile = () => join(repo, '.specify', 'run-state.json');
const state = () => JSON.parse(readFileSync(stateFile(), 'utf8'));
const setState = (s) => writeFileSync(stateFile(), typeof s === 'string' ? s : JSON.stringify({ status: 'in-progress', repair_iterations: 0, ...s }));
const countLines = (text) => text.split('\n').filter((l) => /Repair iterations:/.test(l));

function harness({ env = { GH_TOKEN: 'tok' }, comments = [] } = {}) {
  const calls = [];
  const posted = [];
  const pull = { number: 141, state: 'open', merged_at: null, draft: true, title: TITLE, html_url: PR_URL, head: { ref: FEATURE, sha: 'abcdef1234567890' }, labels: [] };
  const run = (file, args, opts = {}) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    if (cmd.includes('issues/141/comments -X POST')) {
      posted.push(JSON.parse(opts.input).body);
      return { code: 0, stdout: '{}', stderr: '' };
    }
    if (cmd.startsWith('git rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: `${FEATURE}\n`, stderr: '' };
    if (cmd.startsWith('git rev-parse HEAD')) return { code: 0, stdout: 'abcdef1234567890\n', stderr: '' };
    if (cmd.startsWith(`${REST}issues/141/comments?per_page=100 -X GET`)) return { code: 0, stdout: JSON.stringify([comments]), stderr: '' };
    if (cmd.startsWith(`${REST}pulls?head=`)) return { code: 0, stdout: JSON.stringify([[pull]]), stderr: '' };
    if (cmd.startsWith(`${REST}pulls/141 -X GET`)) return { code: 0, stdout: JSON.stringify(pull), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { io: { repo, env, run, gate: () => ({ code: 0, stderr: '' }) }, calls, posted };
}

const marked = (body, at = '2026-10-06T10:00:00Z') => ({ user: { login: 'george-hutanu' }, body: `${MARK}\n${body}`, created_at: at });
const restore = (comments) => step(['handoff', '--restore', '--pr', '141'], harness({ comments }).io);

describe('handoff rewrites the count from run state', () => {
  // @traces 317-FR-001
  it('writes 0 when there is no run state at all', () => {
    writeFileSync(note(), '# Hand-off\n- QA run: 9 · head abc · lap 1 · url\n');
    assert.equal(step(['handoff', '--pr', '141'], harness().io).ok, true);
    assert.deepEqual(countLines(readFileSync(note(), 'utf8')), ['- Repair iterations: 0']);
  });

  // @traces 317-FR-001
  it('collapses a note with two stale count lines into one holding the current count', () => {
    setState({ repair_iterations: 4 });
    writeFileSync(note(), '# Hand-off\n- Repair iterations: 1\n- QA run: 9 · lap 5\n- Repair iterations: 2\n');
    step(['handoff', '--pr', '141'], harness().io);
    assert.deepEqual(countLines(readFileSync(note(), 'utf8')), ['- Repair iterations: 4']);
  });

  // @traces 317-FR-001
  it('keeps the rest of the note byte for byte when it swaps the count', () => {
    setState({ repair_iterations: 6 });
    writeFileSync(note(), '# Hand-off\n\nPR: #141 · head abc\n- Repair iterations: 1\n\n- Open decisions: none\n');
    step(['handoff', '--pr', '141'], harness().io);
    assert.equal(readFileSync(note(), 'utf8'), '# Hand-off\n\nPR: #141 · head abc\n- Repair iterations: 6\n\n- Open decisions: none\n');
  });

  // @traces 317-FR-001
  it('running handoff twice leaves one count line, not two', () => {
    setState({ repair_iterations: 2 });
    writeFileSync(note(), '# Hand-off\n');
    step(['handoff', '--pr', '141'], harness().io);
    step(['handoff', '--pr', '141'], harness().io);
    assert.deepEqual(countLines(readFileSync(note(), 'utf8')), ['- Repair iterations: 2']);
  });

  // @traces 317-FR-001
  it('posts the rewritten note, not the one that was on disk', () => {
    setState({ repair_iterations: 9 });
    writeFileSync(note(), '# Hand-off\n- Repair iterations: 1\n');
    const h = harness({ env: CLOUD });
    step(['handoff', '--pr', '141'], h.io);
    assert.deepEqual(h.posted, [`${MARK}\n# Hand-off\n- Repair iterations: 9\n`]);
  });

  // @traces 317-FR-001
  it('a note without a trailing newline still ends with a whole count line', () => {
    setState({ repair_iterations: 3 });
    writeFileSync(note(), '# Hand-off\n- QA run: 9');
    step(['handoff', '--pr', '141'], harness().io);
    assert.deepEqual(readFileSync(note(), 'utf8').split('\n').filter(Boolean), ['# Hand-off', '- QA run: 9', '- Repair iterations: 3']);
  });

  // @traces 317-FR-001
  it('a run state file that is not JSON is read as no count rather than crashing the hand-off', () => {
    setState('{not json');
    writeFileSync(note(), '# Hand-off\n');
    const result = step(['handoff', '--pr', '141'], harness().io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(countLines(readFileSync(note(), 'utf8')), ['- Repair iterations: 0']);
  });
});

describe('handoff --restore takes the highest of three counts', () => {
  // @traces 317-FR-002
  it('restores a lap of 1 as 0 and never writes a negative count for lap 0', () => {
    restore([marked('# Hand-off\n- QA run: 9 · head abc · lap 0 · url\n')]);
    assert.ok(!existsSync(stateFile()) || state().repair_iterations >= 0);
    restore([marked('# Hand-off\n- QA run: 9 · head abc · lap 1 · url\n')]);
    if (existsSync(stateFile())) assert.equal(state().repair_iterations, 0);
  });

  // @traces 317-FR-002
  it('keeps the other fields of an existing run state when it raises the count', () => {
    setState({ status: 'blocked', blocking_condition: 'repair-loop-exceeded', repair_iterations: 2, feature: 'x' });
    restore([marked('# Hand-off\n- Repair iterations: 5\n')]);
    const after = state();
    assert.equal(after.repair_iterations, 5);
    assert.equal(after.status, 'blocked');
    assert.equal(after.blocking_condition, 'repair-loop-exceeded');
    assert.equal(after.feature, 'x');
  });

  // @traces 317-FR-002
  it('equal counts leave run state exactly as it was', () => {
    setState({ repair_iterations: 4 });
    const before = readFileSync(stateFile(), 'utf8');
    restore([marked('# Hand-off\n- Repair iterations: 4\n')]);
    assert.equal(readFileSync(stateFile(), 'utf8'), before);
  });

  // @traces 317-FR-002
  it('restoring twice gives the same count as restoring once', () => {
    const comments = [marked('# Hand-off\n- QA run: 9 · head abc · lap 7 · url\n')];
    restore(comments);
    restore(comments);
    assert.equal(state().repair_iterations, 6);
  });

  // @traces 317-FR-002
  it('a count that is not a number is ignored, not written as NaN or null', () => {
    restore([marked('# Hand-off\n- Repair iterations: many\n- QA run: 9 · head abc · lap 3 · url\n')]);
    assert.equal(state().repair_iterations, 2);
  });

  // @traces 317-FR-002
  it('a negative count line never lowers or goes below the lap', () => {
    setState({ repair_iterations: 1 });
    restore([marked('# Hand-off\n- Repair iterations: -5\n')]);
    assert.equal(state().repair_iterations, 1);
  });

  // @traces 317-FR-002
  it('a lap mentioned on a line other than the QA run line does not count', () => {
    restore([marked('# Hand-off\n- Notes: see lap 99 of the earlier run\n- QA run: 9 · head abc · lap 2 · url\n')]);
    assert.equal(state().repair_iterations, 1);
  });

  // @traces 317-FR-002
  it('reads a note with Windows line endings', () => {
    restore([marked('# Hand-off\r\n- QA run: 9 · head abc · lap 5 · url\r\n- Repair iterations: 2\r\n')]);
    assert.equal(state().repair_iterations, 4);
  });

  // @traces 317-FR-002
  it('a run state whose count is stored as a string is treated as a number and still never lowered', () => {
    setState({ repair_iterations: '9' });
    restore([marked('# Hand-off\n- Repair iterations: 3\n')]);
    assert.equal(Number(state().repair_iterations), 9);
  });

  // @traces 317-FR-002
  it('a corrupt run state file is replaced with the restored count rather than aborting the restore', () => {
    setState('{not json');
    const result = restore([marked('# Hand-off\n- Repair iterations: 3\n')]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(state().repair_iterations, 3);
  });

  // @traces 317-FR-002
  it('an existing local note with a lower count than run state leaves run state alone and fetches nothing', () => {
    setState({ repair_iterations: 5 });
    writeFileSync(note(), '# Hand-off\n- Repair iterations: 1\n- QA run: 9 · head abc · lap 2 · url\n');
    const h = harness({ comments: [marked('# Hand-off\n- Repair iterations: 99\n')] });
    step(['handoff', '--restore', '--pr', '141'], h.io);
    assert.equal(state().repair_iterations, 5);
    assert.ok(!h.calls.some((c) => c.includes('/comments')));
  });

  // @traces 317-FR-002
  it('the cap blocks again after a restore that takes the count to the cap', async () => {
    restore([marked('# Hand-off\n- Repair iterations: 10\n')]);
    const { main } = await import('./run-state.mjs');
    assert.equal(main(['repair'], repo, {}), 1);
    assert.equal(state().blocking_condition, 'repair-loop-exceeded');
  });
});

describe('handoff --restore reads the newest marked comment of every page', () => {
  // @traces 317-FR-003
  it('takes the count from the newest marked note, not from an older one with a higher count', () => {
    restore([
      marked('# Hand-off\n- Repair iterations: 8\n', '2026-10-06T09:00:00Z'),
      marked('# Hand-off\n- Repair iterations: 2\n', '2026-10-06T12:00:00Z'),
    ]);
    assert.equal(state().repair_iterations, 2);
  });

  // @traces 317-FR-003
  it('ignores a count in a comment that quotes the marker mid-text', () => {
    restore([
      marked('# Hand-off\n- Repair iterations: 1\n'),
      { body: `quote ${MARK}\n- Repair iterations: 9\n`, created_at: '2026-10-06T13:00:00Z' },
    ]);
    assert.equal(state().repair_iterations, 1);
  });

  // @traces 317-FR-003
  it('a thousand comments with the note first in the list is still found', () => {
    const noise = Array.from({ length: 1000 }, (_, i) => ({ body: `c${i}`, created_at: '2026-10-05T09:00:00Z' }));
    restore([...noise, marked('# Hand-off\n- Repair iterations: 3\n', '2026-10-06T09:00:00Z')]);
    assert.equal(state().repair_iterations, 3);
  });

  // @traces 317-FR-003
  it('a comment with a null body does not break the restore', () => {
    const result = restore([{ body: null, created_at: '2026-10-06T09:00:00Z' }, marked('# Hand-off\n- Repair iterations: 3\n')]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(state().repair_iterations, 3);
  });
});
