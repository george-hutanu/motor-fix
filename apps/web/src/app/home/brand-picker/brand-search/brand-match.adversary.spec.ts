import type { BrandDto } from '@motor-fix/data-access';

import { matches } from './brand-match';

const brand = (name: string): BrandDto => ({
  id: `id-${name}`,
  name,
  popularity: null,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
});
const names = (list: readonly BrandDto[]) => list.map((b) => b.name);

const CITROEN = brand('Citroën');
const SKODA = brand('Škoda');
const ALFA = brand('Alfa Romeo');
const BENZ = brand('Mercedes-Benz');
const ASTON = brand('Aston Martin');
const ALL = [CITROEN, SKODA, ALFA, BENZ, ASTON];

describe('matches (edge cases)', () => {
  it('returns nothing for an empty brand list', () => {
    expect(matches([], 'a')).toEqual([]);
  });

  it('returns nothing for whitespace-only text, tabs and newlines included', () => {
    expect(matches(ALL, '   ')).toEqual([]);
    expect(matches(ALL, '\t\n ')).toEqual([]);
  });

  it('finds a diacritic brand from plain letters and a plain brand from diacritics', () => {
    expect(names(matches(ALL, 'citroen'))).toEqual(['Citroën']);
    expect(names(matches(ALL, 'CITROËN'))).toEqual(['Citroën']);
    expect(names(matches(ALL, 'škoda'))).toEqual(['Škoda']);
    expect(names(matches(ALL, 'ȃlfa'))).toEqual(['Alfa Romeo']);
  });

  it('folds Romanian comma-below letters typed against cedilla letters', () => {
    const list = [brand('Șerban Auto'), brand('Țiriac')];
    expect(names(matches(list, 'serban'))).toEqual(['Șerban Auto']);
    expect(names(matches(list, 'ş'))).toEqual(['Șerban Auto']);
    expect(names(matches(list, 'ţ'))).toEqual(['Țiriac']);
  });

  it('matches decomposed (combining mark) input like precomposed input', () => {
    expect(names(matches(ALL, 'Citroën'))).toEqual(['Citroën']);
  });

  it('finds a word after a hyphen or a space', () => {
    expect(names(matches(ALL, 'benz'))).toEqual(['Mercedes-Benz']);
    expect(names(matches(ALL, 'romeo'))).toEqual(['Alfa Romeo']);
    expect(names(matches(ALL, 'martin'))).toEqual(['Aston Martin']);
  });

  it('matches the start of the whole name across a space', () => {
    expect(names(matches(ALL, 'alfa r'))).toEqual(['Alfa Romeo']);
    expect(names(matches(ALL, 'mercedes-b'))).toEqual(['Mercedes-Benz']);
  });

  it('does not match inside a word', () => {
    expect(matches(ALL, 'lfa')).toEqual([]);
    expect(matches(ALL, 'omeo')).toEqual([]);
    expect(matches(ALL, 'enz')).toEqual([]);
  });

  it('ignores surrounding spaces but not inner ones', () => {
    expect(names(matches(ALL, '  alf '))).toEqual(['Alfa Romeo']);
    expect(matches(ALL, 'alfa  romeo')).toEqual([]);
  });

  it('keeps the order the brands were given in', () => {
    const list = [brand('Zeta A'), brand('Alpha'), brand('Beta A')];
    expect(names(matches(list, 'a'))).toEqual(['Zeta A', 'Alpha', 'Beta A']);
  });

  it('caps at the first eight of twenty matches', () => {
    const many = Array.from({ length: 20 }, (_, i) => brand(`Auto ${i}`));
    expect(names(matches(many, 'auto'))).toEqual(names(many.slice(0, 8)));
  });

  it('returns exactly eight when exactly eight match, and the first eight of nine', () => {
    const eight = Array.from({ length: 8 }, (_, i) => brand(`Auto ${i}`));
    expect(matches(eight, 'auto')).toHaveLength(8);
    const nine = [...eight, brand('Auto 8')];
    expect(names(matches(nine, 'auto'))).toEqual(names(eight));
  });

  it('returns the same brand objects it was given', () => {
    expect(matches(ALL, 'alfa')[0]).toBe(ALFA);
  });

  it('does not change the list it is given', () => {
    const copy = [...ALL];
    matches(ALL, 'a');
    expect(ALL).toEqual(copy);
  });

  it('treats regex characters as plain text', () => {
    expect(matches(ALL, '.*')).toEqual([]);
    expect(matches(ALL, '(')).toEqual([]);
    expect(matches([brand('C.R Auto')], 'c.')).toHaveLength(1);
  });

  it('returns the same result when called twice', () => {
    expect(matches(ALL, 'a')).toEqual(matches(ALL, 'a'));
  });

  it('handles a very long text without matching', () => {
    expect(matches(ALL, 'a'.repeat(100_000))).toEqual([]);
  });

  it('handles ten thousand brands', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => brand(`Marca ${i}`));
    expect(matches(many, 'marca 9999')).toHaveLength(1);
  });

  it('does not match a hyphen-only or space-only word start', () => {
    expect(matches(ALL, '-')).toEqual([]);
  });
});
