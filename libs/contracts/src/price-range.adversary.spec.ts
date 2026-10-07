import {
  baniToLei,
  checkPriceRange,
  leiToBani,
  PRICE_MAX_BANI,
  PRICE_MIN_BANI,
} from './price-range';

describe('leiToBani on hostile input', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a fraction just above a whole number', 1.0000001],
    ['half a leu', 0.5],
  ])('refuses %s', (_, value) => {
    expect(() => leiToBani(value)).toThrow(RangeError);
  });

  it('refuses a string passed where a number was expected', () => {
    expect(() => leiToBani('12' as unknown as number)).toThrow(RangeError);
  });

  it('refuses null and undefined', () => {
    expect(() => leiToBani(null as unknown as number)).toThrow(RangeError);
    expect(() => leiToBani(undefined as unknown as number)).toThrow(RangeError);
  });

  it('turns zero into zero bani', () => {
    expect(leiToBani(0)).toBe(0);
  });

  it('refuses a lei amount whose bani cannot be held exactly', () => {
    expect(() => leiToBani(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it('round-trips every whole lei at the price bounds', () => {
    expect(baniToLei(leiToBani(1))).toBe(1);
    expect(baniToLei(leiToBani(100_000))).toBe(100_000);
    expect(leiToBani(1)).toBe(PRICE_MIN_BANI);
    expect(leiToBani(100_000)).toBe(PRICE_MAX_BANI);
  });
});

describe('checkPriceRange on hostile input', () => {
  const codes = (range: Parameters<typeof checkPriceRange>[0]) => {
    const { errors, warnings } = checkPriceRange(range);
    return {
      errors: errors.map((e) => `${e.field}:${e.code}`),
      warnings: warnings.map((w) => `${w.field}:${w.code}`),
    };
  };

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['undefined', undefined],
    ['a numeric string', '500'],
  ])('refuses %s as the starting price', (_, value) => {
    const result = codes({ fromBani: value as unknown as number });
    expect(result.errors).toEqual(['from:integer']);
    expect(result.warnings).toEqual([]);
  });

  it('refuses a negative starting price as below the minimum', () => {
    expect(codes({ fromBani: -100 }).errors).toEqual(['from:min']);
  });

  it('refuses a top of zero as below the starting price, not as absent', () => {
    expect(codes({ fromBani: 100, toBani: 0 })).toEqual({
      errors: ['to:below_from'],
      warnings: [],
    });
  });

  it('refuses a duration of zero, not as absent', () => {
    expect(codes({ durationMinutes: 0, fromBani: 100 }).errors).toEqual([
      'duration:min',
    ]);
  });

  it.each([
    ['negative', -15],
    ['a fraction', 15.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['one step past the cap', 4_815],
    ['one minute under the floor', 14],
    ['one minute off a step', 16],
  ])('refuses a duration that is %s', (_, minutes) => {
    const { errors } = checkPriceRange({
      durationMinutes: minutes,
      fromBani: 100,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('duration');
  });

  it('accepts a range with both ends at the maximum and warns of nothing', () => {
    expect(codes({ fromBani: PRICE_MAX_BANI, toBani: PRICE_MAX_BANI })).toEqual(
      { errors: [], warnings: [] },
    );
  });

  it('refuses a top one bani above the maximum', () => {
    expect(codes({ fromBani: 100, toBani: PRICE_MAX_BANI + 1 }).errors).toEqual(
      ['to:max'],
    );
  });

  it('refuses a starting price one bani under the minimum', () => {
    expect(codes({ fromBani: PRICE_MIN_BANI - 1 }).errors).toEqual([
      'from:min',
    ]);
  });

  it('warns at 301 bani over 100 and not at 300', () => {
    expect(codes({ fromBani: 100, toBani: 300 }).warnings).toEqual([]);
    expect(codes({ fromBani: 100, toBani: 301 }).warnings).toEqual([
      'to:wide_range',
    ]);
  });

  it('does not warn when the top is refused', () => {
    expect(
      codes({ fromBani: 100, toBani: PRICE_MAX_BANI + 1 }).warnings,
    ).toEqual([]);
  });

  it('does not change the range it is given and answers the same twice', () => {
    const range = { durationMinutes: 45, fromBani: 20_000, toBani: 500_000 };
    const copy = { ...range };
    const first = checkPriceRange(range);
    const second = checkPriceRange(range);
    expect(range).toEqual(copy);
    expect(second).toEqual(first);
    expect(first.warnings).toEqual([{ code: 'wide_range', field: 'to' }]);
  });

  it('ignores extra fields on the range', () => {
    const range = {
      fromBani: 100,
      toBani: 200,
      visible: false,
    } as unknown as Parameters<typeof checkPriceRange>[0];
    expect(checkPriceRange(range)).toEqual({ errors: [], warnings: [] });
  });
});
