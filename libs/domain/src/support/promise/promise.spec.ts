import { promiseLine } from './promise';

// @traces 280-FR-016 280-FR-019 280-FR-022

const TODAY = '2026-10-17';
const NONE = new Set<string>();
// Saint Andrew's day and the national day: a Monday and a Tuesday.
const HOLIDAYS = new Set(['2026-11-30', '2026-12-01']);

const STANDARD = {
  en: 'We answer within one working day.',
  ro: 'Îți răspundem în cel mult o zi lucrătoare.',
};

describe('the acknowledgement’s promise line', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['in the past', '2026-10-01'],
    ['today', TODAY],
    ['malformed', '17.10.2026'],
    ['not a day', '2026-02-30'],
  ])('promises one working day when the away date is %s', (_, away) => {
    expect(promiseLine('ro', away, TODAY, NONE)).toBe(STANDARD.ro);
    expect(promiseLine('en', away, TODAY, NONE)).toBe(STANDARD.en);
  });

  it('names a future working day as a long date in each language', () => {
    expect(promiseLine('ro', '2026-11-02', TODAY, NONE)).toBe(
      'Îți răspundem până pe 2 noiembrie 2026.',
    );
    expect(promiseLine('en', '2026-11-02', TODAY, NONE)).toBe(
      'We will answer by 2 November 2026.',
    );
  });

  it('moves past a weekend to the Monday', () => {
    expect(promiseLine('en', '2026-10-24', TODAY, NONE)).toBe(
      'We will answer by 26 October 2026.',
    );
  });

  it('moves past the weekend and the public holidays after it', () => {
    expect(promiseLine('ro', '2026-11-28', TODAY, HOLIDAYS)).toBe(
      'Îți răspundem până pe 2 decembrie 2026.',
    );
  });

  it('answers tomorrow’s date when away until tomorrow, a working day', () => {
    expect(promiseLine('en', '2026-10-19', '2026-10-18', NONE)).toBe(
      'We will answer by 19 October 2026.',
    );
  });

  it('reads any language but English as Romanian', () => {
    expect(promiseLine('de', undefined, TODAY, NONE)).toBe(STANDARD.ro);
  });
});
