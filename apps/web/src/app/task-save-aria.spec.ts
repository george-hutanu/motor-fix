import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// @traces 495-FR-004

// The kit input writes `aria-invalid` itself and removes it once a revealed
// field is valid. A template under a save that binds `[attr.aria-invalid]`
// on that input fights it: Angular never writes the binding again while its
// value stays the same, so the kit's removal sticks. Its own rule goes to the
// input instead, `[aria-invalid]`.

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

function templatesUnderASave(): string[] {
  return sources(__dirname)
    .map((path) => ({ code: readFileSync(path, 'utf8'), path }))
    .filter(({ code }) => code.includes('taskSave('))
    .flatMap(({ code, path }) => {
      const url = code.match(/templateUrl:\s*'([^']+)'/)?.[1];
      return url ? [join(dirname(path), url)] : [];
    });
}

const fighting = (html: string) =>
  (html.match(/<(?:input|textarea|select)\b[^>]*>/g) ?? []).filter(
    (tag) => /\bhlmInput\b/.test(tag) && tag.includes('[attr.aria-invalid]'),
  );

describe('a field under a save', () => {
  it('finds the forms that save', () => {
    expect(templatesUnderASave().length).toBeGreaterThan(20);
  });

  it('binds its own invalid rule to the kit input, never as an attribute', () => {
    const found = templatesUnderASave().flatMap((path) =>
      fighting(readFileSync(path, 'utf8')).map(
        (tag) => `${path.slice(__dirname.length + 1)}: ${tag}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
