import { nextStep } from './garage-suspended';
import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'GARAGE_SUSPENDED';
const LANGUAGES = ['ro', 'en'] as const;
const link = 'https://motorfix.test/app/garage';
const reason = 'Autorizație RAR expirată pe 12 sept. 2026';

const paramsOf = (language: 'ro' | 'en', cause = 'recheck_failed') => ({
  garage: 'Atelier Dinamo',
  link,
  next: nextStep(cause, language),
  reason,
});

// @traces 049-FR-011
describe('the suspension message to garage owners', () => {
  it('is always sent by e-mail, push and WhatsApp and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
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

  it('takes the garage, the reason, the next step and the link, and nothing personal', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'garage',
      'link',
      'next',
      'reason',
    ]);
  });

  it('says in Romanian the profile is off the map until it is fixed, with the reason and the next step', () => {
    const mail = render(KIND, 'email', 'ro', paramsOf('ro'));

    expect(mail.subject).toBe('Profilul Atelier Dinamo a fost suspendat');
    expect(mail.text).toContain('nu apare pe hartă până se rezolvă');
    expect(mail.text).toContain(`Motiv: ${reason}`);
    expect(mail.text).toContain(
      'Ce urmează: încarcă autorizația RAR reînnoită.',
    );
    expect(mail.text).toContain(link);
  });

  it('says the same in English', () => {
    const mail = render(KIND, 'email', 'en', paramsOf('en'));

    expect(mail.subject).toBe('The Atelier Dinamo profile was suspended');
    expect(mail.text).toContain('off the map until this is fixed');
    expect(mail.text).toContain(`Reason: ${reason}`);
    expect(mail.text).toContain(
      'What next: upload the renewed RAR authorisation.',
    );
  });

  it.each([
    [
      'recheck_failed',
      'încarcă autorizația RAR reînnoită',
      'upload the renewed RAR authorisation',
    ],
    [
      'documents_overdue',
      'încarcă documentele anuale',
      'upload the yearly documents',
    ],
    ['admin', 'răspunde echipei MotorFix', 'answer the MotorFix team'],
    [
      'report_confirmed',
      'răspunde echipei MotorFix',
      'answer the MotorFix team',
    ],
  ])('names the next step for %s', (cause, ro, en) => {
    expect(nextStep(cause, 'ro')).toBe(`${ro}.`);
    expect(nextStep(cause, 'en')).toBe(`${en}.`);
  });

  it('shows a reason with markup as plain text', () => {
    const mail = render(KIND, 'email', 'ro', {
      ...paramsOf('ro'),
      reason: '<script>alert(1)</script> autorizație',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it.each(LANGUAGES)(
    'opens the garage dashboard from the e-mail button and the push in %s',
    (language) => {
      const mail = render(KIND, 'email', language, paramsOf(language));
      expect(mail.html).toContain(`href="${link}"`);
      expect(render(KIND, 'push', language, paramsOf(language))).toMatchObject({
        link,
      });
    },
  );

  it.each(LANGUAGES)(
    'puts the reason in the bell and the WhatsApp in %s',
    (language) => {
      expect(bellText(KIND, language, paramsOf(language))).toContain(reason);
      expect(render(KIND, 'whatsapp', language, paramsOf(language))).toEqual({
        name: `motorfix_garage_suspended_${language}`,
        params: [reason],
      });
    },
  );
});
