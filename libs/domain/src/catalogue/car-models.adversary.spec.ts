import { BODY_STYLES, BRANDS } from './brands';
import {
  CAR_MODELS,
  CarModelFileError,
  carForBrand,
  validateCarModels,
} from './car-models';

type Model = (typeof CAR_MODELS)[number];

const car = (
  key: string,
  brand: string,
  rank: number,
  fuel: Model['fuel'] = 'petrol',
): Model => ({ brand, fuel, key, model: key, rank });

describe('validateCarModels under attack', () => {
  // @traces 405-FR-004
  it('accepts an empty catalogue', () => {
    expect(() => validateCarModels([])).not.toThrow(CarModelFileError);
  });

  // @traces 405-FR-004
  it('accepts a single model of rank 1', () => {
    expect(validateCarModels([car('a-1', 'a', 1)])).toBeUndefined();
  });

  // @traces 405-FR-004
  it.each([0, -1, 1.5, Number.NaN, 2])(
    'refuses a brand whose only model has rank %p',
    (rank) => {
      expect(() => validateCarModels([car('a-1', 'a', rank)])).toThrow(
        CarModelFileError,
      );
    },
  );

  // @traces 405-FR-004
  it('refuses a brand holding ranks 1 and 3 with no 2', () => {
    expect(() =>
      validateCarModels([car('a-1', 'a', 1), car('a-3', 'a', 3)]),
    ).toThrow(CarModelFileError);
  });

  // @traces 405-FR-004
  it('refuses a fractional rank between two whole ranks', () => {
    expect(() =>
      validateCarModels([
        car('a-1', 'a', 1),
        car('a-15', 'a', 1.5),
        car('a-2', 'a', 2),
      ]),
    ).toThrow(CarModelFileError);
  });

  // @traces 405-FR-004
  it('accepts ranks 1..n listed out of order', () => {
    expect(() =>
      validateCarModels([
        car('a-2', 'a', 2),
        car('b-1', 'b', 1),
        car('a-1', 'a', 1),
      ]),
    ).not.toThrow();
  });

  // @traces 405-FR-004
  it('accepts the same rank in two different brands', () => {
    expect(() =>
      validateCarModels([car('a-1', 'a', 1), car('b-1', 'b', 1)]),
    ).not.toThrow();
  });

  // @traces 405-FR-004
  it('names the duplicate key before a shared rank listed earlier', () => {
    const fn = () =>
      validateCarModels([
        car('b-1', 'b', 1),
        car('b-2', 'b', 1),
        car('a-1', 'a', 1),
        car('a-1', 'c', 1),
      ]);
    expect(fn).toThrow(CarModelFileError);
    expect(fn).toThrow(/key/i);
    expect(fn).toThrow(/a-1/);
  });

  // @traces 405-FR-004
  it('names a shared rank in a later brand before a rank gap in an earlier brand', () => {
    const fn = () =>
      validateCarModels([
        car('a-1', 'a', 1),
        car('a-3', 'a', 3),
        car('b-1', 'b', 1),
        car('b-1x', 'b', 1),
      ]);
    expect(fn).toThrow(CarModelFileError);
    expect(fn).toThrow(/b/);
    expect(fn).not.toThrow(/gap|1\.\.|exactly/i);
  });

  // @traces 405-FR-004
  it('names a rank gap in a later brand before a bad fuel in an earlier brand', () => {
    const bad = { ...car('a-1', 'a', 1), fuel: 'lpg' } as unknown as Model;
    const fn = () => validateCarModels([bad, car('b-2', 'b', 2)]);
    expect(fn).toThrow(CarModelFileError);
    expect(fn).toThrow(/b/);
    expect(fn).not.toThrow(/lpg/);
  });

  // @traces 405-FR-004
  it('refuses a fuel outside the four, including empty and wrong case', () => {
    for (const fuel of ['', 'Petrol', 'lpg', 'ELECTRIC']) {
      const bad = { ...car('a-1', 'a', 1), fuel } as unknown as Model;
      expect(() => validateCarModels([bad])).toThrow(CarModelFileError);
    }
  });

  // @traces 405-FR-004
  it('refuses a missing fuel', () => {
    const bad = { ...car('a-1', 'a', 1), fuel: undefined } as unknown as Model;
    expect(() => validateCarModels([bad])).toThrow(CarModelFileError);
  });

  // @traces 405-FR-004
  it('does not mutate or reorder its input and gives the same answer twice', () => {
    const input = Object.freeze([
      Object.freeze(car('a-2', 'a', 2)),
      Object.freeze(car('a-1', 'a', 1)),
    ]);
    const snapshot = JSON.stringify(input);
    validateCarModels(input);
    validateCarModels(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  // @traces 405-FR-004
  it('refuses the same faulty catalogue the same way twice', () => {
    const bad = [car('a-1', 'a', 1), car('a-1', 'a', 2)];
    const message = (() => {
      try {
        validateCarModels(bad);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    expect(message).not.toBe('');
    expect(() => validateCarModels(bad)).toThrow(message);
  });

  // @traces 405-FR-004
  it('handles ten thousand models of one brand ranked 1..n', () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
      car(`a-${i + 1}`, 'a', i + 1),
    );
    expect(() => validateCarModels(many)).not.toThrow();
  });
});

describe('carForBrand under attack', () => {
  // @traces 405-FR-003
  it('answers generic saloon for every brand when the catalogue is empty and the brand has no style', () => {
    expect(carForBrand('bmw', [])).toEqual({
      bodyStyle: 'saloon',
      kind: 'generic',
    });
  });

  // @traces 405-FR-003
  it('keeps a styled brand its body style when the catalogue is empty', () => {
    expect(carForBrand('dacia', [])).toEqual({
      bodyStyle: 'suv',
      kind: 'generic',
    });
  });

  // @traces 405-FR-003
  it('answers generic for a brand with only a rank 2 model', () => {
    expect(carForBrand('ford', [car('ford-x', 'ford', 2)])).toEqual({
      bodyStyle: 'fastback',
      kind: 'generic',
    });
  });

  // @traces 405-FR-003
  it('picks rank 1 even when a higher rank is listed first', () => {
    const models = [car('v-2', 'volkswagen', 2), car('v-1', 'volkswagen', 1)];
    expect(carForBrand('volkswagen', models)).toEqual({
      kind: 'licensed',
      model: models[1],
    });
  });

  // @traces 405-FR-003
  it('returns the model record itself for a licensed brand', () => {
    const only = car('z-1', 'zeta', 1, 'electric');
    const answer = carForBrand('zeta', [only]);
    expect(answer).toEqual({ kind: 'licensed', model: only });
  });

  // @traces 405-FR-003
  it('licenses a custom-catalogue brand that BRANDS does not know', () => {
    expect(BRANDS.some((b) => b.key === 'zeta')).toBe(false);
    const only = car('z-1', 'zeta', 1);
    expect(carForBrand('zeta', [only])).toEqual({
      kind: 'licensed',
      model: only,
    });
  });

  // @traces 405-FR-003
  it('answers generic saloon for an unknown brand without throwing', () => {
    expect(carForBrand('zeta', [])).toEqual({
      bodyStyle: 'saloon',
      kind: 'generic',
    });
  });

  // @traces 405-FR-003
  it.each([
    '',
    ' ',
    '  dacia',
    'dacia ',
    'DACIA',
    'Dacia',
    'dacía',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'da\u0000cia',
  ])('answers generic saloon for the key %j', (key) => {
    expect(carForBrand(key)).toEqual({ bodyStyle: 'saloon', kind: 'generic' });
  });

  // @traces 405-FR-003
  it('answers the same for the same call twice and leaves the catalogue alone', () => {
    const models = Object.freeze([Object.freeze(car('a-1', 'a', 1))]);
    const first = carForBrand('a', models);
    const second = carForBrand('a', models);
    expect(second).toEqual(first);
    expect(models).toEqual([car('a-1', 'a', 1)]);
  });

  // @traces 405-FR-003
  it('gives every shipped brand a licensed rank-1 model or a body style from BODY_STYLES', () => {
    for (const brand of BRANDS) {
      const answer = carForBrand(brand.key);
      if (answer.kind === 'generic') {
        expect(BODY_STYLES).toContain(answer.bodyStyle);
      } else {
        expect(answer.model.brand).toBe(brand.key);
        expect(answer.model.rank).toBe(1);
      }
    }
  });

  // @traces 405-FR-005
  it('lists opel among the fifteen brands, after citroen', () => {
    const keys = BRANDS.map((b) => b.key);
    expect(keys).toHaveLength(15);
    expect(keys.indexOf('opel')).toBe(keys.indexOf('citroen') + 1);
  });

  // @traces 405-FR-003
  it('gives the five styled brands their styles when unlicensed', () => {
    const none: Model[] = [];
    expect(
      ['volkswagen', 'dacia', 'toyota', 'skoda', 'ford'].map(
        (k) => (carForBrand(k, none) as { bodyStyle: string }).bodyStyle,
      ),
    ).toEqual(['hatchback', 'suv', 'crossover', 'estate', 'fastback']);
  });
});
