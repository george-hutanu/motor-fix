import { DECLINE_REASON_CODES } from '@motor-fix/contracts';

import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'REQUEST_DECLINED';
const link = 'https://motorfix.test/app/driver/requests/r-1';
const params = (reason: string) => ({
  app: 'https://motorfix.test',
  garage: 'Atelier Dinamo',
  link,
  reason,
});

const CLAUSES = {
  en: {
    fully_booked: 'it is fully booked',
    job_not_done: 'it does not do this job',
    make_model_engine_not_done:
      'it does not work on this make, model or engine',
    need_to_see_car: 'it needs to see the car first',
  },
  ro: {
    fully_booked: 'este ocupat complet',
    job_not_done: 'nu face această lucrare',
    make_model_engine_not_done: 'nu lucrează pe această marcă, model sau motor',
    need_to_see_car: 'trebuie să vadă mașina mai întâi',
  },
} as const;

// @traces 345-decline-request-FR-009
// @traces 345-decline-request-FR-010
describe('the declined request message to the driver', () => {
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

  it('stays an event on e-mail, push and WhatsApp in the offers group', () => {
    expect(NOTIFICATION_TYPES[KIND]).toMatchObject({
      channels: ['email', 'push', 'whatsapp'],
      group: 'offers',
    });
  });

  it.each(DECLINE_REASON_CODES.map((code) => [code]))(
    'says why for %s, in Romanian and English, on every channel',
    (code) => {
      const ro = `Atelier Dinamo nu poate prelua cererea: ${CLAUSES.ro[code]}.`;
      const en = `Atelier Dinamo cannot take your request: ${CLAUSES.en[code]}.`;

      expect(render(KIND, 'push', 'ro', params(code)).body).toBe(ro);
      expect(render(KIND, 'push', 'en', params(code)).body).toBe(en);
      expect(render(KIND, 'bell', 'ro', params(code))).toBe(ro);
      expect(render(KIND, 'bell', 'en', params(code))).toBe(en);
      expect(render(KIND, 'email', 'ro', params(code)).text).toContain(ro);
      expect(render(KIND, 'email', 'en', params(code)).text).toContain(en);
      expect(render(KIND, 'whatsapp', 'ro', params(code))).toEqual({
        name: 'motorfix_request_declined_ro',
        params: ['Atelier Dinamo', CLAUSES.ro[code]],
      });
      expect(render(KIND, 'whatsapp', 'en', params(code))).toEqual({
        name: 'motorfix_request_declined_en',
        params: ['Atelier Dinamo', CLAUSES.en[code]],
      });
    },
  );

  it.each([
    ['ro', 'Un service a refuzat cererea ta'],
    ['en', 'A garage declined your request'],
  ])(
    'sends an e-mail in %s titled "%s" whose button opens the driver’s request',
    (language, subject) => {
      const mail = render(KIND, 'email', language, params('fully_booked'));

      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(link);
      expect(render(KIND, 'push', language, params('fully_booked')).link).toBe(
        link,
      );
    },
  );

  it('takes the garage, the reason and the link only', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'garage',
      'link',
      'reason',
    ]);
  });

  it('refuses a reason that is not one of the four', () => {
    expect(() => render(KIND, 'push', 'ro', params('too_far'))).toThrow(
      /reason/,
    );
  });
});
