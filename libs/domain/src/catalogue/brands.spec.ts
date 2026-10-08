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
  it('holds the twelve brands of the mock, each once, in the mock order', () => {
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
    ]);
    expect(BRANDS.map((brand) => brand.popularity)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(() => validateFile(BRANDS)).not.toThrow();
  });
});
