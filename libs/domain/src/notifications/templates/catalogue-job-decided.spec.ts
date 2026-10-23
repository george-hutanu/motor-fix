import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render, templateName } from '../templates';

const KIND = 'CATALOGUE_JOB_DECIDED';
const prices = 'https://motorfix.test/app/garage/prices';
const REASON = 'Există deja ca „Curățare injectoare”.';

const approved = (job = 'Recondiționare injectoare') => ({
  decision: 'approved',
  job,
  prices,
});
const rejected = (reason = REASON, job = 'Recondiționare injectoare') => ({
  decision: 'rejected',
  job,
  prices,
  reason,
});

// @traces 414-FR-009
describe('the message telling a garage owner what became of a proposed job', () => {
  it('goes to the bell, by e-mail and by push, and can be muted', () => {
    expect(NOTIFICATION_TYPES[KIND]?.channels).toEqual(
      expect.arrayContaining(['email', 'push']),
    );
    expect(NOTIFICATION_TYPES[KIND]?.alwaysSent).toBe(false);
  });

  it.each([
    ['approved', approved()],
    ['rejected', rejected()],
  ])(
    'has a %s variant for garages in both languages that passes the template check',
    (decision, params) => {
      const name = templateName(KIND, params);
      expect(name).toBe(`${KIND}.${decision}`);
      expect(TEMPLATES[name]?.audience).toBe('garage');
      expect(checkTemplates({ [name]: TEMPLATES[name] })).toEqual([]);
      for (const channel of ['email', 'push', 'bell'] as const) {
        expect(Object.keys(TEMPLATES[name]?.[channel] ?? {}).sort()).toEqual([
          'en',
          'ro',
        ]);
      }
    },
  );

  it.each([
    [
      'ro',
      'Lucrarea „Recondiționare injectoare” a fost aprobată și apare pe profilul tău.',
    ],
    [
      'en',
      'The job "Injector reconditioning" was approved and is on your profile.',
    ],
  ])('words an approval in the %s bell', (language, line) => {
    const job =
      language === 'en'
        ? 'Injector reconditioning'
        : 'Recondiționare injectoare';
    expect(bellText(KIND, language, approved(job))).toBe(line);
  });

  it.each([
    ['ro', `Lucrarea „Recondiționare injectoare” a fost respinsă: ${REASON}`],
    ['en', `The job "Recondiționare injectoare" was rejected: ${REASON}`],
  ])('words a rejection with its reason in the %s bell', (language, line) => {
    expect(bellText(KIND, language, rejected())).toBe(line);
  });

  it.each([
    ['ro', approved(), 'Lucrarea Recondiționare injectoare a fost aprobată'],
    ['en', approved(), 'The job Recondiționare injectoare was approved'],
    ['ro', rejected(), 'Lucrarea Recondiționare injectoare a fost respinsă'],
    ['en', rejected(), 'The job Recondiționare injectoare was rejected'],
  ])(
    'gives the %s e-mail its subject and a button to Prețuri',
    (language, params, subject) => {
      const mail = render(
        templateName(KIND, params),
        'email',
        language,
        params,
      );
      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(prices);
      expect(mail.html).toContain(prices);
    },
  );

  it.each(['ro', 'en'])(
    'carries the reason whole in the %s e-mail',
    (language) => {
      const reason = 'ș'.repeat(500);
      const mail = render(
        `${KIND}.rejected`,
        'email',
        language,
        rejected(reason),
      );
      expect(mail.text).toContain(reason);
      expect(bellText(KIND, language, rejected(reason))).toContain(reason);
    },
  );

  it.each([
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    '<a href="https://evil.example">aici</a>',
  ])('shows the reason %j as plain text in every channel', (reason) => {
    for (const language of ['ro', 'en']) {
      const params = rejected(reason);
      const html = render(`${KIND}.rejected`, 'email', language, params).html;
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('href="https://evil.example"');
      expect(
        render(`${KIND}.rejected`, 'email', language, params).text,
      ).toContain(reason);
      expect(bellText(KIND, language, params)).toContain(reason);
      const push = render(`${KIND}.rejected`, 'push', language, params);
      expect(push.body).not.toContain('<');
    }
  });

  it('keeps placeholders and replacement patterns written in the reason as typed', () => {
    const reason = 'Vezi {job} și {prices} $& $1 $$';
    expect(bellText(KIND, 'ro', rejected(reason))).toBe(
      `Lucrarea „Recondiționare injectoare” a fost respinsă: ${reason}`,
    );
  });

  it.each([
    ['approved', approved('J'.repeat(80))],
    ['rejected', rejected('ș'.repeat(500), 'J'.repeat(80))],
  ])(
    'keeps the %s push within its limits for the longest name and reason, opening Prețuri',
    (_, params) => {
      for (const language of ['ro', 'en']) {
        const push = render(
          templateName(KIND, params),
          'push',
          language,
          params,
        );
        expect(push.body).toContain('J'.repeat(80));
        expect(push.link).toBe(prices);
      }
    },
  );

  it('shortens a name too long for the push with "…", and keeps it whole in the bell', () => {
    const params = approved('\u{1F600}'.repeat(80));
    const name = templateName(KIND, params);

    const push = render(name, 'push', 'ro', params);

    // An emoji is two units and never split, so the body may stop at 119.
    expect(push.body.length).toBeGreaterThanOrEqual(119);
    expect(push.body.length).toBeLessThanOrEqual(120);
    expect(push.body).toMatch(/^„(\u{1F600})+…” e acum pe profilul tău\.$/u);
    expect(render(name, 'bell', 'ro', params)).toContain(
      '\u{1F600}'.repeat(80),
    );
  });
});
