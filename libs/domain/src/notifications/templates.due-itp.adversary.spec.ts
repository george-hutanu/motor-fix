import { bellText } from './templates';

const GENERIC = {
  en: 'You have a new notification',
  ro: 'Ai o notificare nouă',
};

describe('the DUE_ITP bell text under hostile input', () => {
  // @traces 032-FR-006
  it.each([
    ['2026-11-09', 'ro', 'ITP-ul la BMW 320d expiră pe 9 nov. 2026'],
    ['2026-11-09', 'en', 'The ITP of your BMW 320d is due on 9 Nov 2026'],
  ])('names the car and the day %s in %s', (dueOn, language, expected) => {
    expect(bellText('DUE_ITP', language, { car: 'BMW 320d', dueOn })).toBe(
      expected,
    );
  });

  // @traces 032-FR-006
  it.each([
    ['2026-01-01', 'ro', '1 ian. 2026'],
    ['2026-12-31', 'ro', '31 dec. 2026'],
    ['2028-02-29', 'ro', '29 feb. 2028'],
    ['2026-01-01', 'en', '1 Jan 2026'],
    ['2026-12-31', 'en', '31 Dec 2026'],
  ])('shows the stored day %s unshifted in %s', (dueOn, language, day) => {
    expect(
      bellText('DUE_ITP', language, { car: 'Dacia Logan', dueOn }),
    ).toContain(day);
  });

  // @traces 032-FR-006
  it.each(['ro', 'en'] as const)(
    'falls back to the generic %s text when the car is missing',
    (language) => {
      expect(bellText('DUE_ITP', language, { dueOn: '2026-11-09' })).toBe(
        GENERIC[language],
      );
    },
  );

  // @traces 032-FR-006
  it.each(['ro', 'en'] as const)(
    'falls back to the generic %s text when the date is missing',
    (language) => {
      expect(bellText('DUE_ITP', language, { car: 'BMW 320d' })).toBe(
        GENERIC[language],
      );
    },
  );

  // @traces 032-FR-006
  it.each([null, undefined, {}])(
    'falls back to the generic text for params %p',
    (params) => {
      expect(bellText('DUE_ITP', 'ro', params as never)).toBe(GENERIC.ro);
    },
  );

  // @traces 032-FR-006
  // Blank or non-text names are outside the contract: the reminder always
  // passes the car's brand and model, both required non-empty.
  it.each([null, undefined])(
    'falls back to the generic text for the car %p',
    (car) => {
      expect(
        bellText('DUE_ITP', 'en', { car, dueOn: '2026-11-09' } as never),
      ).toBe(GENERIC.en);
    },
  );

  // @traces 032-FR-006
  it.each([
    '',
    'soon',
    '2026-13-40',
    '2026-02-30',
    '09/11/2026',
    null,
    20261109,
  ])('falls back to the generic text for the date %p', (dueOn) => {
    expect(bellText('DUE_ITP', 'ro', { car: 'BMW 320d', dueOn } as never)).toBe(
      GENERIC.ro,
    );
  });

  // @traces 032-FR-006
  it('renders braces and markup in a car name verbatim without expanding them', () => {
    expect(
      bellText('DUE_ITP', 'en', {
        car: '{dueOn} <b>Ă</b>',
        dueOn: '2026-11-09',
      }),
    ).toBe('The ITP of your {dueOn} <b>Ă</b> is due on 9 Nov 2026');
  });

  // @traces 032-FR-006
  it('ignores undeclared values such as a plate', () => {
    expect(
      bellText('DUE_ITP', 'en', {
        car: 'BMW 320d',
        dueOn: '2026-11-09',
        plate: 'B 123 ABC',
      }),
    ).not.toContain('B 123 ABC');
  });

  // @traces 032-FR-006
  it('gives the same text for the same params twice', () => {
    const params = { car: 'BMW 320d', dueOn: '2026-11-09' };
    expect(bellText('DUE_ITP', 'ro', params)).toBe(
      bellText('DUE_ITP', 'ro', params),
    );
  });
});
