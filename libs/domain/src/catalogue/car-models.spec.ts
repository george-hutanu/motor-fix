import { BRANDS } from './brands';
import {
  CAR_MODELS,
  CarModelFileError,
  carForBrand,
  validateCarModels,
} from './car-models';

type LicensedCarModel = (typeof CAR_MODELS)[number];

const car = (
  key: string,
  brand: string,
  rank: number,
  fuel: LicensedCarModel['fuel'] = 'petrol',
): LicensedCarModel => ({ brand, fuel, key, model: key, rank });

describe('the shipped car models', () => {
  // @traces 405-FR-001 405-FR-002
  it('holds the twenty most registered model families, in register order', () => {
    expect(CAR_MODELS.map((m) => `${m.brand} ${m.model} ${m.rank}`)).toEqual([
      'dacia Logan 1',
      'volkswagen Golf 1',
      'volkswagen Passat 2',
      'opel Astra 1',
      'ford Focus 1',
      'audi A4 1',
      'skoda Octavia 1',
      'bmw Seria 3 1',
      'dacia Duster 2',
      'renault Megane 1',
      'volkswagen Polo 3',
      'skoda Fabia 2',
      'dacia Sandero 3',
      'bmw Seria 5 2',
      'ford Fiesta 2',
      'opel Corsa 2',
      'audi A6 2',
      'volkswagen Touran 4',
      'volkswagen Tiguan 5',
      'renault Clio 2',
    ]);
    expect(new Set(CAR_MODELS.map((m) => m.key)).size).toBe(20);
  });

  // @traces 405-FR-002
  it('gives each family its most registered fuel', () => {
    const petrol = CAR_MODELS.filter((m) => m.fuel === 'petrol').map(
      (m) => m.model,
    );

    expect(petrol).toEqual([
      'Logan',
      'Polo',
      'Fabia',
      'Sandero',
      'Fiesta',
      'Corsa',
      'Clio',
    ]);
    expect(
      CAR_MODELS.filter((m) => m.fuel !== 'petrol').every(
        (m) => m.fuel === 'diesel',
      ),
    ).toBe(true);
  });

  // @traces 405-FR-004
  it('passes its own validator', () => {
    expect(() => validateCarModels(CAR_MODELS)).not.toThrow();
  });

  // @traces 405-FR-006
  it('names only brands of the brand list', () => {
    const named = (brands: readonly { key: string }[]) => {
      const keys = new Set(brands.map((b) => b.key));
      return CAR_MODELS.every((m) => keys.has(m.brand));
    };

    expect(named(BRANDS)).toBe(true);
    expect(named(BRANDS.filter((b) => b.key !== 'opel'))).toBe(false);
  });

  // @traces 405-FR-007
  it('carries no licence, seller, cost or renewal', () => {
    for (const model of CAR_MODELS) {
      expect(Object.keys(model).sort()).toEqual([
        'brand',
        'fuel',
        'key',
        'model',
        'rank',
      ]);
    }
  });
});

describe('validateCarModels', () => {
  // @traces 405-FR-004
  it.each([
    [
      'a duplicate key',
      [car('golf', 'volkswagen', 1), car('golf', 'volkswagen', 2)],
      'duplicate key "golf"',
    ],
    [
      'two models of one brand with one rank',
      [car('golf', 'volkswagen', 1), car('polo', 'volkswagen', 1)],
      'brand "volkswagen" ranks golf and polo both 1',
    ],
    [
      'a gap in a brand’s ranks',
      [car('golf', 'volkswagen', 1), car('polo', 'volkswagen', 3)],
      'brand "volkswagen" has ranks 1, 3; they must be 1 to 2',
    ],
    [
      'a fuel outside the four',
      [car('golf', 'volkswagen', 1, 'lpg' as LicensedCarModel['fuel'])],
      'model "golf" has fuel "lpg"',
    ],
  ])('refuses %s, naming it', (_, models, message) => {
    const run = () => validateCarModels(models);

    expect(run).toThrow(CarModelFileError);
    expect(run).toThrow(message);
  });

  // @traces 405-FR-004
  it('names a duplicate key before any other fault', () => {
    expect(() =>
      validateCarModels([
        car('golf', 'volkswagen', 1, 'lpg' as LicensedCarModel['fuel']),
        car('golf', 'volkswagen', 1),
      ]),
    ).toThrow('duplicate key "golf"');
  });

  // @traces 405-FR-004
  it('refuses a brand whose ranks do not start at 1', () => {
    expect(() => validateCarModels([car('polo', 'volkswagen', 2)])).toThrow(
      'brand "volkswagen" has ranks 2; they must be 1 to 1',
    );
  });
});

describe('carForBrand', () => {
  // @traces 405-FR-003
  it.each([
    ['dacia', 'dacia-logan'],
    ['volkswagen', 'volkswagen-golf'],
    ['opel', 'opel-astra'],
    ['ford', 'ford-focus'],
    ['audi', 'audi-a4'],
    ['skoda', 'skoda-octavia'],
    ['bmw', 'bmw-seria-3'],
    ['renault', 'renault-megane'],
  ])('shows %s as its first licensed model', (brand, key) => {
    const answer = carForBrand(brand);

    expect(answer.kind).toBe('licensed');
    expect(answer.kind === 'licensed' && answer.model.key).toBe(key);
  });

  // @traces 405-FR-003
  it.each([
    ['toyota', 'crossover'],
    ['mercedes-benz', 'saloon'],
    ['mini', 'saloon'],
    ['hyundai', 'saloon'],
    ['tesla', 'saloon'],
    ['alfa-romeo', 'saloon'],
    ['citroen', 'saloon'],
    ['lada', 'saloon'],
  ])('shows %s as the generic %s', (brand, bodyStyle) => {
    expect(carForBrand(brand)).toEqual({ bodyStyle, kind: 'generic' });
  });

  // @traces 405-FR-003
  it.each([
    ['volkswagen', 'hatchback'],
    ['dacia', 'suv'],
    ['skoda', 'estate'],
    ['ford', 'fastback'],
    ['bmw', 'saloon'],
  ])(
    'falls back to the generic shape of %s, %s, once it has no licensed model',
    (brand, bodyStyle) => {
      const others = CAR_MODELS.filter((m) => m.brand !== brand);

      expect(carForBrand(brand, others)).toEqual({
        bodyStyle,
        kind: 'generic',
      });
    },
  );

  // @traces 405-FR-003
  it('compares brand keys exactly', () => {
    expect(carForBrand('Volkswagen')).toEqual({
      bodyStyle: 'saloon',
      kind: 'generic',
    });
  });
});
