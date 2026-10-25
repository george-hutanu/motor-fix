import { formatLeiSpan } from './index';

// @traces 1367-FR-002
describe('formatLeiSpan under odd ends', () => {
  it('writes two zero ends as one amount', () => {
    expect(formatLeiSpan(0, 0, 'ro')).toBe('0 lei');
  });

  it('writes a zero start as a range', () => {
    expect(formatLeiSpan(0, 10000, 'en')).toBe('0 – 100 lei');
  });

  it('rounds fractional bani before comparing the ends', () => {
    expect(formatLeiSpan(420000.4, 419999.6, 'ro')).toBe('4.200 lei');
  });

  it('keeps reversed ends in the order given', () => {
    expect(formatLeiSpan(440000, 380000, 'ro')).toBe('4.400 – 3.800 lei');
  });

  it('writes a billion-leu end with grouping on both languages', () => {
    expect(formatLeiSpan(100, 100_000_000_000, 'ro')).toContain(
      '1.000.000.000',
    );
    expect(formatLeiSpan(100, 100_000_000_000, 'en')).toContain(
      '1,000,000,000',
    );
  });

  it.each([
    ['5', '6'],
    [null, 100],
    [100, undefined],
    [Number.NaN, Number.NaN],
    [Number.POSITIVE_INFINITY, 100],
    [[], {}],
  ])('shows the dash for %p and %p', (a, b) => {
    expect(formatLeiSpan(a, b, 'ro')).toBe('—');
  });

  it('gives the same text for the same call twice', () => {
    expect(formatLeiSpan(380000, 440050, 'en')).toBe(
      formatLeiSpan(380000, 440050, 'en'),
    );
    expect(formatLeiSpan(380000, 440050, 'en')).toBe('3,800.00 – 4,400.50 lei');
  });
});
