import { documentLabel } from './document-refused';
import { TEMPLATES } from './registry';
import { bellLink } from '../bell/bell.link';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'DOCUMENT_REFUSED';
const LANGUAGES = ['ro', 'en'] as const;
const dashboard = 'https://motorfix.test/app/garage';
const note = 'Pagina a doua nu se citește';

const paramsOf = (language: 'ro' | 'en', given = note) => ({
  dashboard,
  document: documentLabel('rar_authorisation', language),
  note: given,
});

// @traces 068-FR-010
describe('the notice that a yearly document was refused', () => {
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

  it('takes the document, the note and the dashboard link, and nothing personal', () => {
    expect(TEMPLATES[KIND]?.values).toEqual({
      dashboard: 'link',
      document: 'text',
      note: 'text',
    });
  });

  it.each([
    [
      'onrc_certificate',
      'Certificatul constatator ONRC',
      'ONRC company certificate',
    ],
    ['rar_authorisation', 'Autorizația RAR', 'RAR authorisation'],
  ] as const)('names %s in both languages', (kind, ro, en) => {
    expect(documentLabel(kind, 'ro')).toBe(ro);
    expect(documentLabel(kind, 'en')).toBe(en);
  });

  it('says in Romanian which document was refused, with the note', () => {
    const mail = render(KIND, 'email', 'ro', paramsOf('ro'));

    expect(mail.subject).toBe('Documentele au fost refuzate');
    expect(mail.text).toContain('Document refuzat: Autorizația RAR');
    expect(mail.text).toContain(`Nota echipei MotorFix: ${note}`);
    expect(bellText(KIND, 'ro', paramsOf('ro'))).toBe(
      `Document refuzat: Autorizația RAR. ${note}`,
    );
  });

  it('says the same in English', () => {
    const mail = render(KIND, 'email', 'en', paramsOf('en'));

    expect(mail.subject).toBe('Your documents were refused');
    expect(mail.text).toContain('Document refused: RAR authorisation');
    expect(mail.text).toContain(`The MotorFix team’s note: ${note}`);
    expect(bellText(KIND, 'en', paramsOf('en'))).toBe(
      `Document refused: RAR authorisation. ${note}`,
    );
  });

  it('shows a note with markup as plain text', () => {
    const mail = render(
      KIND,
      'email',
      'ro',
      paramsOf('ro', '<script>alert(1)</script> pagina'),
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it.each(LANGUAGES)(
    'opens the dashboard from the e-mail button and the push in %s, the push within its length with the longest note',
    (language) => {
      const params = paramsOf(language, 'x'.repeat(500));
      expect(render(KIND, 'email', language, params).html).toContain(
        `href="${dashboard}"`,
      );
      expect(render(KIND, 'push', language, params)).toMatchObject({
        link: dashboard,
      });
    },
  );

  it('opens the garage dashboard, where the legal panel is, from the bell', () => {
    expect(
      bellLink({ kind: KIND, params: paramsOf('ro'), subjectId: null }),
    ).toBe('/app/garage');
  });
});
