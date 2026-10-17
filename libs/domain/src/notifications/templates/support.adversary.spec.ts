import {
  SUPPORT_ACKNOWLEDGEMENT,
  SUPPORT_MESSAGE,
  supportMessageValues,
} from './support';
import { render } from '../templates';

// @traces 280-FR-015 280-FR-019
const BREAKS = /[\p{Cc}\u2028\u2029]/u;
const contact = 'https://motorfix.test/ro/contact';
const row = {
  email: 'ana@example.test',
  language: 'en',
  message: 'I cannot see the request I sent yesterday.',
  name: 'Ana Pop',
  reference: 'MF-2026-000042',
  role: 'driver',
  subjectRef: 'req-42',
  topic: 'account',
};
const mail = (over: Partial<typeof row> = {}, language = 'ro') =>
  render('SUPPORT_MESSAGE', 'email', language, {
    ...supportMessageValues({ ...row, ...over }),
    contact,
  });

describe('the support e-mail under hostile input', () => {
  it.each([
    ['a tab', 'Ana\tPop'],
    ['a vertical tab and form feed', 'Ana\u000b\u000cPop'],
    ['a next-line character', 'Ana\u0085Pop'],
    ['a null byte', 'Ana\u0000Pop'],
    ['a paragraph separator', 'Ana\u2029Pop'],
    ['a carriage return alone', 'Ana\rPop'],
    ['many breaks in a row', 'Ana\n\n\n\r\n\nPop'],
  ])('keeps the subject on one line when the name holds %s', (_, name) => {
    const { subject } = mail({ name });
    expect(subject).toBe('[MF-2026-000042] Contul meu: Ana Pop');
  });

  it('keeps the subject on one line when the name is only breaks', () => {
    const { subject } = mail({ name: '\r\n\r\n' });
    expect(subject).not.toMatch(BREAKS);
    expect(subject.startsWith('[MF-2026-000042] Contul meu:')).toBe(true);
  });

  it('keeps the subject on one line when an 80 character name is full of breaks', () => {
    const { subject } = mail({ name: 'a\n'.repeat(40) });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('keeps unicode names whole', () => {
    expect(mail({ name: 'Ștefan Țurcanu 😀' }).subject).toBe(
      '[MF-2026-000042] Contul meu: Ștefan Țurcanu 😀',
    );
  });

  it('does not expand a placeholder typed into the message or the name', () => {
    const out = mail({
      message: 'see {reference} and {promise} and {contact}',
      name: '{reference}',
    });
    expect(out.text).toContain('see {reference} and {promise} and {contact}');
    expect(out.subject).toBe('[MF-2026-000042] Contul meu: {reference}');
  });

  it('escapes quotes and ampersands in every sender field in the HTML', () => {
    const out = mail({
      email: '"><script>x</script>@example.test',
      message: '"><script>alert(1)</script> & more text here',
      name: '"><script>alert(2)</script>',
      subjectRef: '<script>alert(3)</script>',
    });
    expect(out.html).not.toContain('<script');
    expect(out.html).toContain('&lt;script');
  });

  it('puts an unknown role, topic and language through as given rather than throwing', () => {
    const out = mail({ language: 'xx', role: 'owner', topic: 'refund' });
    expect(out.subject).toBe('[MF-2026-000042] refund: Ana Pop');
    expect(out.text).toContain('owner');
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'does not read the inherited %s as a topic, role or language',
    (key) => {
      const values = supportMessageValues({
        ...row,
        language: key,
        role: key,
        topic: key,
      });
      expect(values.topic).toBe(key);
      expect(values.role).toBe(key);
      expect(values.language).toBe(key);
    },
  );

  it('shows a dash for a subject reference of only breaks', () => {
    expect(
      supportMessageValues({ ...row, subjectRef: '\n\n' }).subjectRef,
    ).toBe('—');
  });

  it('shows a dash for an empty subject reference', () => {
    expect(supportMessageValues({ ...row, subjectRef: '' }).subjectRef).toBe(
      '—',
    );
  });

  it('keeps the message of 2000 characters whole', () => {
    const message = `${'x'.repeat(1999)}y`;
    expect(mail({ message }).text).toContain(message);
  });

  it('is the same in Romanian when the e-mail is rendered for an English caller', () => {
    expect(mail({}, 'en').subject).toBe(mail({}, 'ro').subject);
  });
});

describe('the acknowledgement under hostile input', () => {
  const values = {
    contact,
    message: '<img src=x onerror=alert(1)> {promise} a long enough text',
    promise: 'We answer within one working day.',
    reference: 'MF-2026-000042',
  };

  it('escapes the copy of the message in the HTML', () => {
    const out = render('SUPPORT_ACKNOWLEDGEMENT', 'email', 'en', values);
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;img');
  });

  it('keeps a placeholder typed in the message literal', () => {
    const out = render('SUPPORT_ACKNOWLEDGEMENT', 'email', 'en', values);
    expect(out.text).toContain('{promise} a long enough text');
  });

  it('keeps the subject to the reference alone, in each language', () => {
    expect(
      render('SUPPORT_ACKNOWLEDGEMENT', 'email', 'en', values).subject,
    ).toBe('We have your message (MF-2026-000042)');
    expect(
      render('SUPPORT_ACKNOWLEDGEMENT', 'email', 'ro', values).subject,
    ).toBe('Am primit mesajul tău (MF-2026-000042)');
  });

  it('refuses a missing promise rather than sending an empty line', () => {
    const { promise: _, ...without } = values;
    expect(() =>
      render('SUPPORT_ACKNOWLEDGEMENT', 'email', 'en', without),
    ).toThrow();
  });

  it('holds no address of its own in either template', () => {
    expect(
      JSON.stringify([SUPPORT_MESSAGE.email, SUPPORT_ACKNOWLEDGEMENT.email]),
    ).not.toMatch(/@/);
  });
});
