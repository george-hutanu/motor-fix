import {
  baniToLei,
  leiToBani,
  PRICE_MAX_BANI,
  PRICE_MIN_BANI,
} from './price-range';

describe('baniToLei', () => {
  it.each([
    [0, 0],
    [100, 1],
    [150, 1.5],
    [1, 0.01],
    [PRICE_MIN_BANI, 1],
    [PRICE_MAX_BANI, 100_000],
    [-100, -1],
  ])('turns %d bani into %d lei', (bani, lei) => {
    expect(baniToLei(bani)).toBe(lei);
  });

  it('answers a whole lei for every whole-lei amount in the allowed range', () => {
    for (let lei = 1; lei <= 100_000; lei += 7) {
      expect(baniToLei(lei * 100)).toBe(lei);
    }
  });

  it('turns a whole-lei amount back to the same bani', () => {
    for (const bani of [100, 12_300, 99_900, PRICE_MAX_BANI]) {
      expect(leiToBani(baniToLei(bani))).toBe(bani);
    }
  });

  it('shows the largest price without an exponent', () => {
    expect(String(baniToLei(PRICE_MAX_BANI))).toBe('100000');
  });

  it('shows the smallest unit without an exponent', () => {
    expect(String(baniToLei(1))).toBe('0.01');
  });

  it('passes NaN through rather than inventing a number', () => {
    expect(baniToLei(Number.NaN)).toBeNaN();
  });
});

describe('leiToBani against typed input', () => {
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'refuses %d lei',
    (lei) => {
      expect(() => leiToBani(lei)).toThrow(RangeError);
    },
  );

  it.each(['12', null, undefined, {}])(
    'refuses %j, which is not a number',
    (value) => {
      expect(() => leiToBani(value as unknown as number)).toThrow(RangeError);
    },
  );

  it('turns zero and -0 into zero bani', () => {
    expect(leiToBani(0)).toBe(0);
    expect(Object.is(leiToBani(-0) + 0, 0)).toBe(true);
  });

  it('takes the largest price in lei', () => {
    expect(leiToBani(100_000)).toBe(PRICE_MAX_BANI);
  });
});
