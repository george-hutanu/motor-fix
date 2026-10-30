import { render } from '../templates';

const link = 'https://motorfix.test/app/driver?view=cars';
const KIND = 'REPAIR_UPDATED.garage';

// @traces 409-FR-014
describe('the repair-corrected message under hostile names', () => {
  it('escapes markup in the garage name in the e-mail html', () => {
    const mail = render(KIND, 'email', 'en', {
      car: 'VW Golf 2015',
      garage: '<script>alert(1)</script>',
      link,
    });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
  });

  it('does not fill a placeholder written inside the garage name', () => {
    const bell = render(KIND, 'bell', 'en', {
      car: 'VW Golf 2015',
      garage: '{car}',
      link,
    });
    expect(bell).toBe("{car} corrected a repair in VW Golf 2015's history.");
  });

  it('keeps the e-mail subject on one line when the garage name holds a newline', () => {
    const mail = render(KIND, 'email', 'ro', {
      car: 'VW Golf 2015',
      garage: 'Garaj\r\nBcc: x@y.ro',
      link,
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('refuses a render without the garage', () => {
    expect(() =>
      render(KIND, 'bell', 'en', { car: 'VW Golf', link }),
    ).toThrow();
  });

  it('refuses a render with a null car', () => {
    expect(() =>
      render(KIND, 'push', 'en', { car: null, garage: 'Garaj', link } as never),
    ).toThrow();
  });

  it('refuses an e-mail whose link is not https', () => {
    expect(() =>
      render(KIND, 'email', 'en', {
        car: 'VW Golf',
        garage: 'Garaj',
        link: 'javascript:alert(1)',
      }),
    ).toThrow();
  });

  it('falls back to Romanian for an unknown language', () => {
    expect(
      render(KIND, 'bell', 'fr', {
        car: 'VW Golf 2015',
        garage: 'Garaj Nordic',
        link,
      }),
    ).toBe('Garaj Nordic a corectat o reparație din istoricul VW Golf 2015.');
  });

  it('carries unicode in the garage name through WhatsApp unchanged', () => {
    expect(
      render(KIND, 'whatsapp', 'ro', {
        car: 'Dacia Sandero',
        garage: 'Șmecherul Ţară 🔧',
        link,
      }),
    ).toEqual({
      name: 'motorfix_repair_updated_ro',
      params: ['Șmecherul Ţară 🔧', 'Dacia Sandero'],
    });
  });

  it('renders the same text twice', () => {
    const params = { car: 'VW Golf 2015', garage: 'Garaj Nordic', link };
    expect(render(KIND, 'push', 'en', params)).toEqual(
      render(KIND, 'push', 'en', params),
    );
  });

  it('shortens a very long car name in the push without dropping the garage', () => {
    const push = render(KIND, 'push', 'en', {
      car: 'C'.repeat(500),
      garage: 'Garaj Nordic',
      link,
    });
    expect(push.body).toContain('Garaj Nordic');
  });
});
