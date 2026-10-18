import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render, templateName } from '../templates';

const KIND = 'GARAGE_REPORT_DECIDED';
const profile = 'https://motorfix.test/ro/garages/atelier-dinamo';

const paramsOf = (decision: string) => ({
  decision,
  garage: 'Atelier Dinamo',
  profile,
});

const WORDS = {
  confirmed: {
    en: 'We checked your report about Atelier Dinamo and took action.',
    ro: 'Am verificat sesizarea ta despre Atelier Dinamo și am luat măsuri.',
  },
  unfounded: {
    en: 'We checked your report about Atelier Dinamo. No action was needed.',
    ro: 'Am verificat sesizarea ta despre Atelier Dinamo. Nu a fost nevoie de nicio măsură.',
  },
} as const;

// @traces 069-report-decision-FR-007
describe('the message telling a driver what became of their report', () => {
  it('goes by e-mail and push to drivers, muteable under reviews and history', () => {
    const type = NOTIFICATION_TYPES[KIND];
    expect(type?.channels).toEqual(['email', 'push']);
    expect(type?.group).toBe('reviews_history');
    expect(type?.alwaysSent).toBe(false);
  });

  it.each(['unfounded', 'confirmed'])(
    'has a %s variant for drivers that passes the template check',
    (decision) => {
      const name = templateName(KIND, paramsOf(decision));
      expect(name).toBe(`${KIND}.${decision}`);
      expect(TEMPLATES[name]?.audience).toBe('driver');
      expect(checkTemplates({ [name]: TEMPLATES[name] })).toEqual([]);
      for (const channel of ['email', 'push', 'bell'] as const) {
        expect(Object.keys(TEMPLATES[name]?.[channel] ?? {}).sort()).toEqual([
          'en',
          'ro',
        ]);
      }
      expect(Object.keys(TEMPLATES[name]?.values ?? {}).sort()).toEqual([
        'garage',
        'profile',
      ]);
    },
  );

  it('falls back to the generic text for a decision it does not know', () => {
    expect(templateName(KIND, paramsOf('maybe'))).toBe(KIND);
  });

  it.each(['unfounded', 'confirmed'] as const)(
    'words a decision %s in both languages, in the bell, the push and the e-mail',
    (decision) => {
      for (const language of ['ro', 'en'] as const) {
        const words = WORDS[decision][language];
        expect(bellText(KIND, language, paramsOf(decision))).toBe(words);
        const push = render(
          templateName(KIND, paramsOf(decision)),
          'push',
          language,
          paramsOf(decision),
        ) as {
          body: string;
        };
        expect(push.body).toBe(words);
        const mail = render(
          templateName(KIND, paramsOf(decision)),
          'email',
          language,
          paramsOf(decision),
        ) as {
          text: string;
        };
        expect(mail.text).toContain(words);
        expect(mail.text).toContain(profile);
      }
    },
  );
});
