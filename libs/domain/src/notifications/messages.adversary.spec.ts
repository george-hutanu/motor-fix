import { groupedMessage, message } from './messages';

describe('message texts under hostile parameters', () => {
  const link = 'https://motorfix.test/reset?token=a%20b&x=<script>"\'';

  it('puts a link with special characters into the body unchanged', () => {
    const mail = message('ACCOUNT_EMAIL', 'en', {
      link,
      purpose: 'password_reset',
    });
    expect(mail.text).toContain(link);
  });

  it('keeps the link out of the subject', () => {
    for (const language of ['ro', 'en'] as const) {
      const mail = message('ACCOUNT_EMAIL', language, {
        link,
        purpose: 'email_check',
      });
      expect(mail.subject).not.toContain(link);
    }
  });

  it('keeps line breaks from a hostile link out of the subject', () => {
    const mail = message('ACCOUNT_EMAIL', 'en', {
      link: 'https://x.test/\r\nBcc: evil@example.test',
      purpose: 'email_check',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('names two new offers in Romanian as "2 oferte noi"', () => {
    expect(groupedMessage('QUOTE_RECEIVED', 2, 'ro').subject).toContain(
      '2 oferte noi',
    );
  });

  it('gives both languages a non-empty subject and body for each kind', () => {
    for (const kind of [
      'TEST_MESSAGE',
      'ACCOUNT_EMAIL',
      'QUOTE_RECEIVED',
      'JOB_READY',
      'NEWS',
    ]) {
      for (const language of ['ro', 'en'] as const) {
        const mail = message(kind, language, {
          link: 'https://x.test',
          purpose: 'email_check',
        });
        expect(mail.subject.trim().length).toBeGreaterThan(0);
        expect(mail.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('never prints undefined or null for missing parameters', () => {
    for (const language of ['ro', 'en'] as const) {
      const mail = message('QUOTE_RECEIVED', language, {});
      expect(`${mail.subject}\n${mail.text}`).not.toMatch(
        /undefined|null|\[object/,
      );
    }
  });

  it('is deterministic for the same input', () => {
    expect(message('TEST_MESSAGE', 'ro', {})).toEqual(
      message('TEST_MESSAGE', 'ro', {}),
    );
  });
});

describe('the grouped message', () => {
  it.each([2, 3, 10, 999])('names the count %i in both languages', (count) => {
    for (const language of ['ro', 'en'] as const) {
      const mail = groupedMessage('QUOTE_RECEIVED', count, language);
      expect(mail.subject).toContain(String(count));
      expect(mail.text.length).toBeGreaterThan(0);
    }
  });

  it('never renders NaN for a zero or fractional count', () => {
    expect(groupedMessage('QUOTE_RECEIVED', 0, 'en').subject).not.toContain(
      'NaN',
    );
    expect(groupedMessage('QUOTE_RECEIVED', 2.5, 'en').subject).not.toContain(
      'NaN',
    );
  });
});
