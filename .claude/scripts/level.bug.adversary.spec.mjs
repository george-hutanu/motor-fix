import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkLevel, main } from './level.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const PROJECTS = {
  'apps/api/project.json': '{"name":"api"}',
  'apps/web/project.json': '{"name":"web"}',
  'apps/worker/project.json': '{"name":"worker"}',
  'apps/web-e2e/project.json': '{"name":"web-e2e"}',
  'libs/contracts/project.json': '{"name":"contracts"}',
  'libs/domain/project.json': '{"name":"domain"}',
  'libs/data-access/project.json': '{"name":"data-access"}',
  'README.md': 'x\n',
};

function repo({ level = 1, spec = '# Spec\n\n- **FR-001**: one\n', branch = {}, state = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adv-bug-'));
  dirs.push(dir);
  const write = (files) => {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
  };
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write(PROJECTS);
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-qb', '042-small');
  write({ 'specs/042-small/spec.md': spec, 'specs/042-small/tasks.md': '# Tasks\n', ...branch });
  git('add', '-A');
  git('commit', '-qm', 'work');
  mkdirSync(join(dir, '.specify'), { recursive: true });
  writeFileSync(join(dir, '.specify/feature.json'), JSON.stringify({ feature_directory: 'specs/042-small', level, level_for: 'specs/042-small', ...state }));
  return dir;
}

const frs = (n) => `# Spec\n\n${Array.from({ length: n }, (_, i) => `- **FR-${String(i + 1).padStart(3, '0')}**: requirement ${i}\n`).join('')}`;
const saved = process.env.SPECKIT_FEATURE_LEVEL;
const noEnv = (fn) => {
  delete process.env.SPECKIT_FEATURE_LEVEL;
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env.SPECKIT_FEATURE_LEVEL = saved;
  }
};
const capture = (fn) => {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    return { status: fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
};
const stored = (dir) => JSON.parse(readFileSync(join(dir, '.specify/feature.json'), 'utf8'));
const api = { 'apps/api/src/a.ts': 'x\n' };
const web = { 'apps/web/src/b.ts': 'x\n' };

// @traces 1363-FR-004
describe('a bug is sized by its contracts and requirements, not its projects', () => {
  it('a bug with eleven requirements is still promoted by the requirement wire', () => {
    const dir = repo({ spec: frs(11), state: { type: 'bug' } });
    noEnv(() => assert.deepEqual(checkLevel(dir).promoted, { from: 1, to: 2 }));
    assert.equal(stored(dir).level, 2);
  });

  it('a schema file or a migration in a bug diff promotes it to level 2', () => {
    for (const path of ['libs/domain/prisma/schema/schema.prisma', 'libs/domain/prisma/migrations/20261023000000_x/migration.sql']) {
      const dir = repo({ state: { type: 'bug' }, branch: { [path]: 'x\n' } });
      noEnv(() => assert.deepEqual(checkLevel(dir).promoted, { from: 1, to: 2 }, path));
    }
  });

  it('a type that is not the word bug does not skip the projects wire', () => {
    for (const type of ['Bug', ['bug'], null, 7, 'bug ']) {
      const dir = repo({ state: { type }, branch: { ...api, ...web } });
      noEnv(() => assert.deepEqual(checkLevel(dir).promoted, { from: 1, to: 2 }, JSON.stringify(type)));
    }
  });

});

// @traces 1363-FR-012
describe('the split line at its limits', () => {
  const split = (branch, state = {}) => {
    const dir = repo({ level: 2, branch, state });
    return noEnv(() => checkLevel(dir).split);
  };

  it('web-e2e and the generated data-access never count toward the project limit', () => {
    assert.equal(split({ ...api, 'apps/web-e2e/src/e.ts': 'x\n', 'libs/data-access/src/g.ts': 'x\n' }), null);
  });

  it('the worker and the api are two surfaces', () => {
    assert.deepEqual(split({ ...api, 'apps/worker/src/w.ts': 'x\n' }), ['api', 'worker']);
  });

});
