import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'REVIEW_POSTED';
const link = 'https://motorfix.test/app/garage/reviews';
const job = {
  author: 'Andrei M.',
  car: 'BMW 320d',
  link,
  rating: 5,
  source: 'job',
};
const profile = { author: 'Ioana P.', link, rating: 4, source: 'profile' };

// @traces 074-FR-012 074-FR-014
describe('the new review message to the garage owner', () => {
  it('picks the job text for a job review and the shorter one for a profile review', () => {
    expect(templateName(KIND, job)).toBe('REVIEW_POSTED.job');
    expect(templateName(KIND, profile)).toBe('REVIEW_POSTED.profile');
    expect(templateName(KIND, { ...job, source: undefined })).toBe(
      'REVIEW_POSTED.job',
    );
  });

  it('registers both texts for the garage and passes the template check', () => {
    for (const name of ['REVIEW_POSTED.job', 'REVIEW_POSTED.profile']) {
      expect(TEMPLATES[name]?.audience).toBe('garage');
      expect(checkTemplates({ [name]: TEMPLATES[name] })).toEqual([]);
      for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
        expect(Object.keys(TEMPLATES[name]?.[channel] ?? {}).sort()).toEqual([
          'en',
          'ro',
        ]);
      }
    }
  });

  it('stays on e-mail, push and WhatsApp in the catalogue, never SMS', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('names the rating, the author and the car for a job review', () => {
    expect(render('REVIEW_POSTED.job', 'bell', 'ro', job)).toBe(
      'Recenzie nouă de 5 de la Andrei M. pentru BMW 320d',
    );
    expect(render('REVIEW_POSTED.job', 'bell', 'en', job)).toBe(
      'New 5-star review from Andrei M. for a BMW 320d',
    );
    expect(render('REVIEW_POSTED.job', 'push', 'ro', job).body).toBe(
      'Recenzie nouă de 5 de la Andrei M. pentru BMW 320d',
    );
    expect(render('REVIEW_POSTED.job', 'push', 'en', job).link).toBe(link);
  });

  // The short name ends in a full stop, so the line carries no second one.
  it('names no car for a profile review', () => {
    expect(render('REVIEW_POSTED.profile', 'bell', 'ro', profile)).toBe(
      'Recenzie nouă de 4 de la Ioana P.',
    );
    expect(render('REVIEW_POSTED.profile', 'bell', 'en', profile)).toBe(
      'New 4-star review from Ioana P.',
    );
  });

  it("opens the garage's Recenzii from the e-mail", () => {
    const email = render('REVIEW_POSTED.job', 'email', 'ro', job);

    expect(email.subject).toBe('Recenzie nouă: BMW 320d');
    expect(email.html).toContain(link);
  });
});
