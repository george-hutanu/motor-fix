import { bellText } from './templates';

const CARS = 'https://motorfix.test/app/driver/cars';
const base = { cars: CARS, left: 30 };

const GENERIC = {
  en: 'You have a new notification',
  ro: 'Ai o notificare nouă',
};

describe('the DUE_ITP bell text under hostile input', () => {
  // @traces 032-FR-006 094-FR-013
  it.each([
    [
      '2026-11-09',
      'ro',
      'ITP-ul la BMW 320d expiră pe 9 noiembrie 2026, peste 30 de zile.',
    ],
    [
      '2026-11-09',
      'en',
      'The ITP on your BMW 320d expires on 9 November 2026, in 30 days.',
    ],
  ])('names the car and the day %s in %s', (dueOn, language, expected) => {
    expect(
      bellText('DUE_ITP', language, { ...base, car: 'BMW 320d', dueOn }),
    ).toBe(expected);
  });

  // @traces 032-FR-006 094-FR-013
  it.each([
    ['2026-01-01', 'ro', '1 ianuarie 2026'],
    ['2026-12-31', 'ro', '31 decembrie 2026'],
    ['2028-02-29', 'ro', '29 februarie 2028'],
    ['2026-01-01', 'en', '1 January 2026'],
    ['2026-12-31', 'en', '31 December 2026'],
  ])('shows the stored day %s unshifted in %s', (dueOn, language, day) => {
    expect(
      bellText('DUE_ITP', language, { ...base, car: 'Dacia Logan', dueOn }),
    ).toContain(day);
  });

  // @traces 032-FR-006 094-FR-013
  it.each(['ro', 'en'] as const)(
    'falls back to the generic %s text when the car is missing',
    (language) => {
      expect(
        bellText('DUE_ITP', language, { ...base, dueOn: '2026-11-09' }),
      ).toBe(GENERIC[language]);
    },
  );

  // @traces 032-FR-006 094-FR-013
  it.each(['ro', 'en'] as const)(
    'falls back to the generic %s text when the date is missing',
    (language) => {
      expect(bellText('DUE_ITP', language, { ...base, car: 'BMW 320d' })).toBe(
        GENERIC[language],
      );
    },
  );

  // @traces 032-FR-006 094-FR-013
  it.each([null, undefined, {}])(
    'falls back to the generic text for params %p',
    (params) => {
      expect(bellText('DUE_ITP', 'ro', params as never)).toBe(GENERIC.ro);
    },
  );

  // @traces 032-FR-006 094-FR-013
  // Blank or non-text names are outside the contract: the reminder always
  // passes the car's brand and model, both required non-empty.
  it.each([null, undefined])(
    'falls back to the generic text for the car %p',
    (car) => {
      expect(
        bellText('DUE_ITP', 'en', {
          ...base,
          car,
          dueOn: '2026-11-09',
        } as never),
      ).toBe(GENERIC.en);
    },
  );

  // @traces 032-FR-006 094-FR-013
  it.each([
    '',
    'soon',
    '2026-13-40',
    '2026-02-30',
    '09/11/2026',
    null,
    20261109,
  ])('falls back to the generic text for the date %p', (dueOn) => {
    expect(
      bellText('DUE_ITP', 'ro', { ...base, car: 'BMW 320d', dueOn } as never),
    ).toBe(GENERIC.ro);
  });

  // @traces 032-FR-006 094-FR-013
  it('renders braces and markup in a car name verbatim without expanding them', () => {
    expect(
      bellText('DUE_ITP', 'en', {
        ...base,
        car: '{dueOn} <b>Ă</b>',
        dueOn: '2026-11-09',
      }),
    ).toBe(
      'The ITP on your {dueOn} <b>Ă</b> expires on 9 November 2026, in 30 days.',
    );
  });

  // @traces 032-FR-006 094-FR-013
  it('ignores undeclared values such as a plate', () => {
    expect(
      bellText('DUE_ITP', 'en', {
        ...base,
        car: 'BMW 320d',
        dueOn: '2026-11-09',
        plate: 'B 123 ABC',
      }),
    ).not.toContain('B 123 ABC');
  });

  // @traces 032-FR-006 094-FR-013
  it('gives the same text for the same params twice', () => {
    const params = { ...base, car: 'BMW 320d', dueOn: '2026-11-09' };
    expect(bellText('DUE_ITP', 'ro', params)).toBe(
      bellText('DUE_ITP', 'ro', params),
    );
  });
});
