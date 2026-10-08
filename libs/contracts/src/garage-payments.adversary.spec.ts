import {
  COURTESY_PRICE_MAX_BANI,
  COURTESY_PRICE_MIN_BANI,
  hoursComplete,
  isCourtesyPrice,
  isHoursSection,
  PAYMENTS,
} from './garage-hours';

describe('payment methods in the step 5 guard', () => {
  it('lists cash, card and transfer', () => {
    expect([...PAYMENTS]).toEqual(['cash', 'card', 'transfer']);
  });

  it('accepts a section without the new keys and with an empty payments list', () => {
    expect(isHoursSection({})).toBe(true);
    expect(isHoursSection({ payments: [] })).toBe(true);
  });

  it.each([
    ['a duplicate', ['cash', 'cash']],
    ['an unknown key', ['crypto']],
    ['an upper-case key', ['Cash']],
    ['null', null],
    ['a string', 'cash'],
    ['an object', { cash: true }],
    ['a number inside', [0]],
  ])('refuses payments given as %s', (_label, payments) => {
    expect(isHoursSection({ payments })).toBe(false);
  });

  it('keeps other stories keys untouched', () => {
    expect(isHoursSection({ payments: ['card'], place: { anything: 1 } })).toBe(
      true,
    );
  });
});

describe('courtesy car in the step 5 guard', () => {
  it.each([
    ['free', { paid: false }],
    ['paid with the price still to type', { paid: true }],
    ['paid at the minimum', { paid: true, pricePerDayBani: 100 }],
    ['paid at the maximum', { paid: true, pricePerDayBani: 200_000 }],
  ])('accepts %s', (_label, courtesyCar) => {
    expect(isHoursSection({ courtesyCar })).toBe(true);
  });

  it.each([
    ['one past the maximum', 200_100],
    ['an off-grid maximum', 200_001],
    ['one bani', 1],
    ['99 bani', 99],
    ['150 bani', 150],
    ['zero', 0],
    ['negative', -100],
    ['a fraction', 100.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '12000'],
    ['null', null],
    ['a boolean', true],
  ])('refuses a price that is %s', (_label, pricePerDayBani) => {
    expect(
      isHoursSection({ courtesyCar: { paid: true, pricePerDayBani } }),
    ).toBe(false);
  });

  it('accepts a free courtesy car that carries a valid price, since the guard checks shape only', () => {
    expect(
      isHoursSection({ courtesyCar: { paid: false, pricePerDayBani: 12_000 } }),
    ).toBe(true);
  });

  it.each([
    ['another key', { note: 'x', paid: false }],
    ['no paid', {}],
    ['paid as a string', { paid: 'true' }],
    ['paid as 1', { paid: 1 }],
    ['paid null', { paid: null }],
    ['an array', []],
    ['null', null],
    ['a string', 'free'],
  ])('refuses a courtesy car with %s', (_label, courtesyCar) => {
    expect(isHoursSection({ courtesyCar })).toBe(false);
  });

  it('accepts a courtesy car when the facilities lack the courtesy car', () => {
    expect(
      isHoursSection({
        courtesyCar: { paid: true, pricePerDayBani: 100 },
        facilities: ['waiting_area'],
      }),
    ).toBe(true);
  });
});

describe('courtesy price bounds', () => {
  it('exposes 100 and 200000 bani', () => {
    expect(COURTESY_PRICE_MIN_BANI).toBe(100);
    expect(COURTESY_PRICE_MAX_BANI).toBe(200_000);
  });

  it.each([
    [99, false],
    [100, true],
    [101, false],
    [199_900, true],
    [200_000, true],
    [200_100, false],
    [-0, false],
  ])('price %s is %s', (value, expected) => {
    expect(isCourtesyPrice(value)).toBe(expected);
  });

  it('refuses non-numbers', () => {
    expect(isCourtesyPrice(undefined)).toBe(false);
    expect(isCourtesyPrice('100')).toBe(false);
    expect(isCourtesyPrice(null)).toBe(false);
  });
});

describe('step 5 completeness', () => {
  it('is incomplete with no payment, and with an empty payments list', () => {
    expect(hoursComplete({})).toBe(false);
    expect(hoursComplete({ payments: [] })).toBe(false);
  });

  it('is complete with one payment and no courtesy car', () => {
    expect(hoursComplete({ payments: ['transfer'] })).toBe(true);
  });

  it('needs a price when the courtesy car is listed and paid', () => {
    const base = {
      facilities: ['courtesy_car'] as 'courtesy_car'[],
      payments: ['cash'] as 'cash'[],
    };
    expect(hoursComplete({ ...base, courtesyCar: { paid: true } })).toBe(false);
    expect(
      hoursComplete({
        ...base,
        courtesyCar: { paid: true, pricePerDayBani: 150 },
      }),
    ).toBe(false);
    expect(
      hoursComplete({
        ...base,
        courtesyCar: { paid: true, pricePerDayBani: 0 },
      }),
    ).toBe(false);
    expect(
      hoursComplete({
        ...base,
        courtesyCar: { paid: true, pricePerDayBani: 200_100 },
      }),
    ).toBe(false);
    expect(
      hoursComplete({
        ...base,
        courtesyCar: { paid: true, pricePerDayBani: 200_000 },
      }),
    ).toBe(true);
    expect(hoursComplete({ ...base, courtesyCar: { paid: false } })).toBe(true);
  });

  it('ignores a paid courtesy car without a price when the facility is not listed', () => {
    expect(
      hoursComplete({ courtesyCar: { paid: true }, payments: ['cash'] }),
    ).toBe(true);
  });

  it('is incomplete when a paid price is missing even if payments are ticked', () => {
    expect(
      hoursComplete({
        courtesyCar: { paid: true },
        facilities: ['courtesy_car'],
        payments: ['cash', 'card', 'transfer'],
      }),
    ).toBe(false);
  });

  it('does not throw on a section holding payments as null', () => {
    expect(hoursComplete({ payments: null } as never)).toBe(false);
  });
});
