import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MUTATION_SPECS, strykerOptions, vitestSpecs } from './mutation.ts';

let repo: string;
const cwd = process.cwd();
const write = (path: string, content = '') => {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
};
const shards = (projects: Record<string, unknown>) =>
  write(
    'scripts/mutation-shards.json',
    JSON.stringify({ default: { measured: 'm', timeout: 60 }, projects }),
  );

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mutation-adv-'));
  process.chdir(repo);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { force: true, recursive: true });
});

describe('vitestSpecs edge cases', () => {
  it('refuses any shard, rest included, of a project with no shard list', () => {
    shards({});
    expect(() => vitestSpecs('x', 'libs/x', 'rest')).toThrow('no shards');
    expect(() => vitestSpecs('x', 'libs/x', 'auth')).toThrow('no shards');
  });

  it('keeps a folder name with glob or regex characters verbatim in the include', () => {
    shards({
      x: {
        measured: 'm',
        shards: { odd: { folders: ['a (b)+c'], measured: 'm', timeout: 60 } },
        timeout: 60,
      },
    });
    const value = JSON.parse(
      vitestSpecs('x', 'libs/x', 'odd')[MUTATION_SPECS] ?? 'null',
    );
    expect(value.include).toEqual([
      '**/libs/x/src/a (b)+c/**/*.{spec,test}.ts',
    ]);
  });

  it('fails on a shard file that is not JSON', () => {
    write('scripts/mutation-shards.json', '{oops');
    expect(() => vitestSpecs('x', 'libs/x', 'rest')).toThrow();
  });
});

describe('strykerOptions for an Angular project with a shard', () => {
  it('names no testFiles and keeps related mode off, leaving specs to the environment', () => {
    shards({
      x: {
        measured: 'm',
        shards: { a: { folders: ['a'], measured: 'm', timeout: 60 } },
        timeout: 60,
      },
    });
    write(
      'libs/x/stryker.config.json',
      JSON.stringify({ thresholds: { break: 70, high: 80, low: 60 } }),
    );
    write('libs/x/vitest.config.ts');
    const options = strykerOptions('x', 'libs/x', false, undefined, 'a');
    expect(options).not.toHaveProperty('testFiles');
    expect(options['vitest']).toEqual({
      configFile: 'libs/x/vitest.config.ts',
      dir: 'libs/x/src',
      related: false,
    });
    expect((options['thresholds'] as { break: unknown }).break).toBeNull();
  });
});
