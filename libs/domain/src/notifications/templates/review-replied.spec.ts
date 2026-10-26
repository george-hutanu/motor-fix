import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'REVIEW_REPLIED';
const link = 'https://motorfix.test/app/driver/reviews';
const params = { garage: 'Atelier Dinamo', link };

// @traces 075-FR-008 075-FR-012
describe('the reply message to the review’s author', () => {
  it('registers one text for the driver, in both languages, that passes the template check', () => {
    expect(templateName(KIND, params)).toBe(KIND);
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
    for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
      expect(Object.keys(TEMPLATES[KIND]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('stays on e-mail, push and WhatsApp in the catalogue, never SMS', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('names the garage', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Atelier Dinamo ți-a răspuns la recenzie.',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Atelier Dinamo replied to your review.',
    );
    expect(render(KIND, 'push', 'ro', params).body).toBe(
      'Atelier Dinamo ți-a răspuns la recenzie.',
    );
    expect(render(KIND, 'push', 'en', params).link).toBe(link);
  });

  it('opens the driver’s reviews from the e-mail', () => {
    const email = render(KIND, 'email', 'ro', params);

    expect(email.subject).toBe('Atelier Dinamo ți-a răspuns la recenzie.');
    expect(email.text).toContain('Vezi recenziile tale');
    expect(email.html).toContain(link);
  });
});
