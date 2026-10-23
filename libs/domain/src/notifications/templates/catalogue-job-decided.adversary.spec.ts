import { TEMPLATES } from './registry';
import { render, templateName } from '../templates';

const KIND = 'CATALOGUE_JOB_DECIDED';
const prices = 'https://motorfix.test/app/garage/prices';
const PUSH_MAX = 120;

const params = (decision: 'approved' | 'rejected', job: string) =>
  decision === 'approved'
    ? { decision, job, prices }
    : { decision, job, prices, reason: 'Motiv destul de lung.'.repeat(20) };

const pushOf = (
  decision: 'approved' | 'rejected',
  language: string,
  job: string,
) => {
  const p = params(decision, job);
  return render(templateName(KIND, p), 'push', language, p);
};

// @traces 414-FR-009
describe('the catalogue job push for long or odd job names', () => {
  const cases = (['approved', 'rejected'] as const).flatMap((decision) =>
    (['ro', 'en'] as const).map((language) => [decision, language] as const),
  );

  it.each(cases)(
    'keeps the %s %s push body and title at 120 characters for the longest name of 80',
    (decision, language) => {
      const push = pushOf(decision, language, 'Ș'.repeat(80));
      expect([...push.body].length).toBeLessThanOrEqual(PUSH_MAX);
      expect([...push.title].length).toBeLessThanOrEqual(PUSH_MAX);
    },
  );

  it.each(cases)(
    'keeps the %s %s push body at 120 characters for 80 emoji counted in UTF-16 units',
    (decision, language) => {
      const push = pushOf(decision, language, '\u{1F600}'.repeat(80));
      expect(push.body.length).toBeLessThanOrEqual(PUSH_MAX);
    },
  );

  it.each(cases)(
    'keeps the %s %s push body at 120 characters when a legacy name runs to 200',
    (decision, language) => {
      const push = pushOf(decision, language, 'J'.repeat(200));
      expect([...push.body].length).toBeLessThanOrEqual(PUSH_MAX);
    },
  );

  it.each(cases)(
    'never leaks the reason into the %s %s push',
    (decision, language) => {
      const push = pushOf(decision, language, 'Injectoare');
      expect(push.body).not.toContain('Motiv destul');
    },
  );

  it.each(['ro', 'en'])(
    'keeps markup in a job name out of the %s push and e-mail html',
    (language) => {
      const job = '<b>Ulei</b><script>x()</script>';
      const p = params('rejected', job);
      const name = templateName(KIND, p);
      expect(render(name, 'email', language, p).html).not.toContain('<script');
      expect(render(name, 'email', language, p).html).not.toContain('<b>Ulei');
      expect(render(name, 'email', language, p).subject).toContain(job);
    },
  );

  it('refuses to render a rejection without its reason rather than print "undefined"', () => {
    const p = { decision: 'rejected', job: 'Ulei', prices };
    expect(() => render(`${KIND}.rejected`, 'bell', 'ro', p)).toThrow(
      /missing value reason/,
    );
  });

  it('refuses to render with a null job', () => {
    const p = { decision: 'approved', job: null, prices };
    expect(() => render(`${KIND}.approved`, 'bell', 'en', p)).toThrow(
      /missing value job/,
    );
  });

  it('renders a language it does not know in Romanian', () => {
    const p = params('approved', 'Ulei');
    expect(render(`${KIND}.approved`, 'bell', 'fr', p)).toBe(
      'Lucrarea „Ulei” a fost aprobată și apare pe profilul tău.',
    );
  });

  it('registers exactly an approved and a rejected variant', () => {
    expect(
      Object.keys(TEMPLATES)
        .filter((name) => name.startsWith(`${KIND}.`))
        .sort(),
    ).toEqual([`${KIND}.approved`, `${KIND}.rejected`]);
  });
});
