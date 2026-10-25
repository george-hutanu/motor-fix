import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'REQUEST_REMINDER';
const link = 'https://motorfix.test/app/garage/requests';
const params = {
  app: 'https://motorfix.test',
  car: 'Dacia Logan',
  driver: 'Andrei M.',
  link,
};

// @traces 1257-FR-002 1257-FR-003 1257-FR-009
describe('the reminder of a request still waiting for the garage', () => {
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

  it('waits for the morning in quiet hours, on e-mail, push and WhatsApp', () => {
    expect(NOTIFICATION_TYPES[KIND].urgent).toBe(false);
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('names the driver and the car in the bell and the push', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Cererea lui Andrei M. așteaptă răspuns: Dacia Logan',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Andrei M.’s request is still waiting: Dacia Logan',
    );
    const push = render(KIND, 'push', 'ro', params);
    expect(push.body).toBe('Andrei M. · Dacia Logan');
    expect(push.link).toBe(link);
  });

  it.each(['ro', 'en'])(
    'sends an e-mail in %s whose button opens the requests view',
    (language) => {
      const mail = render(KIND, 'email', language, params);

      expect(mail.subject).toContain('Dacia Logan');
      expect(mail.text).toContain('Andrei M.');
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(link);
    },
  );

  it.each(['ro', 'en'])(
    'names the WhatsApp template in %s, with the driver and the car',
    (language) => {
      expect(render(KIND, 'whatsapp', language, params)).toEqual({
        name: `motorfix_request_reminder_${language}`,
        params: ['Andrei M.', 'Dacia Logan'],
      });
    },
  );

  it('takes no plate, phone or description', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'car',
      'driver',
      'link',
    ]);
  });
});
