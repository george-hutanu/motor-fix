import { cityOf } from './city';

// @traces 163-FR-005
describe('the city of a hostile locality', () => {
  it.each([
    ['null', null],
    ['an object', { name: 'Cluj' }],
    ['an array', ['Cluj']],
    ['a boolean', true],
    ['a tab and newline only', '\t\n'],
    ['only punctuation', '!!!'],
  ])('knows no city for %s', (_, locality) => {
    expect(cityOf(locality)).toBeNull();
  });

  it('measures the length after inner runs of spaces collapse', () => {
    expect(
      cityOf(`${'a'.repeat(39)}${' '.repeat(10)}${'b'.repeat(39)}`),
    ).toEqual({
      key: `${'a'.repeat(39)}-${'b'.repeat(39)}`,
      name: `${'a'.repeat(39)} ${'b'.repeat(39)}`,
    });
  });

  it('keeps a decomposed diacritic the same city as a composed one', () => {
    const composed = String.fromCharCode(73, 97, 0x219, 105);
    const decomposed = `Ias${String.fromCharCode(0x326)}i`;

    expect(cityOf(composed)?.key).toBe('iasi');
    expect(cityOf(decomposed)?.key).toBe('iasi');
  });

  it('does not fold a sector number past 6 into București', () => {
    expect(cityOf('Sector 7')?.key).toBe('sector-7');
  });

  it('does not fold a town whose name contains Bucharest', () => {
    expect(cityOf('Bucharest Heights')?.key).toBe('bucharest-heights');
  });

  it('gives a key of ASCII only for non-latin text, or none', () => {
    const city = cityOf('東京 Tokyo');

    expect(city?.key).toBe('tokyo');
  });

  it('knows no city for a locality of only non-latin letters', () => {
    expect(cityOf('東京')).toBeNull();
  });
});
