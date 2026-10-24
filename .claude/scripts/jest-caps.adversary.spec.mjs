import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { step } from './lifecycle.mjs';

const FEATURE = '696-lifecycle-script';
const root = join(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);
let repo;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'jest-caps-'));
  const featureDir = join(repo, 'specs', FEATURE);
  mkdirSync(featureDir, { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  mkdirSync(join(repo, '.github'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: `specs/${FEATURE}` }));
  writeFileSync(join(featureDir, 'spec.md'), '# Spec\n\n**Story**: ST-696 (Task)\n');
  writeFileSync(join(repo, '.claude', 'scripts', 'tracker-sync.mjs'), '// stub\n');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const e = (more = {}) => ({ GH_TOKEN: 'tok', ...more });

function run(env) {
  const envs = [];
  const table = [
    ['git rev-parse --abbrev-ref HEAD', { stdout: `${FEATURE}\n` }],
    ['git rev-parse HEAD', { stdout: 'abcdef1234567890\n' }],
    ['git merge-base HEAD origin/main', { stdout: 'b45e0000\n' }],
    ['git rev-parse origin/main', { stdout: 'ma1n0000\n' }],
    ['git status --porcelain', { stdout: ' M x\n' }],
  ];
  const io = {
    repo,
    env,
    run: (file, args, opts = {}) => {
      const cmd = [file, ...args].join(' ');
      envs.push({ cmd, env: opts.env });
      const hit = table.find(([p]) => cmd.startsWith(p));
      return { code: 0, stdout: '', stderr: '', ...hit?.[1] };
    },
    gate: () => ({ code: 0, stderr: '' }),
  };
  const result = step(['check'], io);
  const heavy = envs.filter((e) => e.cmd.startsWith('sh scripts/heavy.sh'));
  return { result, heavy, envs, io };
}

// @traces 1011-FR-001
describe('check hands the test step its Jest caps', () => {
  it('runs exactly one heavy test step and gives it both caps with an otherwise empty env', () => {
    const { result, heavy } = run(e());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(heavy.length, 1);
    assert.equal(heavy[0].env.JEST_MAX_WORKERS, '1');
    assert.equal(heavy[0].env.JEST_IDLE_MEMORY, '1GB');
  });

  it('keeps one cap from the env while defaulting the other', () => {
    const { heavy } = run(e({ JEST_MAX_WORKERS: '4' }));
    assert.equal(heavy[0].env.JEST_MAX_WORKERS, '4');
    assert.equal(heavy[0].env.JEST_IDLE_MEMORY, '1GB');
    const second = run(e({ JEST_IDLE_MEMORY: '256MB' })).heavy;
    assert.equal(second[0].env.JEST_MAX_WORKERS, '1');
    assert.equal(second[0].env.JEST_IDLE_MEMORY, '256MB');
  });

  it('does not override the heap or Nx parallelism that heavy.sh owns', () => {
    const { heavy } = run(e({ NODE_OPTIONS: '--max-old-space-size=6144', NX_PARALLEL: '4' }));
    assert.equal(heavy[0].env.NODE_OPTIONS, '--max-old-space-size=6144');
    assert.equal(heavy[0].env.NX_PARALLEL, '4');
    const bare = run(e()).heavy[0].env;
    assert.equal(bare.NODE_OPTIONS, undefined);
    assert.equal(bare.NX_PARALLEL, undefined);
  });

  it('does not write the caps into the caller env', () => {
    const env = { GH_TOKEN: 'tok' };
    run(env);
    assert.deepEqual(env, { GH_TOKEN: 'tok' });
  });

  it('gives the same caps on a second call', () => {
    const env = e();
    const a = run(env).heavy[0].env;
    const b = run(env).heavy[0].env;
    assert.equal(a.JEST_MAX_WORKERS, b.JEST_MAX_WORKERS);
    assert.equal(a.JEST_IDLE_MEMORY, b.JEST_IDLE_MEMORY);
  });

  it('treats empty caps as unset so Jest never receives an empty limit', () => {
    const { heavy } = run(e({ JEST_MAX_WORKERS: '', JEST_IDLE_MEMORY: '' }));
    assert.equal(heavy[0].env.JEST_MAX_WORKERS, '1');
    assert.equal(heavy[0].env.JEST_IDLE_MEMORY, '1GB');
  });

  it('keeps a unit-suite command so integration specs stay out of the step', () => {
    const { envs } = run(e());
    const cmd = envs.find((e) => e.cmd.startsWith('sh scripts/heavy.sh')).cmd;
    assert.match(cmd, /JEST_SUITE=unit/);
    assert.doesNotMatch(cmd, /JEST_MAX_WORKERS|JEST_IDLE_MEMORY/);
  });

  it('caps no step other than the test step', () => {
    const { envs } = run(e());
    const others = envs.filter((e) => !e.cmd.startsWith('sh scripts/heavy.sh') && e.env);
    for (const o of others) {
      assert.equal(o.env.JEST_MAX_WORKERS, undefined, o.cmd);
      assert.equal(o.env.JEST_IDLE_MEMORY, undefined, o.cmd);
    }
  });
});

const CONFIGS = [
  ['jest.preset.cjs', '1GB'],
  ['libs/domain/jest.config.cts', '1536MB'],
];
const saved = process.env.JEST_IDLE_MEMORY;

function load(file) {
  const path = join(root, file);
  for (const key of Object.keys(require.cache)) if (key.endsWith('jest.preset.cjs') || key === path) delete require.cache[key];
  return require(path);
}

// @traces 1011-FR-002
describe('workerIdleMemoryLimit under odd JEST_IDLE_MEMORY values', () => {
  afterEach(() => {
    if (saved === undefined) delete process.env.JEST_IDLE_MEMORY;
    else process.env.JEST_IDLE_MEMORY = saved;
  });

  for (const [file, fallback] of CONFIGS) {
    it(`${file} falls back to ${fallback} when JEST_IDLE_MEMORY is empty`, () => {
      process.env.JEST_IDLE_MEMORY = '';
      assert.equal(load(file).workerIdleMemoryLimit, fallback);
    });

    it(`${file} passes a byte count through unchanged`, () => {
      process.env.JEST_IDLE_MEMORY = '268435456';
      assert.equal(load(file).workerIdleMemoryLimit, '268435456');
    });

    it(`${file} follows the env on a second load after it changed`, () => {
      process.env.JEST_IDLE_MEMORY = '2GB';
      assert.equal(load(file).workerIdleMemoryLimit, '2GB');
      delete process.env.JEST_IDLE_MEMORY;
      assert.equal(load(file).workerIdleMemoryLimit, fallback);
    });
  }

  it('domain config keeps the preset suite and worker settings besides the limit', () => {
    delete process.env.JEST_IDLE_MEMORY;
    const preset = load('jest.preset.cjs');
    const domain = load('libs/domain/jest.config.cts');
    assert.equal(domain.default?.workerIdleMemoryLimit ?? domain.workerIdleMemoryLimit, '1536MB');
    assert.equal(preset.workerIdleMemoryLimit, '1GB');
  });
});

// @traces 1011-FR-004
describe('AGENTS.md names the knobs', () => {
  it('has exactly one line naming each knob with its default', () => {
    const lines = readFileSync(join(root, 'AGENTS.md'), 'utf8').split('\n');
    assert.equal(lines.filter((l) => l.includes('JEST_MAX_WORKERS')).length, 1);
    assert.equal(lines.filter((l) => l.includes('JEST_IDLE_MEMORY')).length, 1);
    const line = lines.find((l) => l.includes('JEST_MAX_WORKERS'));
    assert.match(line, /JEST_MAX_WORKERS=1/);
    assert.match(line, /JEST_IDLE_MEMORY=1GB/);
    assert.match(line, /3072/);
  });
});
