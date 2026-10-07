import {
  baniToLei,
  checkPriceRange,
  DURATION_MAX_MINUTES,
  leiToBani,
  PRICE_MAX_BANI,
  PRICE_MIN_BANI,
} from './price-range';

const lei = leiToBani;

describe('lei and bani', () => {
  it('turns whole lei into bani and back', () => {
    expect(lei(180)).toBe(18_000);
    expect(baniToLei(18_000)).toBe(180);
  });

  it('refuses lei with a fraction', () => {
    expect(() => lei(1.5)).toThrow(RangeError);
  });

  it('bounds a price between 1 leu and 100.000 lei', () => {
    expect(PRICE_MIN_BANI).toBe(lei(1));
    expect(PRICE_MAX_BANI).toBe(lei(100_000));
  });

  it('bounds a duration at 80 hours', () => {
    expect(DURATION_MAX_MINUTES).toBe(80 * 60);
  });
});

describe('the price range check', () => {
  it('accepts a range of 600 to 1.800 lei with no warning', () => {
    expect(checkPriceRange({ fromBani: lei(600), toBani: lei(1_800) })).toEqual(
      { errors: [], warnings: [] },
    );
  });

  it('accepts a starting price of 350 lei with no top', () => {
    expect(checkPriceRange({ fromBani: lei(350) })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('refuses a top below the starting price', () => {
    expect(
      checkPriceRange({ fromBani: lei(1_500), toBani: lei(1_400) }).errors,
    ).toEqual([{ code: 'below_from', field: 'to' }]);
  });

  it('accepts a top equal to the starting price', () => {
    expect(
      checkPriceRange({ fromBani: lei(500), toBani: lei(500) }).errors,
    ).toEqual([]);
  });

  it('warns on a top more than three times the starting price', () => {
    expect(checkPriceRange({ fromBani: lei(200), toBani: lei(5_000) })).toEqual(
      { errors: [], warnings: [{ code: 'wide_range', field: 'to' }] },
    );
  });

  it('does not warn at exactly three times', () => {
    expect(
      checkPriceRange({ fromBani: lei(200), toBani: lei(600) }).warnings,
    ).toEqual([]);
  });

  it('warns one ban above three times', () => {
    expect(
      checkPriceRange({ fromBani: lei(200), toBani: lei(600) + 1 }).warnings,
    ).toEqual([{ code: 'wide_range', field: 'to' }]);
  });

  it('refuses a starting price of 0', () => {
    expect(checkPriceRange({ fromBani: 0 }).errors).toEqual([
      { code: 'min', field: 'from' },
    ]);
  });

  it('accepts the smallest and largest prices', () => {
    expect(
      checkPriceRange({ fromBani: PRICE_MIN_BANI, toBani: PRICE_MAX_BANI })
        .errors,
    ).toEqual([]);
  });

  it('refuses a starting price above 100.000 lei', () => {
    expect(checkPriceRange({ fromBani: PRICE_MAX_BANI + 1 }).errors).toEqual([
      { code: 'max', field: 'from' },
    ]);
  });

  it('refuses a top above 100.000 lei', () => {
    expect(
      checkPriceRange({ fromBani: lei(500), toBani: lei(100_001) }).errors,
    ).toEqual([{ code: 'max', field: 'to' }]);
  });

  it('refuses amounts that are not whole bani', () => {
    expect(
      checkPriceRange({ fromBani: 100.5, toBani: 2_000.25 }).errors,
    ).toEqual([
      { code: 'integer', field: 'from' },
      { code: 'integer', field: 'to' },
    ]);
  });

  it('judges the top against the start only when the start is valid', () => {
    expect(checkPriceRange({ fromBani: 0, toBani: 50_000 }).errors).toEqual([
      { code: 'min', field: 'from' },
    ]);
  });

  it('warns only when both ends are valid', () => {
    expect(
      checkPriceRange({ fromBani: lei(200), toBani: PRICE_MAX_BANI + 1 })
        .warnings,
    ).toEqual([]);
  });

  it.each([
    [0, 'min'],
    [10, 'min'],
    [4_815, 'max'],
    [100, 'step'],
    [30.5, 'integer'],
  ])('refuses a duration of %p minutes (%s)', (minutes, code) => {
    expect(
      checkPriceRange({ durationMinutes: minutes, fromBani: lei(300) }).errors,
    ).toEqual([{ code, field: 'duration' }]);
  });

  it.each([15, 480, 4_800])('accepts a duration of %p minutes', (minutes) => {
    expect(
      checkPriceRange({ durationMinutes: minutes, fromBani: lei(300) }).errors,
    ).toEqual([]);
  });

  it('reports every field it refuses, one code each', () => {
    expect(
      checkPriceRange({ durationMinutes: 7, fromBani: 0, toBani: 1.5 }).errors,
    ).toEqual([
      { code: 'min', field: 'from' },
      { code: 'integer', field: 'to' },
      { code: 'min', field: 'duration' },
    ]);
  });
});
