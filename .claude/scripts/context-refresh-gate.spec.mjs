import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gate } from './context-refresh-gate.mjs';

const SLUG = 'george-hutanu/motor-fix-specs';
const GATHERED = '2026-10-22T11:20:19Z';
const BEFORE = '2026-10-22T10:00:00Z';
const AFTER = '2026-10-22T12:00:00Z';

const CONTEXT = `# Feature Context: x

- **Feature**: 1360-x
- **Anchor**: ST-1360 A title — https://github.com/${SLUG}/issues/1360
- **Gathered**: ${GATHERED} · specs trunk c89bb72f
`;

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ context = CONTEXT, clone = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'refresh-gate-'));
  roots.push(root);
  const featureDir = join(root, 'specs', '1360-x');
  mkdirSync(featureDir, { recursive: true });
  if (context !== null) writeFileSync(join(featureDir, 'context.md'), context);
  if (clone) mkdirSync(join(root, '.motor-fix-specs'));
  return { root, featureDir };
}

const story = (over = {}) => ({ number: 1360, title: 'ST-1360 A title', labels: [{ name: 'type: task' }, { name: 'EP-1' }], created_at: BEFORE, updated_at: BEFORE, ...over });
const epic = (over = {}) => ({ number: 682, title: 'EP-1 Foundations', labels: [{ name: 'epic' }], created_at: BEFORE, updated_at: BEFORE, ...over });

/** A fake `gh`/`git` answering the gate's reads; `over` replaces one answer by a key. */
function runner(over = {}) {
  const calls = [];
  const answers = {
    story: { code: 0, stdout: JSON.stringify(story()) },
    epics: { code: 0, stdout: JSON.stringify([epic(), { number: 683, title: 'EP-10 Other', labels: [{ name: 'epic' }], created_at: BEFORE, updated_at: AFTER }]) },
    siblings: { code: 0, stdout: JSON.stringify([story()]) },
    fetch: { code: 0, stdout: '' },
    log: { code: 0, stdout: '' },
    ...over,
  };
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

const listing = (dir) => readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);

describe('context-refresh-gate: skip when nothing moved', () => {
  // @traces 1360-FR-001
  it('prints skip for an unchanged story, epic, siblings and docs, and writes nothing', () => {
    const { root, featureDir } = fixture();
    const before = listing(featureDir);
    const { run, calls } = runner();
    assert.equal(gate({ featureDir, root, run }), 'skip');
    assert.deepEqual(listing(featureDir), before);
    assert.ok(calls.some((c) => c.join(' ') === `git -C ${join(root, '.motor-fix-specs')} log --oneline c89bb72f..origin/trunk -- docs/`));
  });

  // @traces 1360-FR-002
  it('reads the siblings since the Gathered time and ignores another epic updated later', () => {
    const { root, featureDir } = fixture();
    const { run, calls } = runner();
    assert.equal(gate({ featureDir, root, run }), 'skip');
    assert.ok(calls.some((c) => c.join(' ').includes(`labels=EP-1&state=all&since=${GATHERED}`)));
  });

  // @traces 1360-FR-002
  it('checks only the story and the docs when the story carries no EP label', () => {
    const { root, featureDir } = fixture();
    const { run, calls } = runner({ story: { code: 0, stdout: JSON.stringify(story({ labels: [{ name: 'type: task' }] })) } });
    assert.equal(gate({ featureDir, root, run }), 'skip');
    assert.ok(!calls.some((c) => c.join(' ').includes('labels=')));
  });

  // @traces 1360-FR-002
  it('finds the story by the ST id when the Anchor has no issue URL', () => {
    const { root, featureDir } = fixture({ context: CONTEXT.replace(` — https://github.com/${SLUG}/issues/1360`, '') });
    const { run } = runner();
    assert.equal(gate({ featureDir, root, run }), 'skip');
  });
});

describe('context-refresh-gate: dispatch on a change', () => {
  // @traces 1360-FR-002
  it('dispatches when the story was updated after the Gathered time', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ story: { code: 0, stdout: JSON.stringify(story({ updated_at: AFTER })) } });
    assert.equal(gate({ featureDir, root, run }), `dispatch story #1360 updated ${AFTER}`);
  });

  // @traces 1360-FR-002
  it('dispatches when the epic was updated after the Gathered time', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ epics: { code: 0, stdout: JSON.stringify([epic({ updated_at: AFTER })]) } });
    assert.equal(gate({ featureDir, root, run }), `dispatch epic #682 updated ${AFTER}`);
  });

  // @traces 1360-FR-002
  it('dispatches on a new sibling and ignores a pull request, the story, the epic and an older sibling', () => {
    const { root, featureDir } = fixture();
    const siblings = [
      story({ updated_at: BEFORE }),
      { number: 1400, title: 'a PR', pull_request: {}, created_at: AFTER, updated_at: AFTER },
      { number: 1300, title: 'ST-1300 old', created_at: BEFORE, updated_at: AFTER },
    ];
    const quiet = runner({ siblings: { code: 0, stdout: JSON.stringify(siblings) } });
    assert.equal(gate({ featureDir, root, run: quiet.run }), 'skip');
    const fresh = runner({ siblings: { code: 0, stdout: JSON.stringify([...siblings, { number: 1401, title: 'ST-1401 new', created_at: AFTER, updated_at: AFTER }]) } });
    assert.equal(gate({ featureDir, root, run: fresh.run }), 'dispatch new sibling #1401');
  });

  // @traces 1360-FR-002
  it('dispatches when docs changed on the specs trunk after the Gathered sha', () => {
    const { root, featureDir } = fixture();
    const { run } = runner({ log: { code: 0, stdout: 'aaa1111 docs: one\nbbb2222 docs: two\n' } });
    assert.equal(gate({ featureDir, root, run }), 'dispatch docs changed (2 commits)');
  });
});

describe('context-refresh-gate: dispatch on a read error', () => {
  const cases = [
    ['no context.md', { context: null }, {}, /^dispatch .*context\.md/],
    ['a Gathered date without a time', { context: CONTEXT.replace(`${GATHERED} · specs trunk c89bb72f`, '2026-10-22') }, {}, /^dispatch .*Gathered/],
    ['a Gathered time without a sha', { context: CONTEXT.replace(' · specs trunk c89bb72f', '') }, {}, /^dispatch .*Gathered/],
    ['no anchor issue', { context: CONTEXT.replace(/- \*\*Anchor\*\*.*\n/, '- **Anchor**: terms: garage, quote\n') }, {}, /^dispatch .*anchor/],
    ['gh failing', {}, { story: { code: 1, stdout: '', stderr: 'HTTP 502' } }, /^dispatch .*HTTP 502/],
    ['gh answering bad JSON', {}, { story: { code: 0, stdout: '<html>' } }, /^dispatch /],
    ['the epic not found', {}, { epics: { code: 0, stdout: '[]' } }, /^dispatch no epic for EP-1$/],
    ['the siblings unreadable', {}, { siblings: { code: 1, stdout: '', stderr: 'rate limit' } }, /^dispatch .*rate limit/],
    ['no specs clone', { clone: false }, {}, /^dispatch .*clone/],
    ['git fetch failing', {}, { fetch: { code: 128, stdout: '', stderr: 'could not read from remote' } }, /^dispatch .*fetch/],
    ['git log failing', {}, { log: { code: 128, stdout: '', stderr: 'bad revision' } }, /^dispatch .*bad revision/],
    ['a call killed by its timeout', {}, { story: { code: 1, stdout: '', stderr: 'Error: spawnSync gh ETIMEDOUT' } }, /^dispatch .*ETIMEDOUT/],
  ];
  for (const [name, fx, over, want] of cases) {
    // @traces 1360-FR-003
    it(`dispatches on ${name}`, () => {
      const { root, featureDir } = fixture(fx);
      const { run } = runner(over);
      assert.match(gate({ featureDir, root, run }), want);
    });
  }
});

describe('context-refresh-gate: the command line', () => {
  // @traces 1360-FR-001
  it('prints one line and exits 0 even when it dispatches', () => {
    const { root, featureDir } = fixture({ context: null });
    const r = spawnSync(process.execPath, [join(import.meta.dirname, 'context-refresh-gate.mjs'), featureDir], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /^dispatch /);
  });
});
