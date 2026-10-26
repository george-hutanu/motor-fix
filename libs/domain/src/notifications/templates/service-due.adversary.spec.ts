// @traces 091-FR-012 091-FR-016
import { bellText, render } from '../templates';

const CARS = 'https://motorfix.test/app/driver/cars';
const params = { car: 'BMW 320d', cars: CARS, dueOn: '2027-01-01', left: 30 };

describe('the oil service texts against awkward values', () => {
  it.each([
    [2, 'peste 2 zile.'],
    [19, 'peste 19 zile.'],
    [20, 'peste 20 de zile.'],
    [21, 'peste 21 de zile.'],
    [100, 'peste 100 de zile.'],
    [111, 'peste 111 zile.'],
    [120, 'peste 120 de zile.'],
  ])('counts %p days left in Romanian', (left, ending) => {
    expect(bellText('SERVICE_DUE', 'ro', { ...params, left })).toMatch(
      new RegExp(`${ending.replace('.', '\\.')}$`),
    );
  });

  it('writes the day of 29 February in Romanian and English', () => {
    expect(
      bellText('SERVICE_DUE', 'ro', {
        ...params,
        dueOn: '2028-02-29',
        left: 7,
      }),
    ).toBe(
      'Schimbul de ulei la BMW 320d este estimat pe 29 februarie 2028, peste 7 zile.',
    );
    expect(
      bellText('SERVICE_DUE', 'en', {
        ...params,
        dueOn: '2028-02-29',
        left: 7,
      }),
    ).toBe(
      'The oil service on your BMW 320d is estimated for 29 February 2028, in 7 days.',
    );
  });

  it('keeps a car name with unicode and an ampersand whole in the bell', () => {
    expect(
      bellText('SERVICE_DUE', 'en', { ...params, car: 'Škoda Octavia & Co' }),
    ).toBe(
      'The oil service on your Škoda Octavia & Co is estimated for 1 January 2027, in 30 days.',
    );
  });

  it('does not let a car name inject markup into the e-mail html', () => {
    const mail = render('SERVICE_DUE', 'email', 'en', {
      ...params,
      car: '<script>alert(1)</script>',
    }) as { html?: string; text: string };
    if (mail.html !== undefined) {
      expect(mail.html).not.toContain('<script>');
    }
    expect(mail.text).toContain('<script>alert(1)</script>');
  });

  it('keeps the SMS within 70 characters whatever the car is called', () => {
    for (const language of ['ro', 'en']) {
      const sms = render('SERVICE_DUE', 'sms', language, {
        ...params,
        car: 'X'.repeat(500),
      }) as string;
      expect(sms.length).toBeLessThanOrEqual(70);
    }
  });

  it('shows no plate in the push or the WhatsApp parameters', () => {
    const withPlate = { ...params, plate: 'B123ABC' };
    expect(
      JSON.stringify(render('SERVICE_DUE', 'push', 'ro', withPlate)),
    ).not.toContain('B123ABC');
    expect(
      JSON.stringify(render('SERVICE_DUE', 'whatsapp', 'en', withPlate)),
    ).not.toContain('B123ABC');
  });

  it('sends the generic e-mail when the days left are missing', () => {
    const { left: _left, ...noDays } = params;
    expect(
      render('SERVICE_DUE', 'email', 'en', {
        ...noDays,
        app: 'https://motorfix.test',
      }),
    ).toEqual(
      render('GENERIC', 'email', 'en', { app: 'https://motorfix.test' }),
    );
  });

  it('never writes "NaN" or "undefined" for days left given as a non-number', () => {
    const text = bellText('SERVICE_DUE', 'en', {
      ...params,
      left: 'soon' as unknown as number,
    });
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it('writes the same sentence in the bell and the e-mail body for every language', () => {
    for (const language of ['ro', 'en']) {
      const sentence = bellText('SERVICE_DUE', language, params);
      expect(
        (render('SERVICE_DUE', 'email', language, params) as { text: string })
          .text,
      ).toContain(sentence);
    }
  });
});
