import { fold } from '@motor-fix/contracts';

import { BRANDS, BrandFileError, slugOf, validateFile } from './brands';

describe('fold', () => {
  it.each([
    ['Škoda', 'skoda'],
    ['ŠKODA', 'skoda'],
    ['Citroën', 'citroen'],
    ['Ștefan', 'stefan'],
  ])('folds %s to %s', (text, folded) => {
    expect(fold(text)).toBe(folded);
  });
});

describe('slugOf', () => {
  it.each([
    ['Škoda', 'skoda'],
    ['Mercedes-Benz', 'mercedes-benz'],
    ['Alfa Romeo', 'alfa-romeo'],
    ['  Land  Rover ', 'land-rover'],
  ])('makes %s into %s', (name, slug) => {
    expect(slugOf(name)).toBe(slug);
  });
});

describe('validateFile', () => {
  it('takes a file with every key, name and slug once', () => {
    expect(() =>
      validateFile([
        { key: 'bmw', name: 'BMW', popularity: 1 },
        { key: 'dacia', name: 'Dacia' },
      ]),
    ).not.toThrow();
  });

  it.each([
    [
      'key',
      [
        { key: 'bmw', name: 'BMW' },
        { key: 'bmw', name: 'BMW Group' },
      ],
      'duplicate key "bmw": bmw, bmw',
    ],
    [
      'name',
      [
        { key: 'bmw', name: 'BMW' },
        { key: 'bmw-ag', name: 'BMW' },
      ],
      'duplicate name "BMW": bmw, bmw-ag',
    ],
    [
      'slug',
      [
        { key: 'skoda', name: 'Škoda' },
        { key: 'skoda-auto', name: 'Skoda' },
      ],
      'duplicate slug "skoda": skoda, skoda-auto',
    ],
  ])('refuses a duplicate %s, naming both brands', (_, records, message) => {
    const run = () => validateFile(records);

    expect(run).toThrow(BrandFileError);
    expect(run).toThrow(message);
  });
});

describe('the shipped brand file', () => {
  // @traces 405-FR-005
  it('holds the twelve brands of the mock in the mock order, then three unranked ones', () => {
    expect(BRANDS.map((brand) => brand.name)).toEqual([
      'BMW',
      'Mini',
      'Mercedes-Benz',
      'Audi',
      'Volkswagen',
      'Škoda',
      'Dacia',
      'Renault',
      'Ford',
      'Toyota',
      'Hyundai',
      'Tesla',
      'Alfa Romeo',
      'Citroën',
      'Opel',
    ]);
    expect(BRANDS.map((brand) => brand.popularity)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      undefined,
      undefined,
      undefined,
    ]);
    expect(BRANDS.find((brand) => brand.key === 'opel')?.name).toBe('Opel');
    expect(() => validateFile(BRANDS)).not.toThrow();
  });

  // @traces 405-FR-003
  it('gives five brands the body shape the mock draws for them and leaves the rest unset', () => {
    expect(
      Object.fromEntries(
        BRANDS.filter((brand) => brand.bodyStyle !== undefined).map((brand) => [
          brand.key,
          brand.bodyStyle,
        ]),
      ),
    ).toEqual({
      dacia: 'suv',
      ford: 'fastback',
      skoda: 'estate',
      toyota: 'crossover',
      volkswagen: 'hatchback',
    });
  });

  // @traces 007-FR-004
  // @traces 007-FR-005
  it('gives every brand its Romanian your form, the mock eight verbatim', () => {
    expect(
      Object.fromEntries(
        BRANDS.map((brand) => [brand.key, brand.roPossessive]),
      ),
    ).toEqual({
      'alfa-romeo': 'Alfa Romeo\u2011ul tău',
      audi: 'Audi\u2011ul tău',
      bmw: 'BMW\u2011ul tău',
      citroen: 'Citroënul tău',
      dacia: 'Dacia ta',
      ford: 'Fordul tău',
      hyundai: 'Hyundai\u2011ul tău',
      'mercedes-benz': 'Mercedesul tău',
      mini: 'Mini\u2011ul tău',
      opel: 'Opelul tău',
      renault: 'Renault\u2011ul tău',
      skoda: 'Škoda ta',
      tesla: 'Tesla ta',
      toyota: 'Toyota ta',
      volkswagen: 'VW\u2011ul tău',
    });
  });

  // @traces 007-FR-005
  it('joins a form with the non-breaking hyphen, never the plain one', () => {
    for (const brand of BRANDS) {
      expect(brand.roPossessive).not.toContain('-');
    }
    expect(
      BRANDS.filter((brand) => brand.roPossessive?.includes('\u2011ul')),
    ).toHaveLength(7);
  });
});
