import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'ADMIN_REVIEW_REPORTED';
const link = 'https://motorfix.test/app/admin/reviews';
const params = {
  author: 'Andrei M.',
  garage: 'Atelier Dinamo',
  link,
  reason: 'insults',
  score: 1,
};

const mail = (variant: string | undefined, language: string, extra = {}) => {
  const given = { ...params, ...extra, ...(variant && { variant }) };
  return render(templateName(KIND, given), 'email', language, given);
};

const push = (variant: string | undefined, language: string) => {
  const given = { ...params, ...(variant && { variant }) };
  return render(templateName(KIND, given), 'push', language, given);
};

// @traces 177-FR-011 177-FR-015
describe('the review report alert', () => {
  it('passes the template check in every form', () => {
    const forms = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) => name.startsWith(KIND)),
    );

    expect(Object.keys(forms).sort()).toEqual([
      KIND,
      `${KIND}.automatic`,
      `${KIND}.reminder`,
      `${KIND}.reminder_reply`,
      `${KIND}.reply`,
    ]);
    expect(checkTemplates(forms)).toEqual([]);
  });

  it.each([
    [undefined, 'ro', 'Atelier Dinamo a raportat o recenzie de 1,0: Insulte'],
    [undefined, 'en', 'Atelier Dinamo reported a 1.0 review: Insults'],
    [
      'reply',
      'ro',
      'Andrei M. a raportat răspunsul lui Atelier Dinamo: Insulte',
    ],
    ['reply', 'en', "Andrei M. reported Atelier Dinamo's reply: Insults"],
    ['automatic', 'ro', 'O recenzie de 1,0 a fost raportată automat: Insulte'],
    ['automatic', 'en', 'A 1.0 review was flagged automatically: Insults'],
  ])('words the %s form in %s', (variant, language, line) => {
    const sent = mail(variant, language);

    expect(sent.text).toContain(line);
    expect(sent.text).toContain(link);
    expect(push(variant, language).link).toBe(link);
  });

  it('names every reason in both languages', () => {
    expect(mail(undefined, 'ro', { reason: 'other' }).text).toContain(
      ': Altceva',
    );
    expect(
      mail(undefined, 'en', { reason: 'threats_or_legal_accusations' }).text,
    ).toContain(': Threats or legal accusations');
  });

  it('shows a garage or author name with markup as plain text', () => {
    const sent = mail('reply', 'ro', {
      author: '<b>Andrei</b>',
      garage: '<script>alert(1)</script>',
    });

    expect(sent.html).not.toContain('<script>');
    expect(sent.html).not.toContain('<b>');
    expect(sent.html).toContain('&lt;script&gt;');
  });
});

// @traces 177-FR-012 177-FR-015
describe('the 48-hour reminder', () => {
  it.each([
    [
      'ro',
      'O recenzie raportată așteaptă de 48 de ore.',
      'Atelier Dinamo · recenzie de 1,0',
    ],
    [
      'en',
      'A reported review has waited 48 hours.',
      'Atelier Dinamo · 1.0 review',
    ],
  ])(
    'says in %s how long it waited and which review it is',
    (language, line, title) => {
      const sent = mail('reminder', language);

      expect(sent.text).toContain(line);
      expect(sent.text).toContain(title);
      expect(sent.text).toContain(link);
      expect(push('reminder', language).link).toBe(link);
    },
  );
});

// @traces 177-FR-012 177-FR-015
describe('the 48-hour reminder of a reported reply', () => {
  it.each([
    [
      'ro',
      'Un răspuns raportat așteaptă de 48 de ore.',
      'Atelier Dinamo · răspuns la recenzia lui Andrei M.',
    ],
    [
      'en',
      'A reported reply has waited 48 hours.',
      "Atelier Dinamo · reply to Andrei M.'s review",
    ],
  ])('names the reply in %s', (language, line, title) => {
    const sent = mail('reminder_reply', language);

    expect(sent.text).toContain(line);
    expect(sent.text).toContain(title);
    expect(push('reminder_reply', language).link).toBe(link);
  });
});

// @traces 177-FR-015
describe('the Romanian hyphenated words', () => {
  it('use the non-breaking hyphen', () => {
    for (const variant of [undefined, 'reply', 'automatic', 'reminder']) {
      const sent = mail(variant, 'ro');
      expect(sent.text).toContain('e\u2011mail');
      expect(sent.text).not.toContain('e-mail');
    }
  });
});
