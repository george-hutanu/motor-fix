import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gate } from './context-refresh-gate.mjs';

const SLUG = 'george-hutanu/motor-fix-specs';
const GATHERED = '2026-10-22T11:20:19Z';
const BEFORE = '2026-10-22T10:00:00Z';
const AFTER = '2026-10-22T12:00:00Z';

const contextWith = (gathered, anchor = `ST-1360 A title — https://github.com/${SLUG}/issues/1360`) =>
  `# Feature Context: x\n\n- **Feature**: 1360-x\n- **Anchor**: ${anchor}\n- **Gathered**: ${gathered}\n`;
const CONTEXT = contextWith(`${GATHERED} · specs trunk c89bb72f`);

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture({ context = CONTEXT } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'refresh-adv-'));
  roots.push(root);
  const featureDir = join(root, 'specs', '1360-x');
  mkdirSync(featureDir, { recursive: true });
  if (context !== null) writeFileSync(join(featureDir, 'context.md'), context);
  mkdirSync(join(root, '.motor-fix-specs'));
  return { root, featureDir };
}

const story = (over = {}) => ({ number: 1360, title: 'ST-1360 A title', labels: [{ name: 'EP-1' }], created_at: BEFORE, updated_at: BEFORE, ...over });
const epic = (over = {}) => ({ number: 682, title: 'EP-1 Foundations', labels: [{ name: 'epic' }], created_at: BEFORE, updated_at: BEFORE, ...over });
const ok = (v) => ({ code: 0, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '' });

function runner(over = {}) {
  const calls = [];
  const answers = { story: ok(story()), epics: ok([epic()]), siblings: ok([story()]), fetch: ok(''), log: ok(''), ...over };
  const run = (file, args) => {
    calls.push([file, ...args]);
    const line = args.join(' ');
    if (file === 'gh' && line === `api repos/${SLUG}/issues/1360`) return answers.story;
    if (file === 'gh' && line.startsWith(`api repos/${SLUG}/issues?labels=epic&`)) return answers.epics;
    if (file === 'gh' && line.startsWith(`api repos/${SLUG}/issues?labels=EP-1&`)) return answers.siblings;
    if (file === 'git' && args.includes('fetch')) return answers.fetch;
    if (file === 'git' && args.includes('log')) return answers.log;
    return { code: 1, stdout: '', stderr: `unexpected call: ${file} ${line}` };
  };
  return { run, calls };
}

describe('context-refresh-gate: the Gathered boundary', () => {
  // @traces 1360-FR-002
  it('skips a story updated at the very second it was gathered', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ story: ok(story({ updated_at: GATHERED })) });
    assert.equal(gate({ featureDir, root, run }), 'skip');
  });

  // @traces 1360-FR-002
  it('dispatches on a story updated one second after it was gathered', () => {
    const { root, featureDir } = fixture();
    const t = '2026-10-22T11:20:20Z';
    const { run } = runner({ story: ok(story({ updated_at: t })) });
    assert.equal(gate({ featureDir, root, run }), `dispatch story #1360 updated ${t}`);
  });

  // @traces 1360-FR-002
  it('skips a sibling created at the very second it was gathered and dispatches one second later', () => {
    const { root, featureDir } = fixture();
    const at = runner({ siblings: ok([story(), { number: 1500, title: 'ST-1500', created_at: GATHERED, updated_at: GATHERED }]) });
    assert.equal(gate({ featureDir, root, run: at.run }), 'skip');
    const later = runner({ siblings: ok([story(), { number: 1501, title: 'ST-1501', created_at: '2026-10-22T11:20:20Z', updated_at: '2026-10-22T11:20:20Z' }]) });
    assert.equal(gate({ featureDir, root, run: later.run }), 'dispatch new sibling #1501');
  });

  // @traces 1360-FR-002
  it('compares instants, not strings, when GitHub answers with a different offset spelling', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ story: ok(story({ updated_at: '2026-10-22T13:00:00+02:00' })) });
    assert.equal(gate({ featureDir, root, run }), 'skip');
  });

  // @traces 1360-FR-002
  it('dispatches for a single docs commit with the count in the reason', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ log: ok('aaa1111 docs: one\n') });
    assert.equal(gate({ featureDir, root, run }), 'dispatch docs changed (1 commits)');
  });

  // @traces 1360-FR-002
  it('skips when git log prints only blank lines', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ log: ok('\n\n') });
    assert.equal(gate({ featureDir, root, run }), 'skip');
  });

  // @traces 1360-FR-002
  it('fetches origin trunk before it reads the log', () => {
    const { root, featureDir } = fixture();
    const { run, calls } = runner();
    gate({ featureDir, root, run });
    const fetchAt = calls.findIndex((c) => c[0] === 'git' && c.includes('fetch'));
    const logAt = calls.findIndex((c) => c[0] === 'git' && c.includes('log'));
    assert.ok(fetchAt >= 0 && logAt > fetchAt);
    assert.deepEqual(calls[fetchAt].slice(-4), ['fetch', '-q', 'origin', 'trunk']);
  });

  // @traces 1360-FR-001
  it('gives the same answer when called twice', () => {
    const { root, featureDir } = fixture();
    const a = gate({ featureDir, root, run: runner().run });
    const b = gate({ featureDir, root, run: runner().run });
    assert.equal(a, 'skip');
    assert.equal(b, a);
  });
});

describe('context-refresh-gate: epics that do not match', () => {
  // @traces 1360-FR-003
  it('does not take EP-10 for EP-1', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ epics: ok([epic({ title: 'EP-10 Other' })]) });
    assert.equal(gate({ featureDir, root, run }), 'dispatch no epic for EP-1');
  });

  // @traces 1360-FR-003
  it('needs the space after the EP id in the epic title', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ epics: ok([epic({ title: 'EP-1Foundations' })]) });
    assert.equal(gate({ featureDir, root, run }), 'dispatch no epic for EP-1');
  });

  // @traces 1360-FR-003
  it('ignores a pull request whose title looks like the epic', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ epics: ok([epic({ pull_request: {} })]) });
    assert.equal(gate({ featureDir, root, run }), 'dispatch no epic for EP-1');
  });
});

describe('context-refresh-gate: malformed answers dispatch and never throw', () => {
  const cases = [
    ['a story answered as an array', { story: ok([story()]) }],
    ['a story answered as null', { story: ok('null') }],
    ['a story without updated_at', { story: ok({ number: 1360, labels: [] }) }],
    ['a story with an unparseable updated_at', { story: ok(story({ updated_at: 'yesterday' })) }],
    ['a story with null labels and a bad date', { story: ok(story({ labels: null, updated_at: null })) }],
    ['siblings answered as an object', { siblings: ok({ message: 'rate limited' }) }],
    ['a sibling without created_at', { siblings: ok([story(), { number: 9, title: 'x' }]) }],
    ['epics answered as an object', { epics: ok({ message: 'nope' }) }],
    ['an empty stdout with exit 0', { story: ok('') }],
    ['a null stdout with exit 0', { story: { code: 0, stdout: null, stderr: '' } }],
    ['a git log with exit 0 and no stdout', { log: { code: 0 } }],
  ];
  for (const [name, over] of cases) {
    // @traces 1360-FR-003
    it(`dispatches on ${name}`, () => {
      const { root, featureDir } = fixture();
      const { run } = runner(over);
      const out = gate({ featureDir, root, run });
      assert.match(out, /^dispatch\b/, out);
    });
  }

  // @traces 1360-FR-003
  it('dispatches when the runner throws', () => {
    const { root, featureDir } = fixture();
    const run = () => {
      throw new Error('spawn gh ENOENT');
    };
    assert.match(gate({ featureDir, root, run }), /^dispatch .*ENOENT/);
  });

  // @traces 1360-FR-003
  it('dispatches when the runner returns nothing', () => {
    const { root, featureDir } = fixture();
    assert.match(gate({ featureDir, root, run: () => undefined }), /^dispatch/);
  });

  // @traces 1360-FR-003
  it('dispatches on a feature dir that does not exist', () => {
    const { root } = fixture();
    assert.match(gate({ featureDir: join(root, 'specs', 'missing'), root, run: runner().run }), /^dispatch/);
  });

  // @traces 1360-FR-001
  it('answers on one line when a failing call prints several lines of stderr', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ story: { code: 1, stdout: '', stderr: 'HTTP 502\nBad gateway\n\nrequest id 7' } });
    const out = gate({ featureDir, root, run });
    assert.match(out, /^dispatch /);
    assert.doesNotMatch(out, /\n/);
  });
});

describe('context-refresh-gate: hostile context.md', () => {
  const dispatches = [
    ['a calendar-impossible Gathered time', contextWith('2026-13-45T99:99:99Z · specs trunk c89bb72f')],
    ['an empty Gathered line', contextWith('')],
    ['an empty sha', contextWith(`${GATHERED} · specs trunk `)],
    ['a Gathered line with no separator', contextWith(`${GATHERED} specs trunk c89bb72f`)],
  ];
  for (const [name, context] of dispatches) {
    // @traces 1360-FR-003
    it(`dispatches on ${name}`, () => {
      const { root, featureDir } = fixture({ context });
      assert.match(gate({ featureDir, root, run: runner().run }), /^dispatch/);
    });
  }

  // @traces 1360-FR-003
  it('never hands a sha that starts with a dash to git', () => {
    const { root, featureDir } = fixture({ context: contextWith(`${GATHERED} · specs trunk --output=/tmp/pwned`) });
    const { run, calls } = runner();
    assert.match(gate({ featureDir, root, run }), /^dispatch/);
    assert.ok(!calls.some((c) => c.some((a) => a.includes('--output=/tmp/pwned'))));
  });

  // @traces 1360-FR-003
  it('never hands a sha with shell or revision syntax to git', () => {
    const { root, featureDir } = fixture({ context: contextWith(`${GATHERED} · specs trunk abc;touch${'$'}{IFS}x..HEAD`) });
    const { run, calls } = runner();
    const out = gate({ featureDir, root, run });
    assert.ok(out.startsWith('dispatch') || !calls.some((c) => c.some((a) => a.includes('touch'))));
  });

  // @traces 1360-FR-002
  it('reads a context.md saved with CRLF line endings', () => {
    const { root, featureDir } = fixture({ context: CONTEXT.replace(/\n/g, '\r\n') });
    const { run, calls } = runner();
    assert.equal(gate({ featureDir, root, run }), 'skip');
    assert.ok(calls.some((c) => c.join(' ').includes('c89bb72f..origin/trunk') && !c.join(' ').includes('\r')));
  });

  // @traces 1360-FR-002
  it('reads a context.md that starts with a byte order mark', () => {
    const { root, featureDir } = fixture({ context: `﻿${CONTEXT}` });
    assert.equal(gate({ featureDir, root, run: runner().run }), 'skip');
  });

  // @traces 1360-FR-003
  it('dispatches on a context.md that holds binary bytes', () => {
    const { root, featureDir } = fixture({ context: '\u0000\u0001\u0002�'.repeat(5000) });
    assert.match(gate({ featureDir, root, run: runner().run }), /^dispatch/);
  });

  // @traces 1360-FR-003
  it('does not pass a path-traversing anchor URL on to gh', () => {
    const { root, featureDir } = fixture({ context: contextWith(GATHERED + ' · specs trunk c89bb72f', 'x — https://github.com/' + SLUG + '/issues/1360/../../../../user') });
    const { run, calls } = runner();
    const out = gate({ featureDir, root, run });
    assert.ok(!calls.some((c) => c[0] === 'gh' && c.join(' ').includes('..')), out);
  });

  // @traces 1360-FR-002
  it('skips a 5 MB context.md whose Gathered line is intact', () => {
    const { root, featureDir } = fixture({ context: CONTEXT + 'filler line of research notes\n'.repeat(170_000) });
    assert.equal(gate({ featureDir, root, run: runner().run }), 'skip');
  });
});

describe('context-refresh-gate: the command line', () => {
  const cli = join(import.meta.dirname, 'context-refresh-gate.mjs');

  // @traces 1360-FR-001
  it('prints one dispatch line and exits 0 with no argument', () => {
    const { root } = fixture();
    const r = spawnSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^dispatch [^\n]*\n$/);
  });

  // @traces 1360-FR-001
  it('prints one dispatch line and exits 0 for a directory that does not exist', () => {
    const { root } = fixture();
    const r = spawnSync(process.execPath, [cli, join(root, 'nope')], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^dispatch [^\n]*\n$/);
  });

  // @traces 1360-FR-001
  it('prints one line and writes nothing when gh and git are not installed', () => {
    const { root, featureDir } = fixture();
    const r = spawnSync(process.execPath, [cli, featureDir], { cwd: root, encoding: 'utf8', env: { PATH: '/nonexistent' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^dispatch [^\n]*\n$/);
  });
});
