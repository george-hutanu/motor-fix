import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The `@motor-fix/contracts` barrel re-exports the API's DTOs, which pull
// @nestjs/common (and Node built-ins) into the browser bundle. Web code reads
// it for types only; values come from a subpath (`@motor-fix/contracts/price-range`).
const src = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

const valueImport =
  /import\s+(?!type\b)[^;]*?from\s+['"]@motor-fix\/contracts['"]/g;

describe('web imports of the contracts barrel', () => {
  it('are type-only, so no server code reaches the browser bundle', () => {
    const offenders = sources(src)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return [...text.matchAll(valueImport)].some(
          (match) => !/^import\s*\{\s*(type\s+\w+\s*,?\s*)+\}/.test(match[0]),
        );
      })
      .map((file) => relative(src, file));
    expect(offenders).toEqual([]);
  });
});
