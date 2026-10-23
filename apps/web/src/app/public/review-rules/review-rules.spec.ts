import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';

import { ReviewRules } from './review-rules';

async function open(path: string, platform: 'browser' | 'server' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: ReviewRules, path: ':lang/review-rules' }]),
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (path.startsWith('/en/')) await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(path);
  harness.detectChanges();
  await harness.fixture.whenStable();
  return harness.routeNativeElement as HTMLElement;
}

const squash = (node: Element | null) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

const RULES = {
  en: [
    'No insults.',
    'No personal data.',
    'No ads.',
    'No promotion of other services.',
    'Only about this repair and this garage.',
    'No hate or discrimination.',
    'No fake or conflicted reviews.',
    'No threats or legal accusations stated as fact.',
  ],
  ro: [
    'Fără insulte.',
    'Fără date personale.',
    'Fără reclame.',
    'Fără promovarea altor servicii.',
    'Doar despre această reparație și acest service.',
    'Fără ură sau discriminare.',
    'Fără recenzii false sau în conflict de interese.',
    'Fără amenințări sau acuzații legale prezentate ca fapte.',
  ],
};

const PAGE = {
  en: {
    moderation: 'How moderation works',
    replies: 'The same rules apply to garages’ replies.',
    title: 'Review rules',
  },
  ro: {
    moderation: 'Cum funcționează moderarea',
    replies: 'Aceleași reguli se aplică și răspunsurilor service‑urilor.',
    title: 'Regulile recenziilor',
  },
};

// @traces 182-FR-003 182-FR-004 182-FR-005 182-FR-008
describe('the review rules page', () => {
  it.each(['ro', 'en'] as const)(
    '/%s/review-rules lists the eight rules in order and says they bind the replies',
    async (language) => {
      const page = await open(`/${language}/review-rules`);

      expect(squash(page.querySelector('h1'))).toBe(PAGE[language].title);
      const items = [...page.querySelectorAll('ol > li')];
      expect(items).toHaveLength(8);
      for (const [i, item] of items.entries())
        expect(squash(item.querySelector('strong'))).toBe(RULES[language][i]);
      for (const item of items)
        expect(squash(item).length).toBeGreaterThan(
          squash(item.querySelector('strong')).length,
        );
      expect(squash(page.querySelector('ol + p'))).toBe(PAGE[language].replies);
    },
  );

  it('carries no version line: it is not a versioned legal text', async () => {
    const page = await open('/ro/review-rules');

    expect(squash(page)).not.toMatch(/Versiunea|Version/);
  });

  it('renders the whole page on the server', async () => {
    const page = await open('/ro/review-rules', 'server');

    expect(squash(page.querySelector('h1'))).toBe('Regulile recenziilor');
    expect(page.querySelectorAll('ol > li')).toHaveLength(8);
  });
});

// @traces 182-FR-006
describe('how moderation works, on the rules page', () => {
  it.each(['ro', 'en'] as const)(
    '/%s/review-rules states the reports, the 48 hours, both sides told, the one appeal within 14 days and no rewrite',
    async (language) => {
      const page = await open(`/${language}/review-rules`);

      const heading = [...page.querySelectorAll('h2')].find(
        (h) => squash(h) === PAGE[language].moderation,
      );
      expect(heading).toBeDefined();
      const section = squash(heading?.closest('section') ?? null);
      const facts = {
        en: [
          /garage can report a review/,
          /author can report the garage’s reply/,
          /hidden until an admin decides, within 48 hours/,
          /does not count in the rating/,
          /author and the garage are told/,
          /appealed once, within 14 days/,
          /different admin decides/,
          /cannot be written again/,
        ],
        ro: [
          /service poate raporta o recenzie/,
          /autorul recenziei poate raporta răspunsul service‑ului/,
          /ascuns până decide un administrator, în cel mult 48 de ore/,
          /nu se pune la calculul notei/,
          /autorul și service‑ul sunt anunțați/,
          /o singură contestație, în 14 zile/,
          /alt administrator decide/,
          /nu mai poate fi scrisă din nou/,
        ],
      }[language];
      for (const fact of facts) expect(section).toMatch(fact);
    },
  );
});
