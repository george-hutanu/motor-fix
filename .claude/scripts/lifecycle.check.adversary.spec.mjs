import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from './lifecycle.mjs';

const FEATURE = '696-lifecycle-script';
const BRANCH = FEATURE;
const TITLE = 'chore(harness): ST-696 lifecycle steps as one script call each';
const REST = 'gh api repos/{owner}/{repo}/';
const LOCAL = /^(node scripts\/|npm run lint|sh scripts\/heavy\.sh)/;

let repo;

function fixture() {
  repo = mkdtempSync(join(tmpdir(), 'lifecycle-adv-'));
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

const pullOf = (over = {}) => ({ number: 141, state: 'open', merged_at: null, draft: true, title: TITLE, body: '## Why\n\nbecause', html_url: 'https://github.com/george-hutanu/motor-fix/pull/141', head: { ref: BRANCH, sha: 'abcdef1234567890' }, labels: [], ...over });

function harness({ pull = pullOf(), mergeBase = { stdout: 'b45e0000\n' }, answers = [], noPr = false } = {}) {
  const calls = [];
  const invocations = [];
  const bodies = [];
  const table = [
    ...answers,
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${BRANCH}\n` }],
    ['git rev-parse HEAD', { stdout: 'abcdef1234567890\n' }],
    ['git merge-base HEAD origin/main', mergeBase],
    ['git rev-parse origin/main', { stdout: 'ma1n0000\n' }],
    [`${REST}pulls?head=`, { stdout: JSON.stringify([noPr ? [] : [pull]]) }],
    [`${REST}pulls/${pull.number} -X GET`, { stdout: JSON.stringify(pull) }],
  ];
  const run = (file, args, opts = {}) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    invocations.push({ cmd, file, args, opts });
    if (cmd.startsWith('node scripts/pr-body-check.ts')) {
      const at = args.indexOf('--body-file');
      bodies.push(readFileSync(args[at + 1], 'utf8'));
    }
    const hit = table.find(([prefix]) => cmd.startsWith(prefix));
    const out = typeof hit?.[1] === 'function' ? hit[1](cmd) : hit?.[1];
    return { code: 0, stdout: '', stderr: '', ...out };
  };
  return { io: { repo, env: { GH_TOKEN: 'tok' }, run, gate: () => ({ code: 0, stderr: '' }) }, calls, invocations, bodies };
}

const local = (h) => h.calls.filter((c) => LOCAL.test(c));

// @traces 1355-FR-001
// @traces 1355-FR-002
describe('lifecycle check: a failure of any kind stops the push', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  for (const [prefix, name] of [
    ['node scripts/observability-inventory.ts', 'observability-inventory'],
    ['node scripts/structure-check.ts', 'structure-check'],
    ['npm run lint', 'lint'],
    ['sh scripts/heavy.sh', 'affected typecheck and unit tests'],
    ['node scripts/pr-body-check.ts', 'pr-body-check'],
  ]) {
    it(`stops at ${name} when it exits with a signal-style null code and only stderr`, () => {
      const h = harness({ answers: [[prefix, { code: null, stdout: '', stderr: 'spawn ENOENT' }]] });
      const result = step(['check'], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, name);
      assert.match(result.fix, /spawn ENOENT/);
    });

    it(`stops at ${name} on exit 127 and names that check, not a later one`, () => {
      const h = harness({ answers: [[prefix, { code: 127, stdout: '', stderr: 'command not found' }]] });
      const result = step(['check'], h.io);
      assert.equal(result.ok, false);
      assert.equal(result.stopped, name);
      const lastLocal = local(h).at(-1);
      assert.ok(lastLocal.startsWith(prefix), local(h).join('\n'));
    });
  }

  it('shows the end of a ten-thousand-line failure, where the cause sits', () => {
    const noise = Array.from({ length: 10000 }, (_, i) => `ok line ${i}`).join('\n');
    const h = harness({ answers: [['node scripts/observability-inventory.ts', { code: 1, stdout: `${noise}\ninventory: no entry for queue mail-unique-marker\n` }]] });
    const result = step(['check'], h.io);
    assert.equal(result.ok, false);
    assert.match(result.fix, /no entry for queue mail-unique-marker/);
  });

  it('keeps both streams of a failing check', () => {
    const h = harness({ answers: [['npm run lint', { code: 1, stdout: 'STDOUT-MARK\n', stderr: 'STDERR-MARK\n' }]] });
    const result = step(['check'], h.io);
    assert.match(result.fix, /STDOUT-MARK/);
    assert.match(result.fix, /STDERR-MARK/);
  });

  it('stops without running the typecheck and tests when git cannot give a merge base', () => {
    const h = harness({ mergeBase: { code: 128, stdout: '', stderr: 'fatal: Not a valid object name origin/main' } });
    const result = step(['check'], h.io);
    assert.equal(result.ok, false);
    assert.ok(!h.calls.some((c) => c.startsWith('sh scripts/heavy.sh') && /--base=(\s|$|undefined)/.test(c)), h.calls.join('\n'));
    assert.ok(!h.calls.some((c) => c.startsWith('sh scripts/heavy.sh')), h.calls.join('\n'));
  });

  it('stops without running the typecheck and tests when the merge base is empty', () => {
    const h = harness({ mergeBase: { code: 0, stdout: '\n' } });
    const result = step(['check'], h.io);
    assert.equal(result.ok, false);
    assert.ok(!h.calls.some((c) => c.startsWith('sh scripts/heavy.sh')), h.calls.join('\n'));
  });
});

// @traces 1355-FR-001
describe('lifecycle check: what the body check is given', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('hands the PR body over byte for byte, unicode included', () => {
    const body = '## Why\n\nçînd mașina nu pornește — 日本語 ✓ 🚗\r\n\n```sh\n$(echo hi) `x`\n```\n';
    const h = harness({ pull: pullOf({ body }) });
    assert.equal(step(['check'], h.io).ok, true);
    assert.deepEqual(h.bodies, [body]);
  });

  it('runs the body check against an empty file when the PR body is null', () => {
    const h = harness({ pull: pullOf({ body: null }) });
    const result = step(['check'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(h.bodies, ['']);
  });

  it('passes a hostile title as one argument', () => {
    const title = 'feat(api): ST-1 a; rm -rf / `x` $(y) "q" \'z\'';
    const h = harness({ pull: pullOf({ title }) });
    step(['check'], h.io);
    const call = h.invocations.find((i) => i.cmd.startsWith('node scripts/pr-body-check.ts'));
    assert.equal(call.args[call.args.indexOf('--title') + 1], title);
  });

  it('skips the body check, saying so, and still runs every other check when no PR exists', () => {
    const h = harness({ noPr: true });
    const result = step(['check'], h.io);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!h.calls.some((c) => c.startsWith('node scripts/pr-body-check.ts')));
    assert.ok(result.did.some((d) => /pr-body-check skipped/.test(d)), JSON.stringify(result.did));
    assert.equal(local(h).length, 4, local(h).join('\n'));
  });

  it('uses the draft rules for a draft and the full rules for a ready PR', () => {
    const draft = harness({ pull: pullOf({ draft: true }) });
    step(['check'], draft.io);
    assert.match(draft.calls.find((c) => c.startsWith('node scripts/pr-body-check.ts')), /--draft$/);
    const ready = harness({ pull: pullOf({ draft: false }) });
    step(['check'], ready.io);
    assert.doesNotMatch(ready.calls.find((c) => c.startsWith('node scripts/pr-body-check.ts')), /--draft/);
  });

  it('runs the same checks in the same order on a second call', () => {
    const first = harness();
    const second = harness();
    step(['check'], first.io);
    step(['check'], second.io);
    const norm = (calls) => calls.filter((c) => LOCAL.test(c)).map((c) => c.replace(/--body-file \S+/, '--body-file X'));
    assert.deepEqual(norm(second.calls), norm(first.calls));
  });
});

// @traces 1355-FR-002
describe('lifecycle check: the affected tests are measured from the merge base', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('passes the merge base sha as --base and runs unit specs only', () => {
    const h = harness({ mergeBase: { stdout: '0123abcd\n' } });
    step(['check'], h.io);
    const cmd = h.calls.find((c) => c.startsWith('sh scripts/heavy.sh'));
    assert.match(cmd, /--base=0123abcd(\s|$)/);
    assert.match(cmd, /TEST_SUITE=unit/);
    assert.match(cmd, /nx affected -t typecheck test/);
  });
});

// @traces 1358-FR-014
describe('lifecycle check: a failing check leaves no proof behind', () => {
  beforeEach(fixture);
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const proofFile = () => join(repo, '.specify', '.cache', 'local-checks.json');
  const clean = (sha) => [
    ['git status --porcelain', { stdout: '' }],
    ['git write-tree', { stdout: `${sha}\n` }],
  ];

  for (const prefix of ['node scripts/observability-inventory.ts', 'node scripts/structure-check.ts', 'npm run lint', 'sh scripts/heavy.sh']) {
    it(`records no proof when ${prefix} fails`, () => {
      const h = harness({ answers: [[prefix, { code: 1, stdout: 'refused\n' }], ...clean('aaaa1111')] });
      assert.equal(step(['check'], h.io).ok, false);
      assert.ok(!existsSync(proofFile()));
    });
  }

  it('keeps the old proof after a failure on a new tree, and never reads it for that tree', () => {
    assert.equal(step(['check'], harness({ answers: clean('aaaa1111') }).io).ok, true);
    const failed = harness({ answers: [['npm run lint', { code: 1, stdout: 'refused\n' }], ...clean('bbbb2222')] });
    assert.equal(step(['check'], failed.io).ok, false);
    assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).tree, 'aaaa1111');
    const rerun = harness({ answers: clean('bbbb2222') });
    const result = step(['check'], rerun.io);
    assert.equal(result.ok, true);
    assert.equal(local(rerun).filter((c) => !c.startsWith('node scripts/pr-body-check.ts')).length, 4);
    assert.ok(!result.did.some((d) => /reused proof/.test(d)));
  });
});

// Cases first written as the hardening pass's own file, kept with their helpers.
describe('hardening: the proof of the local checks', () => {
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
      ['git rev-parse origin/main', { stdout: 'ma1n0000\n' }],
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
    ['git rev-parse origin/main', { stdout: 'ma1n0000\n' }],
  ];
  const ran = (h) => h.calls.filter((c) => LOCAL.test(c));
  const cacheDir = () => join(repo, '.specify', '.cache');
  const proofFile = () => join(cacheDir(), 'local-checks.json');
  const seed = (body) => {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(proofFile(), body);
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

    it('runs the checks when the proof matches the tree and merge base but not origin/main', () => {
      seed(JSON.stringify({ tree: TREE, base: 'b45e0000', main: 'old0main', at: 'x' }));
      const h = harness({ answers: tree() });
      step(['check'], h.io);
      assert.equal(ran(h).length, 4);
      assert.equal(JSON.parse(readFileSync(proofFile(), 'utf8')).main, 'ma1n0000');
    });

    it('runs the checks when the proof matches the merge base but not the tree', () => {
      seed(JSON.stringify({ tree: 'ffff0000', base: 'b45e0000', at: 'x' }));
      const h = harness({ answers: tree() });
      step(['check'], h.io);
      assert.equal(ran(h).length, 4);
    });

    it('keeps one proof file per worktree however often it checks', () => {
      for (const sha of ['aaaa1111', 'bbbb2222', 'cccc3333']) step(['check'], harness({ answers: tree(sha) }).io);
      assert.deepEqual(readdirSync(cacheDir()), ['local-checks.json']);
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
        seed(JSON.stringify({ tree: TREE, base: 'b45e0000', main: 'ma1n0000', at: 'old' }));
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
});
