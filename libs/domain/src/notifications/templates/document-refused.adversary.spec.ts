import { documentLabel } from './document-refused';
import { bellLink } from '../bell/bell.link';
import { bellText, render, TemplateError } from '../templates';

const KIND = 'DOCUMENT_REFUSED';
const dashboard = 'https://motorfix.test/app/garage';

const params = (note: string, language = 'ro') => ({
  dashboard,
  document: documentLabel('onrc_certificate', language),
  note,
});

// @traces 068-FR-010
describe('the refusal notice under hostile notes', () => {
  const hostile = [
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    "' onmouseover='alert(1)",
    '&lt;b&gt; & &amp;',
  ];

  it.each(hostile)('shows the note %j as plain text in the e-mail', (note) => {
    for (const language of ['ro', 'en']) {
      const html = render(KIND, 'email', language, params(note, language)).html;
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onerror=alert(1)>');
      expect(html).not.toContain(`>${note}<`);
    }
  });

  it('keeps a placeholder written in the note as the note, in every channel', () => {
    const note = 'Vezi {document} și {note} și {dashboard}';
    const mail = render(KIND, 'email', 'ro', params(note));
    expect(mail.text).toContain(`Nota echipei MotorFix: ${note}`);
    expect(bellText(KIND, 'ro', params(note))).toBe(
      `Document refuzat: Certificatul constatator ONRC. ${note}`,
    );
  });

  it('keeps replacement patterns in the note verbatim', () => {
    const note = "$& $1 $` $' $$";
    expect(render(KIND, 'email', 'en', params(note, 'en')).text).toContain(
      `The MotorFix team’s note: ${note}`,
    );
    expect(bellText(KIND, 'en', params(note, 'en'))).toContain(note);
  });

  it('keeps a note with line breaks and unicode whole in the bell and the e-mail text', () => {
    const note = 'Linia 1\nLinia 2 🚗 ăîșț';
    expect(bellText(KIND, 'ro', params(note))).toContain(note);
    expect(render(KIND, 'email', 'ro', params(note)).text).toContain(note);
  });

  it('carries a 500-character note in the e-mail and the bell without cutting it', () => {
    const note = 'ș'.repeat(500);
    expect(render(KIND, 'email', 'ro', params(note)).text).toContain(note);
    expect(bellText(KIND, 'ro', params(note))).toContain(note);
  });

  it('names the document in a push that fits its 120 characters whatever the note, and points to where the note is', () => {
    const note = 'ș'.repeat(500);
    const ro = render(KIND, 'push', 'ro', params(note));
    const en = render(KIND, 'push', 'en', params(note, 'en'));
    expect(ro.body).toContain('Certificatul constatator ONRC');
    expect(ro.body).toContain('panoul service-ului');
    expect(en.body).toContain('ONRC company certificate');
    expect(en.body).toContain('garage dashboard');
    expect(ro.body.length).toBeLessThanOrEqual(120);
    expect(en.body.length).toBeLessThanOrEqual(120);
  });

  it('refuses to render without the note', () => {
    expect(() =>
      render(KIND, 'email', 'ro', { dashboard, document: 'Autorizația RAR' }),
    ).toThrow(TemplateError);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/app/garage', ''])(
    'refuses the dashboard link %j in the e-mail',
    (link) => {
      expect(() =>
        render(KIND, 'email', 'ro', { ...params('Notă'), dashboard: link }),
      ).toThrow(TemplateError);
    },
  );

  it.each(['', 'fr', 'EN', 'en-GB', '__proto__'])(
    'falls back to Romanian for the language %j',
    (language) => {
      const subject = render(KIND, 'email', language, params('Notă')).subject;
      expect(subject).toBe(
        language === 'en'
          ? 'Your documents were refused'
          : 'Documentele au fost refuzate',
      );
      expect(documentLabel('rar_authorisation', language)).toBe(
        language === 'en' ? 'RAR authorisation' : 'Autorizația RAR',
      );
    },
  );

  it.each([{}, null, undefined, { dashboard: 'javascript:alert(1)' }])(
    'opens the garage dashboard from the bell whatever the params %j',
    (given) => {
      expect(
        bellLink({ kind: KIND, params: given, subjectId: null } as never),
      ).toBe('/app/garage');
    },
  );
});
