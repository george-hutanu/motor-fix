import { TEMPLATES } from './registry';
import { bellLink } from '../bell/bell.link';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'DOCUMENT_OVERDUE';
const LANGUAGES = ['ro', 'en'] as const;
const dashboard = 'https://motorfix.test/app/garage';
// Due on 15 January, grace until the 29th: suspended on the 30th.
const params = { dashboard, dueOn: '2027-01-15', suspendOn: '2027-01-30' };

const LINE = {
  en: 'Your yearly documents were due on 15 Jan 2027: upload them, otherwise the profile will be suspended on 30 Jan 2027',
  ro: 'Documentele anuale erau de reîncărcat până pe 15 ian. 2027: încarcă-le, altfel profilul va fi suspendat pe 30 ian. 2027',
};

// @traces 068-FR-004
describe('the notice that the yearly documents are overdue', () => {
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

  it('takes the due date, the suspension day and the dashboard link, and nothing personal', () => {
    expect(TEMPLATES[KIND]?.values).toEqual({
      dashboard: 'link',
      dueOn: 'day',
      suspendOn: 'day',
    });
  });

  it.each(LANGUAGES)(
    'names the due date and the suspension day in the e-mail and the bell in %s',
    (language) => {
      const mail = render(KIND, 'email', language, params);
      expect(mail.text).toContain(LINE[language]);
      expect(mail.html).toContain(`href="${dashboard}"`);
      expect(bellText(KIND, language, params)).toBe(LINE[language]);
    },
  );

  it.each([
    ['ro', 'suspendat pe 30 ian. 2027'],
    ['en', 'suspended on 30 Jan 2027'],
  ] as const)('names the suspension day in the %s push', (language, text) => {
    const push = render(KIND, 'push', language, params);
    expect(push.body).toContain(text);
    expect(push.link).toBe(dashboard);
  });

  it('opens the garage dashboard, where the legal panel is, from the bell', () => {
    expect(bellLink({ kind: KIND, params, subjectId: null })).toBe(
      '/app/garage',
    );
  });
});
