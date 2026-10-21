import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'QUOTE_DECLINED_BY_DRIVER';
const link = 'https://motorfix.test/app/garage/requests';
const params = {
  app: 'https://motorfix.test',
  car: 'Dacia Logan',
  driverShortName: 'Andrei M.',
  link,
};

// @traces 314-FR-014
describe('the declined quote message to garage staff', () => {
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

  it('goes by e-mail, push and WhatsApp, never SMS, as an event', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('says who declined, in the bell', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Andrei M. a refuzat oferta ta · Dacia Logan',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Andrei M. declined your quote · Dacia Logan',
    );
  });

  it('says it in the push and the e-mail, opening Oferte trimise', () => {
    const push = render(KIND, 'push', 'ro', params);
    const mail = render(KIND, 'email', 'en', params);

    expect(push.title).toBe('Ofertă refuzată');
    expect(push.body).toBe('Andrei M. a refuzat oferta ta.');
    expect(push.link).toBe(link);
    expect(mail.subject).toBe('Quote declined: Dacia Logan');
    expect(mail.text).toContain('Andrei M. declined your quote.');
    expect(mail.html).toContain(link);
  });
});
