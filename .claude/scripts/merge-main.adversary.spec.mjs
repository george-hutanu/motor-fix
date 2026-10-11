import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, fixFrontMatter, mergeCapability, mergeMain, mergeRegistry, unionConflicts } from './merge-main.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'merge-main.mjs');
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const put = (cwd, path, text) => {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
};
const commit = (cwd, msg) => {
  sh(cwd, 'add', '-A');
  sh(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg);
};

/** An origin with main, and two clones that each start from it. */
function world(files) {
  const root = mkdtempSync(join(tmpdir(), 'merge-main-adv-'));
  dirs.push(root);
  const origin = join(root, 'origin.git');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = join(root, 'seed');
  sh(root, 'clone', '-q', origin, seed);
  sh(seed, 'checkout', '-q', '-b', 'main');
  for (const [p, t] of Object.entries(files)) put(seed, p, t);
  commit(seed, 'seed');
  sh(seed, 'push', '-q', 'origin', 'main');
  const clone = (name) => {
    const c = join(root, name);
    sh(root, 'clone', '-q', origin, c);
    sh(c, 'checkout', '-q', '-b', `feat-${name}`);
    return c;
  };
  return { root, origin, seed, clone };
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), err: r.stderr };
};

const cap = (updated, features, body) => `---\nupdated: ${updated}\nfeatures:\n${features.map((f) => `  - ${f}`).join('\n')}\n---\n${body}`;

describe('merge-main against real git repositories', () => {
  it('exits 0 with merged false when origin/main has nothing new', () => {
    const w = world({ 'a.txt': 'one\n' });
    const c = w.clone('a');
    const r = run(c);
    assert.equal(r.code, 0);
    assert.equal(r.out.length, 1);
    const j = JSON.parse(r.out[0]);
    assert.equal(j.merged, false);
    assert.deepEqual(j.left, []);
  });

  it('is idempotent: a second run after a clean merge changes nothing', () => {
    const w = world({ 'a.txt': 'one\n' });
    const c = w.clone('a');
    put(w.seed, 'b.txt', 'b\n');
    commit(w.seed, 'b');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    assert.equal(JSON.parse(run(c).out[0]).merged, true);
    const head = sh(c, 'rev-parse', 'HEAD');
    const again = run(c);
    assert.equal(again.code, 0);
    assert.equal(JSON.parse(again.out[0]).merged, false);
    assert.equal(sh(c, 'rev-parse', 'HEAD'), head);
  });

  it('exits 2 and prints no merge commit when there is no origin to fetch', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-main-adv-'));
    dirs.push(root);
    sh(root, 'init', '-q', '-b', 'main');
    put(root, 'a', 'a\n');
    commit(root, 'a');
    const r = run(root);
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.out[0]).merged, false);
  });

  it('exits 2 with one JSON line outside a git checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-main-adv-'));
    dirs.push(dir);
    const r = run(dir);
    assert.equal(r.code, 2);
    assert.equal(r.out.length, 1);
    JSON.parse(r.out[0]);
  });

  it('resolves two archives into one capability file, keeping both sides lines and one updated date', () => {
    const base = cap('2026-10-01', ['100-a'], '# platform\n\n- FR-100 a\n');
    const w = world({ '.specify/capabilities/platform.md': base });
    const mine = w.clone('mine');
    put(mine, '.specify/capabilities/platform.md', cap('2026-10-09', ['100-a', '200-mine'], '# platform\n\n- FR-100 a\n- FR-200 mine\n'));
    commit(mine, 'mine');
    put(w.seed, '.specify/capabilities/platform.md', cap('2026-10-11', ['100-a', '300-theirs'], '# platform\n\n- FR-100 a\n- FR-300 theirs\n'));
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    const r = run(mine);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out[0]);
    assert.deepEqual(j.resolved, ['.specify/capabilities/platform.md']);
    assert.equal(j.merged, true);
    const text = readFileSync(join(mine, '.specify/capabilities/platform.md'), 'utf8');
    assert.equal(text.match(/^updated:.*$/gm).length, 1);
    assert.match(text, /^updated: 2026-10-11$/m);
    assert.equal(text.match(/- 100-a$/gm).length, 1);
    assert.match(text, /- 200-mine/);
    assert.match(text, /- 300-theirs/);
    assert.match(text, /FR-200 mine/);
    assert.match(text, /FR-300 theirs/);
    assert.doesNotMatch(text, /^(<{7}|={7}|>{7})/m);
  });

  it('leaves an unrelated conflicted path, exits 1 and keeps the merge in progress', () => {
    const w = world({ 'AGENTS.md': 'x\n' });
    const mine = w.clone('mine');
    put(mine, 'AGENTS.md', 'mine\n');
    commit(mine, 'mine');
    put(w.seed, 'AGENTS.md', 'theirs\n');
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    const r = run(mine);
    assert.equal(r.code, 1);
    const j = JSON.parse(r.out[0]);
    assert.deepEqual(j.left, ['AGENTS.md']);
    assert.equal(j.merged, false);
    assert.equal(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: mine }).status, 0);
  });

  it('never pushes: origin main is unchanged after a resolved merge', () => {
    const w = world({ '.specify/capabilities/p.md': cap('2026-10-01', ['a'], 'x\n') });
    const mine = w.clone('mine');
    put(mine, '.specify/capabilities/p.md', cap('2026-10-02', ['a', 'b'], 'x\nmine\n'));
    commit(mine, 'mine');
    put(w.seed, '.specify/capabilities/p.md', cap('2026-10-03', ['a', 'c'], 'x\ntheirs\n'));
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    const before = sh(w.origin, 'rev-parse', 'main');
    run(mine);
    assert.equal(sh(w.origin, 'rev-parse', 'main'), before);
    assert.equal(sh(w.origin, 'branch', '--list').includes('feat-mine'), false);
  });

  it('finishes a merge already in progress once the person has resolved the left path', () => {
    const w = world({ 'AGENTS.md': 'x\n' });
    const mine = w.clone('mine');
    put(mine, 'AGENTS.md', 'mine\n');
    commit(mine, 'mine');
    put(w.seed, 'AGENTS.md', 'theirs\n');
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    assert.equal(run(mine).code, 1);
    put(mine, 'AGENTS.md', 'both\n');
    sh(mine, 'add', 'AGENTS.md');
    const r = run(mine);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out[0]).merged, true);
    assert.equal(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: mine }).status, 1);
  });

  it('regenerates a conflicted openapi.json only after nothing else is left, and not at all when a path is left', () => {
    const w = world({ 'apps/api/openapi.json': '{"v":0}\n', 'AGENTS.md': 'x\n' });
    const mine = w.clone('mine');
    put(mine, 'apps/api/openapi.json', '{"v":1}\n');
    put(mine, 'AGENTS.md', 'mine\n');
    commit(mine, 'mine');
    put(w.seed, 'apps/api/openapi.json', '{"v":2}\n');
    put(w.seed, 'AGENTS.md', 'theirs\n');
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    let calls = 0;
    const out = mergeMain({ cwd: mine, regenerate: () => (calls++, { status: 0 }) });
    assert.equal(out.code, 1);
    assert.equal(calls, 0);
    assert.equal(out.regenerated, false);
    assert.deepEqual([...out.left].sort(), ['AGENTS.md', 'apps/api/openapi.json']);
  });

  it('exits 2 when the generator fails and does not make the merge commit', () => {
    const w = world({ 'apps/api/openapi.json': '{"v":0}\n' });
    const mine = w.clone('mine');
    put(mine, 'apps/api/openapi.json', '{"v":1}\n');
    commit(mine, 'mine');
    put(w.seed, 'apps/api/openapi.json', '{"v":2}\n');
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    const head = sh(mine, 'rev-parse', 'HEAD');
    const out = mergeMain({ cwd: mine, regenerate: () => ({ status: 1 }) });
    assert.equal(out.code, 2);
    assert.equal(out.merged, false);
    assert.equal(sh(mine, 'rev-parse', 'HEAD'), head);
  });

  it('leaves a capability file whose side deleted it for a person', () => {
    const w = world({ '.specify/capabilities/p.md': cap('2026-10-01', ['a'], 'x\n') });
    const mine = w.clone('mine');
    sh(mine, 'rm', '-q', '.specify/capabilities/p.md');
    commit(mine, 'rm');
    put(w.seed, '.specify/capabilities/p.md', cap('2026-10-03', ['a', 'c'], 'x\ntheirs\n'));
    commit(w.seed, 'theirs');
    sh(w.seed, 'push', '-q', 'origin', 'main');
    const r = run(mine);
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.out[0]).left, ['.specify/capabilities/p.md']);
  });
});

describe('merge-main pieces', () => {
  it('classifies nested and look-alike paths as a person\'s', () => {
    assert.equal(classify('.specify/capabilities/sub/x.md'), 'other');
    assert.equal(classify('.specify/capabilities/x.txt'), 'other');
    assert.equal(classify('apps/api/openapi.json.bak'), 'other');
    assert.equal(classify('libs/data-access/src/lib-extra/x.ts'), 'other');
    assert.equal(classify('libs/data-access/src/lib/a/b.ts'), 'contract');
    assert.equal(classify('.claude/hooks/registry.json'), 'registry');
  });

  it('leaves text without conflicts untouched and keeps a setext underline outside a hunk', () => {
    const t = 'Title\n=======\nbody\n';
    assert.equal(unionConflicts(t), t);
  });

  it('unions a conflict hunk with ours first and drops no distinct line of theirs', () => {
    const t = 'a\n<<<<<<< ours\nmine\nshared\n=======\nshared\ntheirs\n>>>>>>> theirs\nz\n';
    assert.equal(unionConflicts(t), 'a\nmine\nshared\ntheirs\nz\n');
  });

  it('unions an empty side of a hunk', () => {
    const t = '<<<<<<< ours\n=======\ntheirs\n>>>>>>> theirs\n';
    assert.equal(unionConflicts(t), 'theirs\n');
  });

  it('collapses duplicated updated lines to the later date and de-duplicates features', () => {
    const t = '---\nupdated: 2026-10-01\nupdated: 2026-10-11\nfeatures:\n  - a\n  - b\n  - a\n---\nbody\n';
    const out = fixFrontMatter(t);
    assert.equal(out.match(/^updated:/gm).length, 1);
    assert.match(out, /^updated: 2026-10-11$/m);
    assert.equal(out.match(/- a$/gm).length, 1);
    assert.match(out, /body\n$/);
  });

  it('does not touch a body line that looks like front matter', () => {
    const t = '---\nupdated: 2026-10-01\nfeatures:\n  - a\n---\nupdated: 1999-01-01\n';
    assert.match(fixFrontMatter(t), /\nupdated: 1999-01-01\n$/);
  });

  it('merges a registry by id and names a script matching neither fingerprint under bless', () => {
    const e = (id, fp) => ({ id, script: `${id}.mjs`, fingerprint: fp });
    const out = mergeRegistry({
      base: { hooks: [e('a', 'f0')] },
      ours: { hooks: [e('a', 'f1')] },
      theirs: { hooks: [e('a', 'f2'), e('b', 'g1')] },
      fingerprintOf: () => 'f3',
    });
    assert.deepEqual(out.bless, ['a']);
    assert.deepEqual(out.registry.hooks.map((h) => h.id).sort(), ['a', 'b']);
  });

  it('takes the side whose fingerprint matches the script in the tree and blesses nothing', () => {
    const e = (fp) => ({ id: 'a', script: 'a.mjs', fingerprint: fp });
    const out = mergeRegistry({ base: { hooks: [e('f0')] }, ours: { hooks: [e('f1')] }, theirs: { hooks: [e('f2')] }, fingerprintOf: () => 'f2' });
    assert.deepEqual(out.bless, []);
    assert.equal(out.registry.hooks[0].fingerprint, 'f2');
  });

  it('merges registries that have no hooks field at all', () => {
    const out = mergeRegistry({ base: {}, ours: {}, theirs: {}, fingerprintOf: () => 'x' });
    assert.deepEqual(out.bless, []);
  });

  it('refuses a capability whose front matter is missing on one side rather than writing markers', () => {
    const out = mergeCapability({ base: 'x\n', ours: 'x\nmine\n', theirs: 'x\ntheirs\n' });
    assert.ok(out === null || !/^(<{7}|={7}|>{7})/m.test(out));
  });
});
