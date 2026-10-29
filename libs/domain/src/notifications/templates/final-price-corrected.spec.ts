import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'FINAL_PRICE_CORRECTED';
const link = 'https://motorfix.test/app/driver/requests/r-1';
const params = (price: number) => ({ garage: 'Garaj Nordic', link, price });

// @traces 406-FR-007 406-FR-011
describe('the corrected final price message to the driver', () => {
  it('is registered for the driver and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('has e-mail, push, WhatsApp and bell texts in both languages', () => {
    for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
      expect(Object.keys(TEMPLATES[KIND]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('names the garage and the new price in the bell', () => {
    expect(render(KIND, 'bell', 'ro', params(115_000))).toBe(
      'Garaj Nordic a corectat prețul final: 1.150 lei.',
    );
    expect(render(KIND, 'bell', 'en', params(115_000))).toBe(
      'Garaj Nordic corrected the final price: 1,150 lei',
    );
  });

  it('writes bani as lei with the decimals of each language', () => {
    expect(render(KIND, 'bell', 'ro', params(125_050))).toContain(
      '1.250,50 lei',
    );
    expect(render(KIND, 'bell', 'en', params(125_050))).toContain(
      '1,250.50 lei',
    );
  });

  it('opens the driver’s requests from the push and the e-mail', () => {
    const push = render(KIND, 'push', 'ro', params(115_000));
    expect(push.link).toBe(link);
    expect(push.body).toContain('1.150 lei');
    const email = render(KIND, 'email', 'en', params(115_000));
    expect(email.subject).toContain('Garaj Nordic');
    expect(email.html).toContain(link);
  });
});
