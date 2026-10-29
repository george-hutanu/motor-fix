import { bellText, render } from '../templates';

const KIND = 'CAR_TRANSFER_ACCEPTED';
const link = 'https://motorfix.test/app/driver?view=cars';

// @traces 1265-FR-009
describe('the car-taken-over message on hostile input', () => {
  it('escapes markup in the car name in the e-mail html', () => {
    const mail = render(KIND, 'email', 'en', {
      car: '<script>alert(1)</script> Golf',
      link,
    });

    expect(mail.html).not.toContain('<script>alert(1)</script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/app/driver', ''])(
    'refuses the e-mail link %j',
    (bad) => {
      expect(() =>
        render(KIND, 'email', 'ro', { car: 'VW Golf', link: bad }),
      ).toThrow();
    },
  );

  it('falls back to the generic bell text when the car is missing or null', () => {
    const generic = bellText('NO_SUCH_KIND', 'en', {});

    expect(bellText(KIND, 'en', { link })).toBe(generic);
    expect(bellText(KIND, 'en', { car: null, link })).toBe(generic);
  });

  it('keeps unicode in the car name intact on WhatsApp and the bell', () => {
    const car = 'Škoda Fabia — ăâîșț 🚗';

    expect(render(KIND, 'whatsapp', 'ro', { car, link }).params).toEqual([car]);
    expect(bellText(KIND, 'ro', { car, link })).toContain(car);
  });

  it('reads an unknown language as Romanian', () => {
    expect(bellText(KIND, 'fr', { car: 'VW Golf', link })).toBe(
      bellText(KIND, 'ro', { car: 'VW Golf', link }),
    );
  });

  it('ignores a buyer name smuggled into the params', () => {
    const text = bellText(KIND, 'en', {
      buyer: 'Victor Secret',
      car: 'VW Golf',
      link,
    });

    expect(text).not.toContain('Victor');
  });

  it('keeps the push body within 120 characters for a long Romanian car name', () => {
    const push = render(KIND, 'push', 'ro', { car: 'A'.repeat(60), link });

    expect(push.body.length).toBeLessThanOrEqual(120);
  });
});
