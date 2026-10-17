import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repo = join(__dirname, '../../..');
const ROOTS = ['libs/domain/src', 'apps/api/src', 'apps/worker/src'];
// A worker's final failure reaches the log through logFinalFailure, or its own
// 'failed' listener that ends in writeJobFailed.
const FINAL = /logFinalFailure\(|\.on\('failed'/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sources(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

// Each `new Worker(` up to its `return worker`: the factory that builds it.
function factories(source: string): string[] {
  return source
    .split(/\bnew Worker\b/)
    .slice(1)
    .map((rest) => rest.split(/\breturn worker\b/)[0] ?? rest);
}

// @traces 297-FR-007
describe('every queue the worker runs', () => {
  it('writes job_failed when one of its jobs fails for good', () => {
    const files = ROOTS.flatMap((root) => sources(join(repo, root)));
    const unwired = files.flatMap((path) =>
      factories(readFileSync(path, 'utf8'))
        .map((body, index) => ({ body, index }))
        .filter(({ body }) => !FINAL.test(body))
        .map(({ index }) => `${relative(repo, path)} worker #${index + 1}`),
    );

    expect(files.some((path) => path.endsWith('notifications.module.ts'))).toBe(
      true,
    );
    expect(unwired).toEqual([]);
  });
});
