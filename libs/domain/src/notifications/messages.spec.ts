import { groupedMessage, message } from './messages';

describe('message texts', () => {
  it('writes the test message in Romanian and English', () => {
    const ro = message('TEST_MESSAGE', 'ro', {});
    const en = message('TEST_MESSAGE', 'en', {});
    expect(ro.subject).toMatch(/test/i);
    expect(en.subject).toMatch(/test/i);
    expect(ro.subject).not.toBe(en.subject);
    expect(ro.text.length).toBeGreaterThan(0);
  });

  it.each([
    'email_check',
    'password_reset',
  ])('puts the link into the %s e-mail in both languages', (purpose) => {
    const link = 'https://motorfix.test/a?token=abc';
    for (const language of ['ro', 'en'] as const) {
      const mail = message('ACCOUNT_EMAIL', language, { link, purpose });
      expect(mail.text).toContain(link);
      expect(mail.subject.length).toBeGreaterThan(0);
    }
    expect(message('ACCOUNT_EMAIL', 'ro', { link, purpose }).subject).not.toBe(
      message('ACCOUNT_EMAIL', 'en', { link, purpose }).subject,
    );
  });

  it('tells the e-mail check and the password reset apart', () => {
    const link = 'https://motorfix.test/x';
    expect(
      message('ACCOUNT_EMAIL', 'en', { link, purpose: 'email_check' }).subject,
    ).not.toBe(
      message('ACCOUNT_EMAIL', 'en', { link, purpose: 'password_reset' })
        .subject,
    );
  });

  it('has a plain message for a type whose own texts come later', () => {
    const mail = message('QUOTE_RECEIVED', 'ro', {});
    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.text.length).toBeGreaterThan(0);
  });

  it('names the count of a grouped e-mail in the recipient language', () => {
    expect(groupedMessage('QUOTE_RECEIVED', 3, 'ro').subject).toContain('3');
    expect(groupedMessage('QUOTE_RECEIVED', 3, 'en').subject).toContain('3');
    expect(groupedMessage('QUOTE_RECEIVED', 3, 'ro').subject).not.toBe(
      groupedMessage('QUOTE_RECEIVED', 3, 'en').subject,
    );
  });
});
