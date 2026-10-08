import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The `@motor-fix/contracts` barrel re-exports server code (NestJS, node
// built-ins); a value import of it breaks the browser bundle. Types are
// erased, so `import type` stays allowed; values come from a deep path such
// as `@motor-fix/contracts/fold`.
const src = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

const barrelImport =
  /import\s+(type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]@motor-fix\/contracts['"]/g;

describe('browser imports', () => {
  it('never imports a value from the @motor-fix/contracts barrel', () => {
    const offenders = sources(src).filter((file) =>
      [...readFileSync(file, 'utf8').matchAll(barrelImport)].some(
        (match) => !match[1],
      ),
    );
    expect(offenders.map((file) => relative(src, file))).toEqual([]);
  });
});
