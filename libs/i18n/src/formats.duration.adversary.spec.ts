import { formatDuration, formatLeiRange } from './index';

// @traces 355-FR-009
describe('formatDuration at its boundaries', () => {
  it.each<[number, string, string]>([
    [1, '1 min', '1 min'],
    [45, '45 min', '45 min'],
    [59, '59 min', '59 min'],
    [60, '1 h', '1 h'],
    [65, '1 h 5', '1 h 5'],
    [90, '1 h 30', '1 h 30'],
    [119, '1 h 59', '1 h 59'],
    [120, '2 h', '2 h'],
    [479, '7 h 59', '7 h 59'],
    [480, '1 zi', '1 day'],
    [481, '8 h 1', '8 h 1'],
    [540, '9 h', '9 h'],
    [600, '10 h', '10 h'],
    [960, '2 zile', '2 days'],
    [1440, '3 zile', '3 days'],
    [1441, '24 h 1', '24 h 1'],
    [480 * 365, '365 zile', '365 days'],
  ])('writes %i minutes as the spec words it', (minutes, ro, en) => {
    expect([
      formatDuration(minutes, 'ro'),
      formatDuration(minutes, 'en'),
    ]).toEqual([ro, en]);
  });

  it.each([0, -1, -480, Number.NEGATIVE_INFINITY])(
    'shows nothing for %s minutes',
    (minutes) => {
      expect(formatDuration(minutes, 'ro')).toBe('');
      expect(formatDuration(minutes, 'en')).toBe('');
    },
  );

  it.each([
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '',
    '30',
    '1e3',
    true,
    [],
    [30],
    {},
    BigInt(30),
    Object(30),
  ])('shows nothing for %p', (value) => {
    expect(formatDuration(value, 'ro')).toBe('');
    expect(formatDuration(value, 'en')).toBe('');
  });
});

// @traces 355-FR-008
describe('formatLeiRange for the price list', () => {
  it('writes the same stored value with each language grouping', () => {
    expect(formatLeiRange(89_000, 140_000, 'ro')).toBe('890–1.400 lei');
    expect(formatLeiRange(89_000, 140_000, 'en')).toBe('890–1,400 lei');
  });

  it('writes one amount when the ends are equal', () => {
    expect(formatLeiRange(30_000, 30_000, 'ro')).toBe('300 lei');
  });

  it('shows a reversed range as stored', () => {
    expect(formatLeiRange(22_000, 15_000, 'ro')).toBe('220–150 lei');
  });

  it('groups a million lei', () => {
    expect(formatLeiRange(100_000_000, 200_000_000, 'ro')).toBe(
      '1.000.000–2.000.000 lei',
    );
  });
});
