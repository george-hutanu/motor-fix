import { awayAhead, promiseLine } from './promise';

// @traces 280-FR-016 280-FR-019
const TODAY = '2026-10-17';
const NONE = new Set<string>();
const STANDARD = {
  en: 'We answer within one working day.',
  ro: 'Îți răspundem în cel mult o zi lucrătoare.',
};

describe('the promise line under odd dates', () => {
  it('moves a Saturday and a Sunday away date to the following Monday', () => {
    expect(promiseLine('en', '2026-11-07', TODAY, NONE)).toBe(
      'We will answer by 9 November 2026.',
    );
    expect(promiseLine('en', '2026-11-08', TODAY, NONE)).toBe(
      'We will answer by 9 November 2026.',
    );
  });

  it('keeps a working away date as it is', () => {
    expect(promiseLine('ro', '2026-11-04', TODAY, NONE)).toBe(
      'Îți răspundem până pe 4 noiembrie 2026.',
    );
  });

  it('skips a holiday on the away date itself', () => {
    expect(
      promiseLine('en', '2026-11-30', TODAY, new Set(['2026-11-30'])),
    ).toBe('We will answer by 1 December 2026.');
  });

  it('skips a weekend followed by holidays on Monday and Tuesday', () => {
    const holidays = new Set(['2026-11-30', '2026-12-01']);
    expect(promiseLine('en', '2026-11-28', TODAY, holidays)).toBe(
      'We will answer by 2 December 2026.',
    );
  });

  it('skips a holiday Friday and the weekend after it', () => {
    expect(
      promiseLine('en', '2026-11-06', TODAY, new Set(['2026-11-06'])),
    ).toBe('We will answer by 9 November 2026.');
  });

  it('ignores a holiday that falls on a weekend only', () => {
    expect(
      promiseLine('en', '2026-11-07', TODAY, new Set(['2026-11-07'])),
    ).toBe('We will answer by 9 November 2026.');
  });

  it('crosses the year end', () => {
    expect(
      promiseLine(
        'en',
        '2026-12-31',
        TODAY,
        new Set(['2026-12-31', '2027-01-01']),
      ),
    ).toBe('We will answer by 4 January 2027.');
  });

  it('accepts the leap day and refuses the same date in a common year', () => {
    expect(promiseLine('en', '2028-02-29', TODAY, NONE)).toBe(
      'We will answer by 29 February 2028.',
    );
    expect(promiseLine('en', '2027-02-29', TODAY, NONE)).toBe(STANDARD.en);
  });

  it('treats tomorrow as ahead and today as not', () => {
    expect(awayAhead('2026-10-18', TODAY)).toBe(true);
    expect(awayAhead(TODAY, TODAY)).toBe(false);
    expect(awayAhead('2026-10-16', TODAY)).toBe(false);
  });

  it.each([
    '2026-11-03 ',
    ' 2026-11-03',
    '2026-11-03T10:00:00Z',
    '2026-1-3',
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '٢٠٢٦-١١-٠٣',
    'tomorrow',
    'null',
    '__proto__',
  ])('reads %j as not set', (away) => {
    expect(promiseLine('ro', away, TODAY, NONE)).toBe(STANDARD.ro);
    expect(awayAhead(away, TODAY)).toBe(false);
  });

  it.each(['', 'fr', 'EN', 'en-GB', '__proto__', 'constructor'])(
    'answers in Romanian for the language %j',
    (language) => {
      expect(promiseLine(language, undefined, TODAY, NONE)).toBe(STANDARD.ro);
      expect(promiseLine(language, '2026-11-04', TODAY, NONE)).toBe(
        'Îți răspundem până pe 4 noiembrie 2026.',
      );
    },
  );

  it('never answers a date that is not a working day, for every away day of a year', () => {
    const holidays = new Set(['2026-12-25', '2026-12-26', '2026-12-28']);
    for (let n = 0; n < 365; n++) {
      const day = new Date(Date.UTC(2026, 10, 1 + n))
        .toISOString()
        .slice(0, 10);
      const line = promiseLine('en', day, TODAY, holidays);
      const named = line.replace('We will answer by ', '').replace(/\.$/, '');
      const parsed = new Date(`${named} 12:00:00 UTC`);
      expect([0, 6]).not.toContain(parsed.getUTCDay());
      expect(['2026-12-25', '2026-12-26', '2026-12-28']).not.toContain(
        parsed.toISOString().slice(0, 10),
      );
    }
  });

  it('names a far-future date without throwing', () => {
    expect(promiseLine('en', '9999-12-31', TODAY, NONE)).toMatch(
      /^We will answer by .*9999\.$/,
    );
  });
});
