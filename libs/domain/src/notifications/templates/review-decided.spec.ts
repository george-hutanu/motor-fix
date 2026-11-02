import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'REVIEW_DECIDED';
const params = {
  author: 'Andrei M.',
  garage: 'Atelier Dinamo',
  link: 'https://motorfix.test/app/driver/reviews',
  rule: 'insults',
};

const bell = (variant: string, language: string) => {
  const given = { ...params, variant };
  return render(templateName(KIND, given), 'bell', language, given);
};

// @traces 179-FR-011 179-FR-018
describe('the decision message on a reported review', () => {
  it('registers one form per target and side, each passing the template check', () => {
    const forms = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) => name.startsWith(KIND)),
    );

    expect(Object.keys(forms).sort()).toEqual([
      `${KIND}.reply_author`,
      `${KIND}.reply_owner`,
      `${KIND}.review_author`,
      `${KIND}.review_owner`,
    ]);
    expect(checkTemplates(forms)).toEqual([]);
    expect(forms[`${KIND}.review_author`].audience).toBe('driver');
    expect(forms[`${KIND}.reply_author`].audience).toBe('driver');
    expect(forms[`${KIND}.review_owner`].audience).toBe('garage');
    expect(forms[`${KIND}.reply_owner`].audience).toBe('garage');
  });

  it('stays on e-mail, push and WhatsApp in the catalogue, never SMS', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('tells the author of a removed review the rule and the one appeal', () => {
    expect(bell('review_author', 'ro')).toBe(
      'MotorFix a șters recenzia ta pentru Atelier Dinamo: Insulte. Poți contesta o dată, în 14 zile.',
    );
    expect(bell('review_author', 'en')).toBe(
      'MotorFix removed your review of Atelier Dinamo: Insults. You can appeal once, within 14 days.',
    );
  });

  it('tells the owner whose review was removed, naming the rule', () => {
    expect(bell('review_owner', 'ro')).toBe(
      'Recenzia lui Andrei M. a fost ștearsă: Insulte.',
    );
    expect(bell('review_owner', 'en')).toBe(
      "Andrei M.'s review was removed: Insults.",
    );
  });
});

// @traces 179-FR-011
describe('the decision message on a reported reply', () => {
  it('tells the owner their reply was removed, with no appeal line', () => {
    expect(bell('reply_owner', 'ro')).toBe(
      'MotorFix a șters răspunsul tău la recenzia lui Andrei M.: Insulte.',
    );
    expect(bell('reply_owner', 'en')).toBe(
      "MotorFix removed your reply to Andrei M.'s review: Insults.",
    );
  });

  it('tells the author the garage’s reply was removed', () => {
    expect(bell('reply_author', 'ro')).toBe(
      'Răspunsul service-ului Atelier Dinamo la recenzia ta a fost șters: Insulte.',
    );
    expect(bell('reply_author', 'en')).toBe(
      "Atelier Dinamo's reply to your review was removed: Insults.",
    );
  });

  it.each(['reply_owner', 'reply_author', 'review_owner'])(
    'gives no appeal line to %s',
    (variant) => {
      for (const language of ['ro', 'en']) {
        const given = { ...params, variant };
        const email = render(
          templateName(KIND, given),
          'email',
          language,
          given,
        );
        expect(email.text).not.toMatch(/14 (zile|days)/);
      }
    },
  );

  it('opens the reviews from the e-mail and the push', () => {
    const given = { ...params, variant: 'review_author' };
    const name = templateName(KIND, given);

    expect(render(name, 'email', 'ro', given).html).toContain(params.link);
    expect(render(name, 'push', 'en', given).link).toBe(params.link);
  });
});
