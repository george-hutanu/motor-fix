import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// The Jest worker recycle limit follows JEST_IDLE_MEMORY, which
// `lifecycle.mjs check` sets for the local test step; unset, each config keeps
// its own default.
const root = join(import.meta.dirname, '..', '..');
const require = createRequire(import.meta.url);
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

afterEach(() => {
  if (saved === undefined) delete process.env.JEST_IDLE_MEMORY;
  else process.env.JEST_IDLE_MEMORY = saved;
});

// @traces 1011-FR-002 1011-FR-003
describe('workerIdleMemoryLimit follows JEST_IDLE_MEMORY', () => {
  for (const [file, fallback] of CONFIGS) {
    it(`${file} recycles a worker past ${fallback} when JEST_IDLE_MEMORY is unset`, () => {
      delete process.env.JEST_IDLE_MEMORY;
      assert.equal(load(file).workerIdleMemoryLimit, fallback);
    });

    it(`${file} takes JEST_IDLE_MEMORY when it is set`, () => {
      process.env.JEST_IDLE_MEMORY = '512MB';
      assert.equal(load(file).workerIdleMemoryLimit, '512MB');
    });
  }
});
