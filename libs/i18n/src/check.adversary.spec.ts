import { fileProblems, typedText, unknownKeys } from './check';
import { flatten } from './files';

describe('flatten adversarial', () => {
  it('prefixes the area and joins nested keys with dots', () => {
    expect(flatten('garage', { a: { b: { c: 'x' } }, d: 'y' })).toEqual({
      'garage.a.b.c': 'x',
      'garage.d': 'y',
    });
  });

  it('returns nothing for empty texts', () => {
    expect(flatten('garage', {})).toEqual({});
  });
});

describe('fileProblems adversarial', () => {
  it('reports a key present only in English', () => {
    expect(fileProblems('garage', { a: 'x' }, { a: 'x', b: 'y' })).not.toEqual(
      [],
    );
  });

  it('reports whitespace-only values', () => {
    expect(fileProblems('garage', { a: '   ' }, { a: 'x' })).not.toEqual([]);
    expect(fileProblems('garage', { a: 'x' }, { a: '\t\n' })).not.toEqual([]);
  });

  it('reports every cedilla variant in Romanian but not the comma-below forms', () => {
    for (const ch of ['ş', 'ţ', 'Ş', 'Ţ'])
      expect(fileProblems('garage', { a: `x${ch}` }, { a: 'x' })).not.toEqual(
        [],
      );
    expect(fileProblems('garage', { a: 'șțȘȚ' }, { a: 'x' })).toEqual([]);
  });

  it('requires the few category in Romanian plurals and rejects it in English', () => {
    const noFew = { n: { one: '1', other: 'n' } };
    const withFew = { n: { few: 'f', one: '1', other: 'n' } };

    expect(fileProblems('garage', noFew, noFew)).not.toEqual([]);
    expect(fileProblems('garage', withFew, withFew)).not.toEqual([]);
    expect(fileProblems('garage', withFew, noFew)).toEqual([]);
  });

  it('reports a plural group with an unknown category', () => {
    expect(
      fileProblems(
        'garage',
        { n: { few: 'f', many: 'm', one: '1', other: 'n' } },
        { n: { one: '1', other: 'n' } },
      ),
    ).not.toEqual([]);
  });

  it('accepts matching files with nested groups', () => {
    expect(
      fileProblems('garage', { a: { b: 'x' } }, { a: { b: 'y' } }),
    ).toEqual([]);
  });
});

describe('typedText adversarial', () => {
  it('finds text inside ng-template, @for and @switch blocks', () => {
    expect(typedText('<ng-template #t><p>Hello</p></ng-template>')).not.toEqual(
      [],
    );
    expect(typedText('@for (i of xs; track i) {<li>Item</li>}')).not.toEqual(
      [],
    );
    expect(
      typedText(
        '@switch (x) { @case (1) {<b>One</b>} @default {<i>Other</i>} }',
      ),
    ).not.toEqual([]);
  });

  it('accepts templates whose text comes only from the t pipe', () => {
    expect(typedText("<p>{{ 'shell.brand' | t }}</p>")).toEqual([]);
    expect(typedText('@for (i of xs; track i) {<li>{{ i }}</li>}')).toEqual([]);
  });

  it('ignores static attributes with only whitespace or no letters', () => {
    expect(typedText('<img alt="  ">')).toEqual([]);
    expect(typedText('<input placeholder="123">')).toEqual([]);
  });

  it('finds every translatable static attribute containing a letter', () => {
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt', 'label'])
      expect(typedText(`<x ${attr}="Close"></x>`)).not.toEqual([]);
  });

  it('accepts bound attributes that use the pipe', () => {
    expect(
      typedText(`<button [attr.aria-label]="'shell.close' | t"></button>`),
    ).toEqual([]);
    expect(typedText(`<button [title]="'shell.close' | t"></button>`)).toEqual(
      [],
    );
  });

  it('finds a string literal inside an interpolation', () => {
    expect(typedText("<p>{{ 'Hello' }}</p>")).not.toEqual([]);
  });

  it('finds text with non-ASCII letters', () => {
    expect(typedText('<p>Încărcare</p>')).not.toEqual([]);
  });
});

describe('unknownKeys adversarial', () => {
  const keys = new Set(['shell.brand', 'garage.n.other']);

  it('reports nothing for known keys and plural group keys', () => {
    expect(
      unknownKeys(
        `{{ 'shell.brand' | t }} {{ 'garage.n' | t: { count: 2 } }}`,
        keys,
      ),
    ).toEqual([]);
  });

  it('reports an unknown literal key in text and in attribute bindings', () => {
    expect(unknownKeys(`{{ 'shell.nope' | t }}`, keys)).toEqual(['shell.nope']);
    expect(unknownKeys(`<a [title]="'shell.nope' | t"></a>`, keys)).toEqual([
      'shell.nope',
    ]);
  });

  it('does not treat a parent of a plain key as known', () => {
    expect(unknownKeys(`{{ 'shell' | t }}`, keys)).toEqual(['shell']);
  });

  it('ignores dynamic keys', () => {
    expect(unknownKeys(`{{ key | t }}`, keys)).toEqual([]);
  });

  it('finds keys inside @for and ng-template', () => {
    expect(
      unknownKeys(`@for (i of xs; track i) {<p>{{ 'x.y' | t }}</p>}`, keys),
    ).toEqual(['x.y']);
    expect(
      unknownKeys(`<ng-template><p>{{ 'x.z' | t }}</p></ng-template>`, keys),
    ).toEqual(['x.z']);
  });
});
