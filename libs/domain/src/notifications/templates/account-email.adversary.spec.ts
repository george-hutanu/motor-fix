import { render } from '../templates';

const base = {
  app: 'https://motorfix.test',
  link: 'https://motorfix.test/ro/contact',
  purpose: 'account_suspended',
  support: 'suport@motorfix.test',
};

const suspended = (language: string, reason: string, support = base.support) =>
  render('ACCOUNT_EMAIL.account_suspended', 'email', language, {
    ...base,
    reason,
    support,
  });

// @traces 003-FR-022
describe('the account suspended e-mail with hostile reasons', () => {
  it.each(['ro', 'en'])(
    'keeps replacement patterns in the reason as typed in %s',
    (language) => {
      const reason = "Pret $& si $' si $` si $1 si $$";

      const mail = suspended(language, reason);

      expect(mail.text).toContain(`: ${reason}`);
      expect(mail.html).toContain('Pret $&amp; si $&#39; si $` si $1 si $$');
    },
  );

  it('does not fill a placeholder the admin typed into the reason', () => {
    const mail = suspended('en', 'vezi {support} sau {link}');

    expect(mail.text).toContain('The reason: vezi {support} sau {link}');
    expect(mail.text).not.toContain('vezi suport@motorfix.test');
  });

  it('escapes quotes, ampersands and script tags in the html body', () => {
    const mail = suspended('en', "\"><script>alert(1)</script> & 'x'");

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('&amp;');
  });

  it('carries unicode and a 500-character reason whole', () => {
    const reason = `Șțăîâ 😀 ${'ă'.repeat(480)}`;

    const mail = suspended('ro', reason);

    expect(mail.text).toContain(reason);
  });

  it('keeps a reason with line breaks in the text body', () => {
    const mail = suspended('en', 'primul rand\nal doilea rand');

    expect(mail.text).toContain('primul rand\nal doilea rand');
  });
});
