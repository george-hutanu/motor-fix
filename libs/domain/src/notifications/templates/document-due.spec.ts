import { TEMPLATES } from './registry';
import { bellLink } from '../bell/bell.link';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'DOCUMENT_DUE';
const LANGUAGES = ['ro', 'en'] as const;
const dashboard = 'https://motorfix.test/app/garage';
const params = { dashboard, dueOn: '2027-01-15' };

const LINE = {
  en: 'Upload your yearly documents again by 15 Jan 2027',
  ro: 'Reîncarcă documentele anuale până pe 15 ian. 2027',
};

// @traces 068-FR-004
describe('the reminder that the yearly documents are due', () => {
  it('has e-mail, push and bell texts in both languages, no SMS or WhatsApp, and passes the template check', () => {
    const template = TEMPLATES[KIND];
    expect(template?.audience).toBe('garage');
    for (const channel of ['email', 'push', 'bell'] as const) {
      expect(Object.keys(template?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
    expect(template?.sms).toBeUndefined();
    expect(template?.whatsapp).toBeUndefined();
    expect(checkTemplates({ [KIND]: template })).toEqual([]);
  });

  it('takes the due date and the dashboard link, and nothing personal', () => {
    expect(TEMPLATES[KIND]?.values).toEqual({
      dashboard: 'link',
      dueOn: 'day',
    });
  });

  it.each(LANGUAGES)(
    'names the due date in the e-mail, the bell and the push in %s',
    (language) => {
      const mail = render(KIND, 'email', language, params);
      expect(mail.subject).toBe(LINE[language]);
      expect(mail.html).toContain(`href="${dashboard}"`);
      expect(bellText(KIND, language, params)).toBe(LINE[language]);
      const push = render(KIND, 'push', language, params);
      expect(push.body).toContain(LINE[language]);
      expect(push.link).toBe(dashboard);
    },
  );

  it('opens the garage dashboard, where the legal panel is, from the bell', () => {
    expect(bellLink({ kind: KIND, params, subjectId: null })).toBe(
      '/app/garage',
    );
  });
});
