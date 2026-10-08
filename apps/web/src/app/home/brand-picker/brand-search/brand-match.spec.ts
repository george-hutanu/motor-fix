import type { BrandDto } from '@motor-fix/data-access';

import { matches } from './brand-match';

const brand = (name: string, popularity: number | null = null): BrandDto => ({
  id: name,
  name,
  popularity,
  slug: name.toLowerCase(),
});
const CATALOGUE = [
  brand('BMW', 1),
  brand('Mercedes-Benz', 2),
  brand('Škoda', 3),
  brand('Alfa Romeo'),
  brand('Citroën'),
];
const names = (found: BrandDto[]) => found.map((b) => b.name);

describe('matches', () => {
  it.each([
    ['alf', ['Alfa Romeo']],
    ['skoda', ['Škoda']],
    ['SKODA', ['Škoda']],
    ['citroen', ['Citroën']],
    ['CITROËN', ['Citroën']],
    ['romeo', ['Alfa Romeo']],
    ['benz', ['Mercedes-Benz']],
    ['alfa r', ['Alfa Romeo']],
    ['  alf ', ['Alfa Romeo']],
  ])('finds %j by the start of the name or of a word', (text, found) => {
    expect(names(matches(CATALOGUE, text))).toEqual(found);
  });

  it.each(['lfa', 'oen', 'zzz'])(
    'finds nothing for %j, which starts no word',
    (text) => {
      expect(matches(CATALOGUE, text)).toEqual([]);
    },
  );

  it.each(['', '   '])('suggests nothing for an empty text %j', (text) => {
    expect(matches(CATALOGUE, text)).toEqual([]);
  });

  it('keeps the order it is given, the most popular first', () => {
    const list = [brand('Mazda', 1), brand('Mini', 2), brand('Maserati')];

    expect(names(matches(list, 'm'))).toEqual(['Mazda', 'Mini', 'Maserati']);
  });

  it('returns the first eight of more than eight matches', () => {
    const list = Array.from({ length: 11 }, (_, i) => brand(`Auto ${i + 1}`));

    expect(names(matches(list, 'auto'))).toEqual(
      list.slice(0, 8).map((b) => b.name),
    );
  });
});
