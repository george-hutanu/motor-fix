import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'QUOTE_ACCEPTED';
const link = 'https://motorfix.test/app/garage/requests';
// 09:00 in Bucharest.
const params = {
  app: 'https://motorfix.test',
  car: 'Dacia Logan',
  driver: 'Andrei M.',
  link,
  slot: '2026-10-16T06:00:00.000Z',
};

// @traces 222-FR-010
// @traces 222-FR-013
describe('the accepted quote message to garage staff', () => {
  it('is registered for the garage and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('garage');
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

  it('stays an event on e-mail, push and WhatsApp in the catalogue', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('names the driver, the car and the slot in Bucharest time in the bell', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Andrei M. a acceptat oferta ta · Dacia Logan · 16 oct. 2026, 09:00',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Andrei M. accepted your quote · Dacia Logan · 16 Oct 2026, 09:00',
    );
  });

  it('titles the push Ofertă acceptată, with the same line, opening Oferte trimise', () => {
    const ro = render(KIND, 'push', 'ro', params);
    const en = render(KIND, 'push', 'en', params);

    expect(ro.title).toBe('Ofertă acceptată');
    expect(ro.body).toBe('Andrei M. · Dacia Logan · 16 oct. 2026, 09:00');
    expect(ro.link).toBe(link);
    expect(en.title).toBe('Quote accepted');
    expect(en.body).toBe('Andrei M. · Dacia Logan · 16 Oct 2026, 09:00');
  });

  it('writes the e-mail with the car in the subject and the wait for confirmation in the body', () => {
    const ro = render(KIND, 'email', 'ro', params);
    const en = render(KIND, 'email', 'en', params);

    expect(ro.subject).toBe('Ofertă acceptată: Dacia Logan');
    expect(en.subject).toBe('Quote accepted: Dacia Logan');
    for (const [mail, waits] of [
      [ro, 'așteaptă confirmarea ta'],
      [en, 'waits for your confirmation'],
    ] as const) {
      expect(mail.text).toContain('Andrei M.');
      expect(mail.text).toContain('Dacia Logan');
      expect(mail.text).toContain('09:00');
      expect(mail.text).toContain(waits);
      expect(mail.html).toContain(link);
    }
  });
});
