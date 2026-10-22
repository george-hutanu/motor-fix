// @traces 1171-FR-005
import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fingerprint } from './lib/hooks.mjs';

import { classify, fixFrontMatter, latestLapReport, mergeCapability, mergeMain, mergeNeeded, mergeRegistry, overlap, unionConflicts } from './merge-main.mjs';

const cap = (date, features, lines) => ['---', 'capability: platform', `updated: ${date}`, 'features:', ...features.map((f) => `  - ${f}`), '---', '', ...lines, ''].join('\n');

describe('classify', () => {
  it('sorts each conflicted path into the rule that resolves it, or none', () => {
    assert.equal(classify('.specify/capabilities/platform.md'), 'capability');
    assert.equal(classify('.claude/hooks/registry.json'), 'registry');
    assert.equal(classify('apps/api/openapi.json'), 'contract');
    assert.equal(classify('libs/data-access/src/lib/api/garages.service.ts'), 'contract');
    assert.equal(classify('AGENTS.md'), 'other');
    assert.equal(classify('.specify/capabilities/notes/x.txt'), 'other');
    assert.equal(classify('libs/data-access/project.json'), 'other');
  });
});

describe('capability files', () => {
  const conflicted = [
    '---',
    'capability: platform',
    '<<<<<<< HEAD',
    'updated: 2026-10-11',
    '=======',
    'updated: 2026-10-12',
    '>>>>>>> origin/main',
    'features:',
    '  - 421-monorepo-platform',
    '<<<<<<< HEAD',
    '  - 1171-qa-latency',
    '||||||| base',
    '=======',
    '  - 1170-integration-on-demand',
    '>>>>>>> origin/main',
    '---',
    '',
    '- `1171-FR-001` — ours',
    '<<<<<<< HEAD',
    '- `1171-FR-002` — ours',
    '- `same` — both',
    '=======',
    '- `1170-FR-001` — theirs',
    '- `same` — both',
    '>>>>>>> origin/main',
    '',
  ].join('\n');

  it('keeps both sides of every hunk, ours first, drops the base section and a line both sides added', () => {
    const out = unionConflicts(conflicted);
    assert.doesNotMatch(out, /^(<{7}|={7}|>{7}|\|{7})/m);
    assert.match(out, /1171-FR-002[^\n]*\n- `same` — both\n- `1170-FR-001`/);
    assert.equal(out.match(/`same`/g).length, 1);
  });

  it('collapses the front matter to the later `updated:` and a features list free of duplicates', () => {
    const fm = ['---', 'capability: x', 'updated: 2026-10-12', 'updated: 2026-10-09', 'features:', '  - a', '  - b', '  - a', '---', 'body', 'updated: 2026-01-01', ''].join('\n');
    assert.equal(fixFrontMatter(fm), ['---', 'capability: x', 'updated: 2026-10-12', 'features:', '  - a', '  - b', '---', 'body', 'updated: 2026-01-01', ''].join('\n'));
  });

  it('resolves both archives into one capability file: the later date, both features, both sides\' lines', () => {
    const out = mergeCapability({
      base: cap('2026-10-10', ['421-monorepo-platform'], ['- `421-FR-001` — base']),
      ours: cap('2026-10-11', ['421-monorepo-platform', '1171-qa-latency'], ['- `421-FR-001` — base', '- `1171-FR-001` — ours']),
      theirs: cap('2026-10-12', ['421-monorepo-platform', '1170-integration-on-demand'], ['- `421-FR-001` — base', '- `1170-FR-001` — theirs']),
    });
    assert.equal(out, cap('2026-10-12', ['421-monorepo-platform', '1171-qa-latency', '1170-integration-on-demand'], ['- `421-FR-001` — base', '- `1171-FR-001` — ours', '- `1170-FR-001` — theirs']));
  });

  it('merges a file both sides added (no base) the same way', () => {
    const out = mergeCapability({ base: '', ours: cap('2026-10-11', ['a'], ['- `a`']), theirs: cap('2026-10-12', ['b'], ['- `b`']) });
    assert.equal(out, cap('2026-10-12', ['a', 'b'], ['- `a`', '- `b`']));
  });

  it('leaves to a person (null) a front matter both sides changed beyond the date and the features', () => {
    const base = cap('2026-10-10', ['a'], []);
    const ours = base.replace('capability: platform', 'capability: platform-one');
    const theirs = base.replace('capability: platform', 'capability: platform-two');
    assert.equal(mergeCapability({ base, ours, theirs }), null);
  });
});

describe('the hook registry', () => {
  const entry = (id, fp, extra = {}) => ({ id, event: 'PreToolUse', script: `${id}.mjs`, profiles: ['standard'], description: id, fingerprint: fp, ...extra });
  const reg = (hooks, helpers = []) => ({ _comment: 'c', helpers, hooks });

  it('merges entries by id, keeping what each side added and changed', () => {
    const base = reg([entry('a', 'a0'), entry('b', 'b0')]);
    const ours = reg([entry('a', 'a1'), entry('b', 'b0'), entry('ours', 'o0')]);
    const theirs = reg([entry('a', 'a0'), entry('b', 'b1'), entry('theirs', 't0')]);
    const { registry, bless } = mergeRegistry({ base, ours, theirs, fingerprintOf: (s) => ({ 'a.mjs': 'a1', 'b.mjs': 'b1', 'ours.mjs': 'o0', 'theirs.mjs': 't0' })[s] });
    assert.deepEqual(registry.hooks.map((h) => [h.id, h.fingerprint]), [['a', 'a1'], ['b', 'b1'], ['ours', 'o0'], ['theirs', 't0']]);
    assert.deepEqual(bless, []);
  });

  it('takes the fingerprint a side recorded for the script now in the tree, and names the entry under bless when neither matches', () => {
    const base = reg([entry('a', 'a0'), entry('b', 'b0')]);
    const ours = reg([entry('a', 'a1'), entry('b', 'b1')]);
    const theirs = reg([entry('a', 'a2'), entry('b', 'b2')]);
    const { registry, bless } = mergeRegistry({ base, ours, theirs, fingerprintOf: (s) => ({ 'a.mjs': 'a2', 'b.mjs': 'merged' })[s] });
    assert.equal(registry.hooks.find((h) => h.id === 'a').fingerprint, 'a2');
    assert.deepEqual(bless, ['b']);
  });

  it('drops an entry one side removed and the other left alone; merges helpers by script', () => {
    const base = reg([entry('a', 'a0'), entry('gone', 'g0')], [{ script: 'h.js', used_by: 'x' }]);
    const ours = reg([entry('a', 'a0')], [{ script: 'h.js', used_by: 'x' }, { script: 'mine.js', used_by: 'y' }]);
    const theirs = reg([entry('a', 'a0'), entry('gone', 'g0')], [{ script: 'h.js', used_by: 'x, z' }]);
    const { registry } = mergeRegistry({ base, ours, theirs, fingerprintOf: () => 'a0' });
    assert.deepEqual(registry.hooks.map((h) => h.id), ['a']);
    assert.deepEqual(registry.helpers, [{ script: 'h.js', used_by: 'x, z' }, { script: 'mine.js', used_by: 'y' }]);
  });

  it('leaves the file to a person (null) when both sides changed the same field other than the fingerprint', () => {
    const base = reg([entry('a', 'a0')]);
    const ours = reg([entry('a', 'a0', { description: 'mine' })]);
    const theirs = reg([entry('a', 'a0', { description: 'theirs' })]);
    assert.equal(mergeRegistry({ base, ours, theirs, fingerprintOf: () => 'a0' }), null);
  });
});

describe('mergeMain against real repositories', () => {
  let dir;
  let origin;
  let work;
  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const put = (cwd, path, text) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const CAP = '.specify/capabilities/platform.md';
  const run = (opts = {}) => mergeMain({ cwd: work, regenerate: () => ({ status: 0 }), ...opts });

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'merge-main-')));
    origin = join(dir, 'origin.git');
    work = join(dir, 'work');
    const seed = join(dir, 'seed');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    git(dir, 'init', '-q', '-b', 'main', seed);
    put(seed, CAP, cap('2026-10-10', ['421-monorepo-platform'], ['- `421-FR-001` — base']));
    put(seed, 'README.md', 'one\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'seed');
    git(seed, 'remote', 'add', 'origin', origin);
    git(seed, 'push', '-q', 'origin', 'main');
    git(dir, 'clone', '-q', origin, work);
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@example.com'], ['core.hooksPath', '/dev/null']]) git(work, 'config', k, v);
    git(work, 'checkout', '-qb', '1171-qa-latency');
    // main moves on: another feature archives into the same capability file
    put(seed, CAP, cap('2026-10-12', ['421-monorepo-platform', '1170-integration-on-demand'], ['- `421-FR-001` — base', '- `1170-FR-001` — theirs']));
    git(seed, 'commit', '-qam', 'archive 1170');
    git(seed, 'push', '-q', 'origin', 'main');
    // the branch archives too
    put(work, CAP, cap('2026-10-11', ['421-monorepo-platform', '1171-qa-latency'], ['- `421-FR-001` — base', '- `1171-FR-001` — ours']));
    git(work, 'commit', '-qam', 'archive 1171');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('merges two archives into the same capability file without a person and makes the merge commit', () => {
    const out = run();
    assert.equal(out.code, 0);
    assert.equal(out.merged, true);
    assert.deepEqual(out.resolved, [CAP]);
    assert.deepEqual(out.left, []);
    const text = readFileSync(join(work, CAP), 'utf8');
    assert.equal(text, cap('2026-10-12', ['421-monorepo-platform', '1171-qa-latency', '1170-integration-on-demand'], ['- `421-FR-001` — base', '- `1171-FR-001` — ours', '- `1170-FR-001` — theirs']));
    assert.equal(git(work, 'rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 3, 'a merge commit, never a rebase');
    assert.equal(git(work, 'status', '--porcelain'), '');
  });

  it('leaves any other conflicted path to a person, the merge still in progress, and exits 1', () => {
    const seed = join(dir, 'seed');
    put(seed, 'README.md', 'theirs\n');
    git(seed, 'commit', '-qam', 'readme');
    git(seed, 'push', '-q', 'origin', 'main');
    put(work, 'README.md', 'ours\n');
    git(work, 'commit', '-qam', 'readme ours');
    const out = run();
    assert.equal(out.code, 1);
    assert.deepEqual(out.left, ['README.md']);
    assert.deepEqual(out.resolved, [CAP]);
    assert.equal(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: work }).status, 0);
    // a person resolves README.md; the helper finishes the merge in progress
    put(work, 'README.md', 'both\n');
    git(work, 'add', 'README.md');
    const again = run();
    assert.equal(again.code, 0);
    assert.equal(again.merged, true);
  });

  it('regenerates the contract once nothing else is left, after taking main\'s copy', () => {
    const seed = join(dir, 'seed');
    put(seed, 'apps/api/openapi.json', '{"v":"theirs"}\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'contract theirs');
    git(seed, 'push', '-q', 'origin', 'main');
    put(work, 'apps/api/openapi.json', '{"v":"ours"}\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'contract ours');
    const calls = [];
    const out = run({
      regenerate: (cwd) => {
        calls.push(readFileSync(join(cwd, 'apps/api/openapi.json'), 'utf8'));
        writeFileSync(join(cwd, 'apps/api/openapi.json'), '{"v":"generated"}\n');
        return { status: 0 };
      },
    });
    assert.equal(out.code, 0);
    assert.equal(out.regenerated, true);
    assert.deepEqual(calls, ['{"v":"theirs"}\n']);
    assert.equal(readFileSync(join(work, 'apps/api/openapi.json'), 'utf8'), '{"v":"generated"}\n');
    assert.equal(git(work, 'status', '--porcelain'), '');
  });

  it('exits 2 when the generator fails, the merge left in progress', () => {
    const seed = join(dir, 'seed');
    put(seed, 'apps/api/openapi.json', '{"v":"theirs"}\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'contract theirs');
    git(seed, 'push', '-q', 'origin', 'main');
    put(work, 'apps/api/openapi.json', '{"v":"ours"}\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'contract ours');
    const out = run({ regenerate: () => ({ status: 1 }) });
    assert.equal(out.code, 2);
    assert.equal(out.regenerated, false);
  });

  it('resolves the hook registry and names a script that matches neither side under bless', () => {
    const seed = join(dir, 'seed');
    const regOf = (fp) => `${JSON.stringify({ helpers: [], hooks: [{ id: 'pre:x', script: 'x.mjs', fingerprint: fp }] }, null, 2)}\n`;
    // both sides change the gate and re-bless it: the script merges cleanly (different lines), the registry conflicts
    const base = 'a\nb\nc\nd\ne\n';
    put(seed, '.claude/hooks/x.mjs', base);
    put(seed, '.claude/hooks/registry.json', regOf('base'));
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'gate');
    git(seed, 'push', '-q', 'origin', 'main');
    assert.equal(run().code, 0, 'the branch takes the gate (and the capability archive) first');
    put(seed, '.claude/hooks/x.mjs', 'a\nb\nc\nd\nE\n');
    put(seed, '.claude/hooks/registry.json', regOf('theirs'));
    git(seed, 'commit', '-qam', 'gate theirs');
    git(seed, 'push', '-q', 'origin', 'main');
    put(work, '.claude/hooks/x.mjs', 'A\nb\nc\nd\ne\n');
    put(work, '.claude/hooks/registry.json', regOf('ours'));
    git(work, 'commit', '-qam', 'gate ours');
    const out = run();
    assert.equal(out.code, 0);
    assert.deepEqual(out.bless, ['pre:x']);
    assert.ok(out.resolved.includes('.claude/hooks/registry.json'));
    assert.equal(readFileSync(join(work, '.claude/hooks/x.mjs'), 'utf8'), 'A\nb\nc\nd\nE\n');
    const merged = JSON.parse(readFileSync(join(work, '.claude/hooks/registry.json'), 'utf8'));
    assert.notEqual(merged.hooks[0].fingerprint, fingerprint(join(work, '.claude/hooks/x.mjs')), 'the doctor still fails until someone re-blesses');
  });

  it('reports merged false and exits 0 when the branch already has main', () => {
    const first = run();
    assert.equal(first.code, 0);
    const second = run();
    assert.equal(second.code, 0);
    assert.equal(second.merged, false);
    assert.deepEqual(second.resolved, []);
  });
});

// @traces 1357-FR-002
// @traces 1357-FR-003
// @traces 1357-FR-006
describe('overlap: whether origin/main has to be merged in', () => {
  const none = { prFiles: ['apps/api/src/a.ts'], mainFiles: ['apps/web/src/b.ts'], mergeable: 'MERGEABLE', lapReport: null };
  const STORAGE = "::error::the PR's docker-compose.yml has no storage service: merge main into the branch";

  it('is not needed when the two sides share no file, project or infra path', () => {
    assert.deepEqual(overlap(none), { needed: false, rule: null });
  });

  it('is needed on a conflict before any file is compared', () => {
    assert.deepEqual(overlap({ ...none, mergeable: 'CONFLICTING' }), { needed: true, rule: 'conflict' });
  });

  it('is needed when main changed a file the PR changes', () => {
    assert.deepEqual(overlap({ ...none, mainFiles: ['.claude/scripts/x.mjs'], prFiles: ['.claude/scripts/x.mjs'] }), { needed: true, rule: 'same file' });
  });

  it('is needed when main changed another file of the same Nx project', () => {
    assert.deepEqual(overlap({ ...none, mainFiles: ['apps/api/src/other.ts'] }), { needed: true, rule: 'same project' });
    assert.deepEqual(overlap({ ...none, prFiles: ['libs/domain/src/x.ts'], mainFiles: ['libs/domain/project.json'] }), { needed: true, rule: 'same project' });
  });

  it('matches a project on its whole folder name, and treats .claude, scripts and .specify as no project', () => {
    assert.equal(overlap({ ...none, prFiles: ['apps/web/src/a.ts'], mainFiles: ['apps/web-e2e/src/b.ts'] }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['.claude/scripts/a.mjs'], mainFiles: ['.claude/scripts/b.mjs'] }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['scripts/a.ts'], mainFiles: ['scripts/b.ts'] }).needed, false);
    assert.equal(overlap({ ...none, prFiles: ['apps/x.json'], mainFiles: ['apps/y.json'] }).needed, false);
  });

  it('is needed when main changed any infra path, whatever the PR changed', () => {
    for (const path of [
      'docker-compose.yml',
      'docker-compose.test.yml',
      'package-lock.json',
      'libs/domain/prisma/schema.prisma',
      'apps/api/openapi.json',
      '.github/workflows/ci.yml',
      '.claude/hooks/registry.json',
      '.specify/capabilities/platform.md',
    ]) {
      assert.deepEqual(overlap({ ...none, prFiles: ['.claude/skills/x/SKILL.md'], mainFiles: [path] }), { needed: true, rule: 'infra path' }, path);
    }
  });

  it('matches an infra path from the repository root only', () => {
    for (const path of ['apps/web/package-lock.json', 'infra/docker-compose.yml', 'docs/.github/workflows/x.yml', 'libs/domain/prisma-notes.md']) {
      assert.equal(overlap({ ...none, prFiles: ['.claude/skills/x/SKILL.md'], mainFiles: [path] }).needed, false, path);
    }
  });

  it('is needed when the latest lap report shows the compose storage error', () => {
    assert.deepEqual(overlap({ ...none, lapReport: `# QA\n${STORAGE}\n` }), { needed: true, rule: 'lap report' });
    assert.equal(overlap({ ...none, lapReport: '# QA\nall flows passed\n' }).needed, false);
  });

  it('names the first rule that holds, in the order conflict, same file, same project, infra path, lap report', () => {
    const all = { prFiles: ['apps/api/src/a.ts'], mainFiles: ['apps/api/src/a.ts', 'package-lock.json'], mergeable: 'CONFLICTING', lapReport: STORAGE };
    assert.equal(overlap(all).rule, 'conflict');
    assert.equal(overlap({ ...all, mergeable: 'MERGEABLE' }).rule, 'same file');
    assert.equal(overlap({ ...all, mergeable: 'MERGEABLE', mainFiles: ['apps/api/src/b.ts', 'package-lock.json'] }).rule, 'same project');
    assert.equal(overlap({ ...all, mergeable: 'UNKNOWN', mainFiles: ['package-lock.json'] }).rule, 'infra path');
    assert.equal(overlap({ ...all, mergeable: null, mainFiles: ['README.md'] }).rule, 'lap report');
  });
});

// @traces 1357-FR-002
// @traces 1357-FR-003
// @traces 1357-FR-005
// @traces 1357-FR-006
describe('mergeNeeded: the --needed answer for the current branch', () => {
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const fail = (stderr) => ({ status: 1, stdout: '', stderr });
  /** A fake git: the answer for each command by its first words; every call is recorded. */
  const fakeGit = (answers) => {
    const calls = [];
    const git = (args) => {
      calls.push(args.join(' '));
      const key = Object.keys(answers).find((k) => args.join(' ').startsWith(k));
      return key ? answers[key] : ok();
    };
    return { git, calls };
  };
  const behind = (over = {}) =>
    fakeGit({
      'fetch': ok(),
      'merge-base HEAD origin/main': ok('base\n'),
      'rev-list --count base..origin/main': ok('3\n'),
      'diff --name-only --no-renames base HEAD': ok('apps/api/src/a.ts\n'),
      'diff --name-only --no-renames base origin/main': ok('apps/web/src/b.ts\n'),
      ...over,
    });
  const gh = (mergeable) => () => ({ code: 0, stdout: `${mergeable}\n`, stderr: '' });

  it('answers not needed with exit 1 for a behind head that shares nothing with main', () => {
    const { git } = behind();
    assert.deepEqual(mergeNeeded({ git, gh: gh('MERGEABLE'), lapReport: () => null }), { code: 1, line: 'not needed' });
  });

  it('answers needed with exit 0 and the rule when main changed a file the PR changes', () => {
    const { git } = behind({ 'diff --name-only --no-renames base origin/main': ok('apps/api/src/a.ts\n') });
    assert.deepEqual(mergeNeeded({ git, gh: gh('MERGEABLE'), lapReport: () => null }), { code: 0, line: 'needed: same file' });
  });

  it('answers needed on a conflict GitHub reports', () => {
    const { git } = behind();
    assert.deepEqual(mergeNeeded({ git, gh: gh('CONFLICTING'), lapReport: () => null }), { code: 0, line: 'needed: conflict' });
  });

  it('reads the lap report and answers needed on the compose storage error', () => {
    const { git } = behind();
    const lapReport = () => "the PR's docker-compose.yml has no storage service: merge main into the branch";
    assert.deepEqual(mergeNeeded({ git, gh: gh('MERGEABLE'), lapReport }), { code: 0, line: 'needed: lap report' });
  });

  it('answers not needed without reading a file when main has no commit since the merge-base', () => {
    const { git, calls } = behind({ 'rev-list --count base..origin/main': ok('0\n') });
    let asked = false;
    const out = mergeNeeded({ git, gh: () => ((asked = true), { code: 0, stdout: 'CONFLICTING\n', stderr: '' }), lapReport: () => ((asked = true), null) });
    assert.deepEqual(out, { code: 1, line: 'not needed' });
    assert.equal(asked, false);
    assert.ok(!calls.some((c) => c.startsWith('diff')), calls.join('\n'));
  });

  it('falls through to the file rules when the mergeability cannot be read, naming it, and never says not needed on that alone', () => {
    const unread = () => ({ code: 1, stdout: '', stderr: 'no pull requests found for branch "x"' });
    const clean = mergeNeeded({ git: behind().git, gh: unread, lapReport: () => null });
    assert.equal(clean.code, 1);
    assert.match(clean.warning, /mergeability unread: no pull requests found/);
    const shared = mergeNeeded({ git: behind({ 'diff --name-only --no-renames base origin/main': ok('package-lock.json\n') }).git, gh: unread, lapReport: () => null });
    assert.equal(shared.code, 0);
    assert.equal(shared.line, 'needed: infra path');
  });

  it('treats UNKNOWN mergeability as unread, not as a conflict', () => {
    const out = mergeNeeded({ git: behind().git, gh: gh('UNKNOWN'), lapReport: () => null });
    assert.equal(out.code, 1);
    assert.match(out.warning, /mergeability unread: UNKNOWN/);
  });

  it('exits 2 with the reason and no answer when git cannot fetch, find the merge-base or diff', () => {
    for (const broken of ['fetch', 'merge-base HEAD origin/main', 'rev-list --count base..origin/main', 'diff --name-only --no-renames base HEAD', 'diff --name-only --no-renames base origin/main']) {
      const out = mergeNeeded({ git: behind({ [broken]: fail('boom') }).git, gh: gh('MERGEABLE'), lapReport: () => null });
      assert.equal(out.code, 2, broken);
      assert.equal(out.line, undefined, broken);
      assert.match(out.error, /boom/, broken);
    }
  });

  it('counts a rename under its old and new paths, and compares against origin/main, never a pull ref', () => {
    const { git, calls } = behind();
    mergeNeeded({ git, gh: gh('MERGEABLE'), lapReport: () => null });
    assert.ok(calls.every((c) => !/refs\/pull/.test(c)), calls.join('\n'));
    assert.ok(calls.includes('diff --name-only --no-renames base origin/main'), calls.join('\n'));
    assert.ok(!calls.some((c) => /^(merge|commit|checkout|reset|push)( |$)/.test(c)), 'it changes nothing');
  });
});

// @traces 1357-FR-003
describe('latestLapReport', () => {
  let dir;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lap-report-')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the report of the highest-numbered lap, by number not by name', () => {
    for (const [lap, text] of [['lap2', 'two'], ['lap10', 'ten'], ['lap9', 'nine']]) {
      mkdirSync(join(dir, 'pr-review', lap), { recursive: true });
      writeFileSync(join(dir, 'pr-review', lap, 'report.md'), text);
    }
    assert.equal(latestLapReport(dir), 'ten');
  });

  it('is null with no pr-review folder, no lap, or a lap without its report', () => {
    assert.equal(latestLapReport(dir), null);
    assert.equal(latestLapReport(null), null);
    mkdirSync(join(dir, 'pr-review', 'lap1'), { recursive: true });
    assert.equal(latestLapReport(dir), null);
  });
});
