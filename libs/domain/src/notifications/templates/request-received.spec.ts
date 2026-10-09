import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'REQUEST_RECEIVED';
const link = 'https://motorfix.test/app/garage/requests';
const params = {
  app: 'https://motorfix.test',
  car: 'Dacia Logan',
  job: 'Schimb ulei',
  link,
};

// @traces 343-live-quote-requests-FR-013
describe('the new request message to garage staff', () => {
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

  it('stays urgent in the catalogue, on e-mail, push and WhatsApp only', () => {
    expect(NOTIFICATION_TYPES[KIND].urgent).toBe(true);
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('reads "Cerere nouă: {car} · {job}" in the push and the bell', () => {
    const push = render(KIND, 'push', 'ro', params);

    expect(push.body).toBe('Cerere nouă: Dacia Logan · Schimb ulei');
    expect(push.link).toBe(link);
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Cerere nouă: Dacia Logan · Schimb ulei',
    );
  });

  it('reads the same line in English', () => {
    const english = { ...params, job: 'Oil change' };

    expect(render(KIND, 'push', 'en', english).body).toBe(
      'New request: Dacia Logan · Oil change',
    );
    expect(render(KIND, 'bell', 'en', english)).toBe(
      'New request: Dacia Logan · Oil change',
    );
  });

  it.each(['ro', 'en'])(
    'sends an e-mail in %s whose button opens the requests view',
    (language) => {
      const mail = render(KIND, 'email', language, params);

      expect(mail.subject).toContain('Dacia Logan');
      expect(mail.text).toContain('Schimb ulei');
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(link);
    },
  );

  it.each(['ro', 'en'])(
    'names the approved WhatsApp template in %s, with the car and the job',
    (language) => {
      expect(render(KIND, 'whatsapp', language, params)).toEqual({
        name: `motorfix_request_received_${language}`,
        params: ['Dacia Logan', 'Schimb ulei'],
      });
    },
  );

  it('takes no plate, phone or description', () => {
    const values = Object.keys(TEMPLATES[KIND]?.values ?? {}).sort();

    expect(values).toEqual(['car', 'job', 'link']);
  });
});
