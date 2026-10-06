import { render, TemplateError } from '../templates';

const app = 'https://motorfix.test';
const link = 'https://motorfix.test/ro/invite/abc';
const KINDS = ['STAFF_INVITE.mechanic', 'STAFF_INVITE.receptionist'] as const;

describe('staff templates under hostile values', () => {
  it.each(KINDS)(
    'escapes markup in a garage name for %s, in both languages',
    (kind) => {
      for (const language of ['ro', 'en'] as const) {
        const mail = render(kind, 'email', language, {
          app,
          garage: '<img src=x onerror=alert(1)>',
          link,
        });
        expect(mail.html).not.toContain('<img');
        expect(mail.html).toContain('&lt;img');
      }
    },
  );

  it.each(KINDS)(
    'keeps a garage name that looks like a placeholder literal for %s',
    (kind) => {
      const mail = render(kind, 'email', 'en', {
        app,
        garage: '{link}',
        link,
      });
      expect(mail.subject).toBe('Invitation from {link}');
    },
  );

  it('escapes markup in the joined name in the e-mail html', () => {
    const mail = render('STAFF_JOINED', 'email', 'ro', {
      app,
      garage: 'G',
      name: '"><script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
  });

  it('shows a name with quotes and ampersands in the bell as typed', () => {
    expect(
      render('STAFF_JOINED', 'bell', 'en', {
        app,
        garage: 'A & B "Auto"',
        name: "O'Neil <x>",
      }),
    ).toBe('O\'Neil <x> joined the team of A & B "Auto".');
  });

  it('refuses to send an invite without its link', () => {
    expect(() =>
      render('STAFF_INVITE.mechanic', 'email', 'ro', { app, garage: 'G' }),
    ).toThrow(TemplateError);
  });

  it('states the seven-day expiry in both languages', () => {
    expect(
      render(KINDS[0], 'email', 'ro', { app, garage: 'G', link }).text,
    ).toContain('7 zile');
    expect(
      render(KINDS[1], 'email', 'en', { app, garage: 'G', link }).text,
    ).toContain('7 days');
  });

  it('handles a very long unicode garage name without truncating the link', () => {
    const mail = render('STAFF_INVITE.mechanic', 'email', 'ro', {
      app,
      garage: 'Ș'.repeat(5000),
      link,
    });
    expect(mail.text).toContain(link);
  });
});
