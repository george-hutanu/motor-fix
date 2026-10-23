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
  const MOCK_ORDER = [
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
  ];

  // @traces 245-FR-001
  it('holds every brand of the source list once, in rank order', () => {
    expect(BRANDS.map((brand) => brand.name)).toEqual([
      ...MOCK_ORDER,
      'Opel',
      'Peugeot',
      'SEAT',
      'Fiat',
      'Daewoo',
      'Nissan',
      'Suzuki',
      'Volvo',
      'Mazda',
      'Citroën',
      'Kia',
      'Mitsubishi',
      'Chevrolet',
      'Land Rover',
      'Honda',
      'Oltcit',
      'Alfa Romeo',
      'Smart',
      'ARO',
      'Jeep',
      'Porsche',
      'SsangYong',
      'Lada',
      'Lexus',
      'Subaru',
      'Trabant',
      'Jaguar',
      'Daihatsu',
      'MG',
      'Lancia',
      'Rover',
      'Saab',
      'Chrysler',
      'Cupra',
      'Vauxhall',
      'Dodge',
      'Wartburg',
      'DS',
      'Moskvich',
      'Infiniti',
      'Maserati',
      'Bentley',
      'BYD',
      'Isuzu',
      'Ferrari',
      'Lamborghini',
      'Rolls-Royce',
      'Lynk & Co',
      'Leapmotor',
      'Aston Martin',
      'McLaren',
      'Lotus',
    ]);
    expect(() => validateFile(BRANDS)).not.toThrow();
  });

  // @traces 245-FR-001
  it('keeps the keys and names of the brands shipped before it grew', () => {
    const byKey = new Map(BRANDS.map((brand) => [brand.key, brand.name]));

    expect(
      [
        ['bmw', 'BMW'],
        ['mini', 'Mini'],
        ['mercedes-benz', 'Mercedes-Benz'],
        ['audi', 'Audi'],
        ['volkswagen', 'Volkswagen'],
        ['skoda', 'Škoda'],
        ['dacia', 'Dacia'],
        ['renault', 'Renault'],
        ['ford', 'Ford'],
        ['toyota', 'Toyota'],
        ['hyundai', 'Hyundai'],
        ['tesla', 'Tesla'],
        ['alfa-romeo', 'Alfa Romeo'],
        ['citroen', 'Citroën'],
        ['opel', 'Opel'],
      ].filter(([key, name]) => byKey.get(key) !== name),
    ).toEqual([]);
  });

  // @traces 245-FR-001
  it('keys every brand by the slug of its name', () => {
    expect(
      BRANDS.filter((brand) => brand.key !== slugOf(brand.name)).map(
        (brand) => brand.key,
      ),
    ).toEqual([]);
  });

  // @traces 245-FR-002
  it('ranks every brand once, the twelve of the mock first in the mock order', () => {
    const ranks = BRANDS.map((brand) => brand.popularity);

    expect(ranks).toEqual(BRANDS.map((_, index) => index + 1));
    expect(
      BRANDS.filter((brand) => (brand.popularity ?? 0) <= 12).map(
        (brand) => brand.name,
      ),
    ).toEqual(MOCK_ORDER);
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
  // @traces 245-FR-003
  it('keeps the your forms shipped before it grew, the mock eight among them', () => {
    const byKey = new Map(
      BRANDS.map((brand) => [brand.key, brand.roPossessive]),
    );

    expect(
      Object.fromEntries(
        [
          'alfa-romeo',
          'audi',
          'bmw',
          'citroen',
          'dacia',
          'ford',
          'hyundai',
          'mercedes-benz',
          'mini',
          'opel',
          'renault',
          'skoda',
          'tesla',
          'toyota',
          'volkswagen',
        ].map((key) => [key, byKey.get(key)]),
      ),
    ).toEqual({
      'alfa-romeo': 'Alfa Romeo‑ul tău',
      audi: 'Audi‑ul tău',
      bmw: 'BMW‑ul tău',
      citroen: 'Citroënul tău',
      dacia: 'Dacia ta',
      ford: 'Fordul tău',
      hyundai: 'Hyundai‑ul tău',
      'mercedes-benz': 'Mercedesul tău',
      mini: 'Mini‑ul tău',
      opel: 'Opelul tău',
      renault: 'Renault‑ul tău',
      skoda: 'Škoda ta',
      tesla: 'Tesla ta',
      toyota: 'Toyota ta',
      volkswagen: 'VW‑ul tău',
    });
  });

  // @traces 245-FR-003
  it('gives every brand a your form with one of the three Romanian endings', () => {
    expect(
      BRANDS.filter(
        (brand) =>
          !/( ta|‑ul tău|[^\s‑]ul tău)$/u.test(brand.roPossessive ?? ''),
      ).map((brand) => brand.key),
    ).toEqual([]);
  });

  // @traces 245-FR-003
  it('says "ta" after a name ending in a, and "‑ul tău" after an acronym', () => {
    expect(
      BRANDS.filter(
        (brand) =>
          brand.name.endsWith('a') && brand.roPossessive !== `${brand.name} ta`,
      ).map((brand) => brand.key),
    ).toEqual([]);
    expect(
      BRANDS.filter(
        (brand) =>
          /^[A-Z]+$/.test(brand.name) &&
          brand.roPossessive !== `${brand.name}‑ul tău`,
      ).map((brand) => brand.key),
    ).toEqual([]);
  });

  // @traces 007-FR-005
  // @traces 245-FR-003
  it('joins a form with the non-breaking hyphen, never a plain hyphen or a dash', () => {
    expect(
      BRANDS.filter((brand) => /[-‐‒-―−]/u.test(brand.roPossessive ?? '')).map(
        (brand) => brand.key,
      ),
    ).toEqual([]);
    expect(
      BRANDS.find((brand) => brand.key === 'rolls-royce')?.roPossessive,
    ).toBe('Rolls‑Royce‑ul tău');
  });
});
