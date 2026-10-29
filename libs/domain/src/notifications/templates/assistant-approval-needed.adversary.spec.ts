import { render } from '../templates';

// @traces 1254-FR-003
const KIND = 'ASSISTANT_APPROVAL_NEEDED';
const link =
  'https://motorfix.test/app/assistant/approvals/6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b';

describe('the approval-needed message under hostile params', () => {
  it.each(['ro', 'en'])(
    'never carries a summary, plate or phone passed alongside the link in %s',
    (lang) => {
      const params = {
        link,
        phone: '+40712345678',
        plate: 'B-123-ABC',
        summary: 'SECRET-SUMMARY',
      };
      const out = JSON.stringify([
        render(KIND, 'bell', lang, params),
        render(KIND, 'push', lang, params),
        render(KIND, 'email', lang, params),
      ]);

      for (const secret of ['SECRET-SUMMARY', 'B-123-ABC', '+40712345678'])
        expect(out).not.toContain(secret);
    },
  );

  it('escapes markup in the link inside the e-mail html', () => {
    const mail = render(KIND, 'email', 'en', {
      link: 'https://motorfix.test/"><script>alert(1)</script>',
    });

    expect(mail.html).not.toContain('<script>alert(1)</script>');
  });

  it('falls back to a defined language text for an unknown language', () => {
    expect(typeof render(KIND, 'bell', 'fr', { link })).toBe('string');
  });

  it('names the thirty-minute expiry in the e-mail in both languages', () => {
    expect(render(KIND, 'email', 'en', { link }).text).toContain('30 minutes');
    expect(render(KIND, 'email', 'ro', { link }).text).toContain(
      '30 de minute',
    );
  });
});
