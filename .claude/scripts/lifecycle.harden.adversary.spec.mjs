import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { step } from './lifecycle.mjs';

const FEATURE = '696-lifecycle-script';
const TITLE = 'chore(harness): ST-696 lifecycle steps as one script call each';
const REST = 'gh api repos/{owner}/{repo}/';
const LOCAL = /^(node scripts\/(observability|structure)|npm run lint|sh scripts\/heavy\.sh)/;
const TREE = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';

let repo;

function fixture() {
  repo = mkdtempSync(join(tmpdir(), 'lifecycle-hard-'));
  const featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696 (Task)\n');
  writeFileSync(join(featureDir, 'tracker-sync.md'), `# Tracker sync — ${FEATURE}\n\n- 2026-10-05 · start · ST-696 · To do → Planning\n`);
  writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## Why\n\n_(fill in: why)_\n');
  writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
}

const pull = { number: 141, state: 'open', merged_at: null, draft: true, title: TITLE, body: '## Why\n\nbecause', html_url: 'https://github.com/george-hutanu/motor-fix/pull/141', head: { ref: FEATURE, sha: 'abcdef1234567890' }, labels: [] };

function harness({ answers = [] } = {}) {
  const calls = [];
  const table = [
    ...answers,
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${FEATURE}\n` }],
    ['git rev-parse HEAD', { stdout: 'abcdef1234567890\n' }],
    ['git merge-base HEAD origin/main', { stdout: 'b45e0000\n' }],
    [`${REST}pulls?head=`, { stdout: JSON.stringify([[pull]]) }],
    [`${REST}pulls/${pull.number} -X GET`, { stdout: JSON.stringify(pull) }],
  ];
  const run = (file, args) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    const hit = table.find(([prefix]) => cmd.startsWith(prefix));
    return { code: 0, stdout: '', stderr: '', ...hit?.[1] };
  };
  return { io: { repo, env: { GH_TOKEN: 'tok' }, run, gate: () => ({ code: 0, stderr: '' }) }, calls };
}

const tree = (sha = TREE, base = 'b45e0000', status = '') => [
  ['git status --porcelain', { stdout: status }],
  ['git write-tree', { stdout: `${sha}\n` }],
  ['git merge-base HEAD origin/main', { stdout: `${base}\n` }],
];
const ran = (h) => h.calls.filter((c) => LOCAL.test(c));
const cacheDir = () => join(repo, '.specify', '.cache');
const proofFile = (name = basename(repo)) => join(cacheDir(), `local-checks-${name}.json`);
const seed = (body, name) => {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(proofFile(name), body);
};

// @traces 1358-FR-014
describe('a proof file that cannot be trusted', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  for (const [name, body] of [
    ['truncated JSON', '{"tree":"aaaa1111bbbb2222cccc3333dddd4444eeee5555","ba'],
    ['an empty file', ''],
    ['the JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a bare string', '"aaaa1111"'],
    ['a tree that is a number', JSON.stringify({ tree: 12345, base: 'b45e0000' })],
    ['binary bytes', '\u0000\u0001\u0002￿'],
    ['a proof with the tree and no base', JSON.stringify({ tree: TREE })],
  ]) {
    it(`runs the checks and replaces the file when it holds ${name}`, () => {
      seed(body);
      const h = harness({ answers: tree() });
      const result = step(['check'], h.io);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(ran(h).length, 4);
      assert.ok(!result.did.some((d) => /reused proof/.test(d)));
      const written = JSON.parse(readFileSync(proofFile(), 'utf8'));
      assert.equal(written.tree, TREE);
      assert.equal(written.base, 'b45e0000');
    });
  }

  it('runs the checks when the proof path is a directory', () => {
    mkdirSync(proofFile(), { recursive: true });
    const h = harness({ answers: tree() });
    const result = step(['check'], h.io);
    assert.equal(ran(h).length, 4, JSON.stringify(result));
  });

  it('runs the checks when the proof matches the tree but not the merge base', () => {
    seed(JSON.stringify({ tree: TREE, base: 'other000', at: 'x' }));
    const h = harness({ answers: tree() });
    step(['check'], h.io);
    assert.equal(ran(h).length, 4);
    assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).base, 'b45e0000');
  });

  it('runs the checks when the proof matches the merge base but not the tree', () => {
    seed(JSON.stringify({ tree: 'ffff0000', base: 'b45e0000', at: 'x' }));
    const h = harness({ answers: tree() });
    step(['check'], h.io);
    assert.equal(ran(h).length, 4);
  });

  it('does not reuse a proof file written for another worktree', () => {
    seed(JSON.stringify({ tree: TREE, base: 'b45e0000', at: 'x' }), 'some-other-worktree');
    const h = harness({ answers: tree() });
    const result = step(['check'], h.io);
    assert.equal(ran(h).length, 4);
    assert.ok(!result.did.some((d) => /reused proof/.test(d)));
    assert.ok(existsSync(proofFile()));
    assert.equal(JSON.parse(readFileSync(proofFile('some-other-worktree'), 'utf8')).at, 'x');
  });

  it('keeps one proof file per worktree however often it checks', () => {
    for (const sha of ['aaaa1111', 'bbbb2222', 'cccc3333']) step(['check'], harness({ answers: tree(sha) }).io);
    assert.deepEqual(readdirSync(cacheDir()), [`local-checks-${basename(repo)}.json`]);
    assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).tree, 'cccc3333');
  });
});

// @traces 1358-FR-014
describe('what counts as a clean tree', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  for (const [name, status] of [
    ['an untracked file', '?? notes.txt\n'],
    ['a staged addition', 'A  new.ts\n'],
    ['a rename', 'R  old.ts -> new.ts\n'],
    ['a deleted file', ' D gone.ts\n'],
    ['an unmerged path', 'UU conflict.ts\n'],
    ['a file with a space in its name', '?? "a b.txt"\n'],
  ]) {
    it(`records no proof and reuses none when git status shows ${name}`, () => {
      seed(JSON.stringify({ tree: TREE, base: 'b45e0000', at: 'old' }));
      const h = harness({ answers: tree(TREE, 'b45e0000', status) });
      step(['check'], h.io);
      assert.equal(ran(h).length, 4);
      assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).at, 'old');
    });
  }

  it('treats a status of only whitespace as clean', () => {
    const h = harness({ answers: tree(TREE, 'b45e0000', '  \n\n') });
    step(['check'], h.io);
    assert.ok(existsSync(proofFile()));
  });

  it('records no proof when the merge base is only whitespace', () => {
    const h = harness({ answers: tree(TREE, '  ') });
    step(['check'], h.io);
    assert.ok(!existsSync(proofFile()));
  });

  it('records no proof when write-tree prints only whitespace', () => {
    const h = harness({ answers: tree('  ') });
    step(['check'], h.io);
    assert.ok(!existsSync(proofFile()));
  });
});

// @traces 1358-FR-015
describe('ready and check share one proof', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const body = () => {
    const file = join(repo, 'body.md');
    writeFileSync(file, '## Why\n\nfilled\n');
    return file;
  };

  it('writes a proof from a passing ready that a following check reuses', () => {
    const r = step(['ready', '--body-file', body()], harness({ answers: tree() }).io);
    assert.ok(existsSync(proofFile()), JSON.stringify(r));
    const h = harness({ answers: tree() });
    const result = step(['check'], h.io);
    assert.deepEqual(ran(h), []);
    assert.ok(result.did.includes(`local checks: reused proof ${TREE.slice(0, 7)}`));
  });

  it('writes no proof when ready stops on a failing local check', () => {
    const h = harness({ answers: [['npm run lint', { code: 1, stdout: 'refused\n' }], ...tree()] });
    const result = step(['ready', '--body-file', body()], h.io);
    assert.equal(result.ok, false);
    assert.ok(!existsSync(proofFile()));
  });

  it('runs the checks again after the tree changes between two checks', () => {
    step(['check'], harness({ answers: tree('aaaa1111') }).io);
    const h = harness({ answers: tree('bbbb2222') });
    step(['check'], h.io);
    assert.equal(ran(h).length, 4);
  });

  it('reuses the proof on a third and fourth run without rewriting it', () => {
    step(['check'], harness({ answers: tree() }).io);
    const first = readFileSync(proofFile(), 'utf8');
    for (let i = 0; i < 3; i++) assert.deepEqual(ran((() => { const h = harness({ answers: tree() }); step(['check'], h.io); return h; })()), []);
    assert.equal(readFileSync(proofFile(), 'utf8'), first);
  });

  it('names the first seven characters of a short tree hash whole', () => {
    step(['check'], harness({ answers: tree('abc') }).io);
    const result = step(['check'], harness({ answers: tree('abc') }).io);
    assert.ok(result.did.includes('local checks: reused proof abc'), JSON.stringify(result.did));
  });
});
