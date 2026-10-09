import { cityOf } from './city';

// @traces 163-FR-005
describe('the city of a locality', () => {
  it.each([
    'București',
    'Bucuresti',
    'Bucharest',
    'Sector 2',
    'Sectorul 6',
    '  bucurești ',
  ])('folds %s into București', (locality) => {
    expect(cityOf(locality)).toEqual({ key: 'bucuresti', name: 'București' });
  });

  it.each([
    ['Cluj-Napoca', 'cluj-napoca', 'Cluj-Napoca'],
    [' Iași ', 'iasi', 'Iași'],
    ['Târgu Mureș', 'targu-mures', 'Târgu Mureș'],
    ['Satu  Mare', 'satu-mare', 'Satu Mare'],
    ['Drobeta-Turnu Severin', 'drobeta-turnu-severin', 'Drobeta-Turnu Severin'],
  ])('keys %s as %s and keeps its name', (locality, key, name) => {
    expect(cityOf(locality)).toEqual({ key, name });
  });

  it.each([
    ['missing', undefined],
    ['not text', 42],
    ['empty', ''],
    ['blank', '   '],
    ['longer than 80 characters', 'a'.repeat(81)],
    ['without a letter or digit', '— · —'],
  ])('knows no city when the locality is %s', (_, locality) => {
    expect(cityOf(locality)).toBeNull();
  });

  it('keeps a locality of exactly 80 characters', () => {
    expect(cityOf('a'.repeat(80))?.key).toBe('a'.repeat(80));
  });

  it('gives keys of lower-case letters and digits joined by single hyphens', () => {
    for (const locality of [
      'Ștefănești (Argeș)',
      '1 Decembrie',
      'a--b',
      '-x-',
    ]) {
      expect(cityOf(locality)?.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
