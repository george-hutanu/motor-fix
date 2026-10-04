import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { fileProblems, typedText, unknownKeys } from './check';
import { flatten, type Texts } from './files';
import { AREAS } from './languages';

const root = resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => /(?<!\.spec)\.ts$|\.html$/.test(f))
    .filter((f) => f !== join(root, 'apps/web/src/index.html'));
}

const templatesOf = (file: string) => {
  const source = readFileSync(file, 'utf8');
  return file.endsWith('.html')
    ? [source]
    : [...source.matchAll(/template:\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2]);
};

const areaFile = (area: string, language: string) =>
  JSON.parse(
    readFileSync(join(__dirname, area, `${language}.json`), 'utf8'),
  ) as Texts;

describe('fileProblems', () => {
  it('accepts two files with the same keys', () => {
    expect(
      fileProblems('shell', { a: { b: 'Da' } }, { a: { b: 'Yes' } }),
    ).toEqual([]);
  });

  it('names a key only one language has', () => {
    const problems = fileProblems('shell', { a: 'Da', b: 'Nu' }, { a: 'Yes' });

    expect(problems).toEqual([expect.stringContaining('shell.b')]);
  });

  it('names an empty or blank text', () => {
    expect(fileProblems('garage', { a: ' ' }, { a: 'Yes' })).toEqual([
      expect.stringContaining('garage.a'),
    ]);
    expect(fileProblems('garage', { a: 'Da' }, { a: '' })).toEqual([
      expect.stringContaining('garage.a'),
    ]);
  });

  it('names Romanian written with a cedilla instead of a comma below', () => {
    expect(
      fileProblems('shell', { city: 'Bucureşti' }, { city: 'Bucharest' }),
    ).toEqual([expect.stringContaining('shell.city')]);
    expect(
      fileProblems('shell', { city: 'Țară, București' }, { city: 'x' }),
    ).toEqual([]);
  });

  it('names a Romanian word joined by a hyphen that can break the line', () => {
    expect(
      fileProblems(
        'shell',
        { a: 'Profilul service-ului', b: 'Nu s-a putut' },
        { a: 'Garage profile', b: 'Could not' },
      ),
    ).toEqual([
      expect.stringContaining('shell.a'),
      expect.stringContaining('shell.b'),
    ]);
  });

  it('accepts a non-breaking hyphen, a hyphen beside a digit or a space, and any hyphen in English', () => {
    expect(
      fileProblems(
        'shell',
        { a: 'Profilul service‑ului', b: 'A-1 - Dacia', c: '10-20 lei' },
        { a: 'Self-service', b: 'A-1 - Dacia', c: '10-20 lei' },
      ),
    ).toEqual([]);
  });

  it('accepts plural groups that follow each language’s rules', () => {
    expect(
      fileProblems(
        'public',
        { n: { few: 'a', one: 'b', other: 'c' } },
        { n: { one: 'd', other: 'e' } },
      ),
    ).toEqual([]);
  });

  it('names a plural group missing a category of its language', () => {
    expect(
      fileProblems(
        'public',
        { n: { one: 'b', other: 'c' } },
        { n: { one: 'd', other: 'e' } },
      ),
    ).toEqual([expect.stringContaining('public.n')]);
  });
});

describe('typedText', () => {
  it('finds text between elements, also inside blocks', () => {
    expect(typedText('<p>Salut</p> @if (x) { <b>Gata</b> }')).toEqual([
      'Salut',
      'Gata',
    ]);
  });

  it('finds the literal part of an interpolated text', () => {
    expect(typedText('<p>Total: {{ n }}</p>')).toEqual(['Total:']);
  });

  it('finds a text written as a string inside an interpolation', () => {
    expect(typedText(`<p>{{ version ?? 'unknown' }}</p>`)).toEqual(['unknown']);
  });

  it('finds person-facing attributes', () => {
    expect(
      typedText(
        '<img alt="Logo"><input placeholder="Caută"><button title="Închide" aria-label="Închide"></button><p-button label="Salvează" />',
      ),
    ).toEqual(['Logo', 'Caută', 'Închide', 'Închide', 'Salvează']);
  });

  it('ignores keys, expressions, numbers, punctuation and bound attributes', () => {
    expect(
      typedText(
        `<p>{{ 'shell.brand' | t }}</p> <span> · </span> <span>48</span>
         <img [alt]="logo" class="wide"> <input [placeholder]="'a.b' | t">`,
      ),
    ).toEqual([]);
  });
});

describe('unknownKeys', () => {
  it('names a literal key the translations lack', () => {
    expect(
      unknownKeys(
        `<p>{{ 'shell.brand' | t }}</p> <p [title]="'shell.nope' | t"></p>`,
        new Set(['shell.brand']),
      ),
    ).toEqual(['shell.nope']);
  });
});

describe('the workspace', () => {
  it('registers every folder of translation files as an area', () => {
    const folders = readdirSync(__dirname, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    expect(folders.sort()).toEqual([...AREAS].sort());
  });

  it.each(AREAS)('keeps the %s files in step', (area) => {
    expect(
      fileProblems(area, areaFile(area, 'ro'), areaFile(area, 'en')),
    ).toEqual([]);
  });

  it('has no typed-in text and no unknown key in any template', () => {
    const keys = new Set(
      AREAS.flatMap((area) => Object.keys(flatten(area, areaFile(area, 'ro')))),
    );
    const dirs = [
      join(root, 'apps/web/src'),
      ...readdirSync(join(root, 'libs')).map((lib) =>
        join(root, 'libs', lib, 'src'),
      ),
    ];
    const problems = dirs
      .flatMap(sourceFiles)
      .flatMap((file) =>
        templatesOf(file).flatMap((template) =>
          [...typedText(template), ...unknownKeys(template, keys)].map(
            (found) => `${relative(root, file)}: ${found}`,
          ),
        ),
      );

    expect(problems).toEqual([]);
  });
});
