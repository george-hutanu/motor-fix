import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FABLE_KEY, OPUS_MODEL, fableTarget, mainCheckout } from './fable.mjs';

// ST-813: one switch remaps the `fable` alias to Opus for every session
// started afterwards, through the main checkout's untracked settings.local.json
// and every worktree that keeps its own.

const SCRIPT = fileURLToPath(new URL('./fable.mjs', import.meta.url));

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (cwd, ...args) => {
  const env = { ...process.env };
  delete env[FABLE_KEY];
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
};
const settings = (dir) => join(dir, '.claude', 'settings.local.json');
const read = (dir) => JSON.parse(readFileSync(settings(dir), 'utf8'));
const write = (dir, value) => {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(settings(dir), `${JSON.stringify(value, null, 2)}\n`);
};

const OTHER = { $schema: 'x', permissions: { deny: ['mcp__a'] }, env: { KEEP: '1' } };

let root;
let main;
let wtOwn;
let wtBare;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'fable-')));
  main = join(root, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  wtOwn = join(main, '.worktrees', 'own');
  wtBare = join(main, '.worktrees', 'bare');
  git(main, 'worktree', 'add', '-q', '-b', 'own', wtOwn);
  git(main, 'worktree', 'add', '-q', '-b', 'bare', wtBare);
  write(main, OTHER);
  write(wtOwn, { permissions: { allow: ['Bash(ls)'] } });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('fable switch — the main checkout', () => {
  it('finds the main checkout from a linked worktree', () => {
    assert.equal(mainCheckout(wtBare), main);
    assert.equal(mainCheckout(main), main);
  });
});

describe('fable switch — off', () => {
  it('writes the remap into the main checkout and keeps every other key (813-FR-001)', () => {
    const r = run(wtBare, 'off');
    assert.equal(r.status, 0, r.stderr);
    const s = read(main);
    assert.equal(s.env[FABLE_KEY], OPUS_MODEL);
    assert.equal(OPUS_MODEL, 'claude-opus-5-5');
    assert.equal(s.env.KEEP, '1');
    assert.deepEqual(s.permissions, OTHER.permissions);
    assert.equal(s.$schema, 'x');
  });

  it('writes into a worktree with its own settings, never creates one (813-FR-001)', () => {
    run(main, 'off');
    const own = read(wtOwn);
    assert.equal(own.env[FABLE_KEY], OPUS_MODEL);
    assert.deepEqual(own.permissions, { allow: ['Bash(ls)'] });
    assert.equal(existsSync(settings(wtBare)), false);
  });

  it('creates the main checkout file when it has none (813-FR-001)', () => {
    rmSync(settings(main));
    assert.equal(run(wtOwn, 'off').status, 0);
    assert.deepEqual(read(main), { env: { [FABLE_KEY]: OPUS_MODEL } });
  });

  it('refuses a settings file it cannot parse rather than overwrite it', () => {
    writeFileSync(settings(main), '{ not json');
    const r = run(main, 'off');
    assert.notEqual(r.status, 0);
    assert.equal(readFileSync(settings(main), 'utf8'), '{ not json');
  });
});

describe('fable switch — on', () => {
  it('removes the remap everywhere and keeps every other key (813-FR-002)', () => {
    run(main, 'off');
    const r = run(wtBare, 'on');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(read(main), OTHER);
    assert.deepEqual(read(wtOwn), { permissions: { allow: ['Bash(ls)'] } });
  });
});

describe('fable switch — status', () => {
  it('names the model in force (813-FR-003)', () => {
    assert.match(run(wtBare, 'status').stdout, /fable/i);
    assert.doesNotMatch(run(wtBare, 'status').stdout, /opus/i);
    run(main, 'off');
    assert.match(run(wtBare, 'status').stdout, /claude-opus-5-5/);
  });

  it('rejects an unknown command with usage', () => {
    const r = run(main, 'sideways');
    assert.equal(r.status, 64);
    assert.match(r.stderr, /usage/);
  });
});

describe('fable switch — what the router reads (813-FR-004)', () => {
  it('is null while Fable is in force', () => {
    assert.equal(fableTarget({}, wtBare), null);
  });

  it('reads the main checkout settings from a worktree', () => {
    run(main, 'off');
    assert.equal(fableTarget({}, wtBare), OPUS_MODEL);
  });

  it('reads the environment first', () => {
    assert.equal(fableTarget({ [FABLE_KEY]: 'claude-opus-5-5' }, wtBare), 'claude-opus-5-5');
  });

  it('is null outside a git checkout', () => {
    assert.equal(fableTarget({}, root), null);
  });
});
