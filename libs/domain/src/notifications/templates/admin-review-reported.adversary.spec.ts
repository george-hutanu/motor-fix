import { notificationType } from '../catalogue';
import { render, TemplateError, templateName } from '../templates';

const KIND = 'ADMIN_REVIEW_REPORTED';
const link = 'https://motorfix.test/app/admin/reviews';
const base = {
  author: 'Andrei M.',
  garage: 'Atelier Dinamo',
  link,
  reason: 'insults',
  score: 3,
};
const FORMS = [undefined, 'reply', 'automatic', 'reminder'] as const;

const name = (variant: string | undefined, given: Record<string, unknown>) =>
  templateName(KIND, { ...given, ...(variant && { variant }) });

// @traces 177-FR-011 177-FR-015
describe('the review report alert under hostile values', () => {
  it.each(['email', 'push'] as const)(
    'fails the %s render when the garage is missing',
    (channel) => {
      const { garage: _garage, ...given } = base;
      expect(() => render(KIND, channel, 'en', given)).toThrow(TemplateError);
    },
  );

  it('fails the e-mail render when the link is missing', () => {
    const { link: _link, ...given } = base;
    expect(() => render(KIND, 'email', 'ro', given)).toThrow(TemplateError);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/app/admin/reviews'])(
    'refuses the e-mail link %s',
    (bad) => {
      expect(() => render(KIND, 'email', 'en', { ...base, link: bad })).toThrow(
        TemplateError,
      );
    },
  );

  it.each(['not_a_reason', '', null, 7, '__proto__'])(
    'fails the e-mail render for the reason %p',
    (reason) => {
      expect(() => render(KIND, 'email', 'en', { ...base, reason })).toThrow(
        Error,
      );
    },
  );

  it.each(['abc', null, Number.NaN, {}])(
    'fails the e-mail render for the score %p',
    (score) => {
      expect(() => render(KIND, 'email', 'en', { ...base, score })).toThrow(
        Error,
      );
    },
  );

  it.each([
    [1, '1.0'],
    [5, '5.0'],
    ['4', '4.0'],
  ])('writes the score %p as %s in English', (score, text) => {
    const sent = render(KIND, 'email', 'en', { ...base, score });
    expect(sent.text).toContain(`reported a ${text} review`);
  });

  it('falls back to the plain form for an unknown variant', () => {
    expect(name('bogus', base)).toBe(KIND);
    expect(name('constructor', base)).toBe(KIND);
  });

  it.each([undefined, 'reply', 'reminder'] as const)(
    'does not expand a placeholder held in the garage (%s)',
    (v) => {
      const given = { ...base, garage: '{reason}', variant: v };
      const sent = render(name(v, given), 'email', 'en', given);
      expect(sent.text).toContain('{reason}');
      expect(sent.text).not.toContain('Insults{reason}');
    },
  );

  it.each(FORMS)('escapes markup in the author and garage (%s)', (v) => {
    const given = {
      ...base,
      author: '"><img src=x onerror=alert(1)>',
      garage: '<script>alert(1)</script>',
      variant: v,
    };
    const sent = render(name(v, given), 'email', 'ro', given);
    expect(sent.html).not.toContain('<script>');
    expect(sent.html).not.toContain('<img');
  });

  it('keeps unicode and emoji in the garage name whole', () => {
    const sent = render(KIND, 'push', 'ro', {
      ...base,
      garage: 'Ștefan 🚗 Ăă',
    });
    expect(sent.body).toContain('Ștefan 🚗 Ăă');
  });

  it.each(FORMS)('never carries a review text parameter (%s)', (v) => {
    const given = { ...base, text: 'SECRET REVIEW TEXT', variant: v };
    const sent = render(name(v, given), 'email', 'en', given);
    expect(sent.text).not.toContain('SECRET REVIEW TEXT');
    expect(sent.html).not.toContain('SECRET REVIEW TEXT');
  });

  it.each(FORMS)('has no sms or whatsapp text (%s)', (v) => {
    for (const channel of ['sms', 'whatsapp'] as const) {
      expect(() =>
        render(name(v, base), channel as never, 'en', { ...base, variant: v }),
      ).toThrow(TemplateError);
    }
  });

  it('reads an unknown language as Romanian', () => {
    const sent = render(KIND, 'email', 'fr', base);
    expect(sent.text).toContain('a raportat o recenzie de 3,0');
  });

  it('offers admins e-mail and push only in the catalogue', () => {
    expect(notificationType(KIND).channels).toEqual(['email', 'push']);
  });
});
