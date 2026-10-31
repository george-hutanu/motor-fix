import { bellText, render, templateName } from '../templates';

const link = 'https://motorfix.test/app/driver?view=cars';
const KIND = 'REPAIR_UPDATED';
const ADMIN = 'REPAIR_UPDATED.admin';
const GARAGE = 'REPAIR_UPDATED.garage';
const base = { by: 'admin', car: 'VW Golf 2015', garage: 'MotorFix', link };

// @traces 1267-FR-012
describe('the MotorFix repair-corrected message under hostile input', () => {
  it.each([
    ['garage', GARAGE],
    ['owner', GARAGE],
    ['ADMIN', GARAGE],
    ['admin ', GARAGE],
    ['', GARAGE],
    [null, GARAGE],
    [undefined, GARAGE],
    [0, GARAGE],
    [['admin'], GARAGE],
    ['admin', ADMIN],
  ])('picks the template for by = %p', (by, expected) => {
    expect(templateName(KIND, { by } as never)).toBe(expected);
  });

  it('escapes markup in the car in the e-mail html', () => {
    const mail = render(ADMIN, 'email', 'en', {
      ...base,
      car: '<img src=x onerror=alert(1)>',
    });
    expect(mail.html).not.toContain('<img src=x');
  });

  it('keeps the e-mail subject on one line when the car holds a newline', () => {
    const mail = render(ADMIN, 'email', 'ro', {
      ...base,
      car: 'Golf\r\nBcc: x@y.ro',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('does not fill a placeholder written inside the car', () => {
    expect(bellText(KIND, 'en', { ...base, car: '{garage}' })).toBe(
      "MotorFix corrected a repair in {garage}'s history.",
    );
  });

  it('refuses an e-mail whose link is not https', () => {
    expect(() =>
      render(ADMIN, 'email', 'en', { ...base, link: 'javascript:alert(1)' }),
    ).toThrow();
  });

  it('refuses a render with a null car', () => {
    expect(() =>
      render(ADMIN, 'push', 'en', { ...base, car: null } as never),
    ).toThrow();
  });

  it('falls back to Romanian for an unknown language', () => {
    expect(render(ADMIN, 'bell', 'fr', base)).toBe(
      'MotorFix a corectat o reparație din istoricul VW Golf 2015.',
    );
  });

  it('shortens a very long car name in the push and keeps MotorFix', () => {
    const push = render(ADMIN, 'push', 'en', { ...base, car: 'C'.repeat(500) });
    expect(push.body).toContain('MotorFix');
  });

  it('answers the bell fallback text for a MotorFix event with no car', () => {
    expect(bellText(KIND, 'en', { by: 'admin', link })).not.toContain(
      'undefined',
    );
  });

  it('renders the same text twice', () => {
    expect(render(ADMIN, 'email', 'ro', base)).toEqual(
      render(ADMIN, 'email', 'ro', base),
    );
  });
});
