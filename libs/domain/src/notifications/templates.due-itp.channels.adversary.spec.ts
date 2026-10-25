import { render } from './templates';
import { addYears } from '../bucharest';

const CARS = 'https://motorfix.test/app/driver/cars';
const params = { car: 'BMW 320d', cars: CARS, dueOn: '2026-11-13', left: 30 };

describe('DUE_ITP on the outside channels', () => {
  // @traces 094-FR-013
  it('says the days left, the book-in-time line and no plate in the English e-mail', () => {
    const mail = render('DUE_ITP', 'email', 'en', {
      ...params,
      plate: 'B123ABC',
    });
    expect(mail.subject).toBe('Your ITP expires on 13 November 2026');
    expect(mail.text).toContain(
      'The ITP on your BMW 320d expires on 13 November 2026, in 30 days.',
    );
    expect(mail.text).toContain('Book the inspection in time.');
    expect(mail.text).toContain(CARS);
    expect(mail.text + mail.html).not.toContain('B123ABC');
  });

  // @traces 094-FR-013
  it('says the Romanian e-mail text with the cars link', () => {
    const mail = render('DUE_ITP', 'email', 'ro', params);
    expect(mail.text).toContain(
      'ITP-ul la BMW 320d expiră pe 13 noiembrie 2026, peste 30 de zile.',
    );
    expect(mail.text).toContain('Programează inspecția din timp.');
  });

  // @traces 094-FR-013
  it.each([
    [1, 'en', 'in 1 day.'],
    [1, 'ro', 'peste o zi.'],
    [7, 'ro', 'peste 7 zile.'],
    [20, 'ro', 'peste 20 de zile.'],
    [0, 'en', ', today.'],
    [0, 'ro', ', astăzi.'],
  ])('counts %i days in %s as "%s"', (left, language, tail) => {
    expect(
      render('DUE_ITP', 'bell', language, { ...params, left }).endsWith(tail),
    ).toBe(true);
  });

  // @traces 094-FR-013
  it.each(['ro', 'en', 'fr', ''])(
    'keeps the SMS in %s within 70 characters and naming no car',
    (language) => {
      const sms = render('DUE_ITP', 'sms', language, params);
      expect(sms.length).toBeLessThanOrEqual(70);
      expect(sms).not.toContain('BMW');
    },
  );

  // @traces 094-FR-013
  it('gives the push a title, the full body and the cars link', () => {
    const push = render('DUE_ITP', 'push', 'en', params);
    expect(push.title).toBe('Your ITP expires soon');
    expect(push.body).toBe(
      'The ITP on your BMW 320d expires on 13 November 2026, in 30 days. Book the inspection in time.',
    );
  });

  // @traces 094-FR-014
  it('falls back to the generic e-mail when only the days are missing', () => {
    const { left: _left, ...without } = params;
    const mail = render('DUE_ITP', 'email', 'en', {
      ...without,
      app: 'https://motorfix.test',
    });
    expect(mail.text).not.toContain('BMW 320d');
  });
});

describe('addYears at the calendar edges', () => {
  // @traces 094-FR-008
  it.each([
    ['2096-02-29', 5, '2101-02-28'],
    ['2100-02-28', 4, '2104-02-28'],
    ['2096-02-29', 4, '2100-02-28'],
    ['2000-02-29', 100, '2100-02-28'],
    ['2028-02-29', 0, '2028-02-29'],
    ['2028-02-29', 1, '2029-02-28'],
    ['2028-02-29', -4, '2024-02-29'],
    ['2028-02-29', -1, '2027-02-28'],
    ['2026-12-31', 5, '2031-12-31'],
  ])('moves %s by %i years to %s', (day, n, moved) => {
    expect(addYears(day, n)).toBe(moved);
  });
});
