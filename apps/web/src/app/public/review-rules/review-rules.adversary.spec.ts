import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HealthService } from '@motor-fix/data-access';

import {
  PUBLIC_PATHS,
  provideLanguageAddresses,
  SITE_ORIGIN,
} from '../../addresses';
import { routes } from '../../app.routes';

const ROOT = join(__dirname, '../../../../../..');
const json = (area: string, language: string) =>
  JSON.parse(
    readFileSync(join(ROOT, 'libs/i18n/src', area, `${language}.json`), 'utf8'),
  );

const leaves = (node: unknown, prefix = ''): Record<string, string> => {
  if (typeof node === 'string') return { [prefix]: node };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node as object))
    Object.assign(out, leaves(v, prefix ? `${prefix}.${k}` : k));
  return out;
};

const pick = (language: string) => ({
  ...leaves(json('public', language).reviewRules, 'public.reviewRules'),
  ...leaves(json('driver', language).review.rules, 'driver.review.rules'),
  ...leaves(
    json('consent', language).footer.reviewRules,
    'consent.footer.reviewRules',
  ),
});

async function open(url: string, platform: 'browser' | 'server' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: 'https://motorfix.ro' },
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: HealthService,
        useValue: { healthControllerReady: () => Promise.reject() },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
  return harness;
}

const squash = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

// @traces 182-FR-003 182-FR-008
describe('the review rules texts, in both languages', () => {
  it('has the same keys in Romanian and English', () => {
    expect(Object.keys(pick('ro')).sort()).toEqual(
      Object.keys(pick('en')).sort(),
    );
  });

  it('has no empty text in either language', () => {
    for (const language of ['ro', 'en'])
      for (const [key, value] of Object.entries(pick(language)))
        expect([key, value.trim().length > 0]).toEqual([key, true]);
  });

  it('keeps Romanian as written: no ASCII hyphen inside service-urilor or în-tr words', () => {
    for (const [key, value] of Object.entries(pick('ro')))
      expect([key, /\w-\w/.test(value)]).toEqual([key, false]);
  });

  it('has exactly eight rules in each language, numbered 1 to 8', () => {
    for (const language of ['ro', 'en']) {
      const rule = json('public', language).reviewRules.rule;
      expect(Object.keys(rule).sort()).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
      ]);
    }
  });

  it('holds the owner-approved Romanian replies sentence verbatim, with U+2011', () => {
    expect(json('public', 'ro').reviewRules.replies).toBe(
      'Aceleași reguli se aplică și răspunsurilor service‑urilor.',
    );
    expect(json('public', 'en').reviewRules.replies).toBe(
      'The same rules apply to garages’ replies.',
    );
  });

  it('holds the owner-approved Romanian summary and link verbatim', () => {
    expect(json('driver', 'ro').review.rules.summary).toBe(
      'Fără insulte, date personale sau reclame. Scrie doar despre această reparație.',
    );
    expect(json('driver', 'ro').review.rules.link).toBe('Regulile recenziilor');
    expect(json('driver', 'ro').review.rules.newTab).toBe(
      '(se deschide într‑o filă nouă)',
    );
    expect(json('driver', 'en').review.rules.summary).toBe(
      'No insults, personal data or ads. Write only about this repair.',
    );
    expect(json('driver', 'en').review.rules.newTab).toBe(
      '(opens in a new tab)',
    );
  });

  it('places the footer key under consent.footer with both titles', () => {
    expect(json('consent', 'ro').footer.reviewRules).toBe(
      'Regulile recenziilor',
    );
    expect(json('consent', 'en').footer.reviewRules).toBe('Review rules');
  });
});

// @traces 182-FR-003 182-FR-004 182-FR-005
describe('the review rules route', () => {
  it('shows the not-found page for an unknown language prefix', async () => {
    const harness = await open('/de/review-rules');

    expect(squash(harness.routeNativeElement)).toContain('Pagina nu există');
    expect(
      harness.routeNativeElement?.querySelector('mf-review-rules'),
    ).toBeNull();
  });

  it('shows the not-found page for the page under a wrong path', async () => {
    const harness = await open('/ro/review-rule');

    expect(
      harness.routeNativeElement?.querySelector('mf-review-rules'),
    ).toBeNull();
  });

  it.each([
    ['ro', 'Regulile recenziilor'],
    ['en', 'Review rules'],
  ])(
    '/%s/review-rules sets the route title and one h1',
    async (language, title) => {
      const harness = await open(`/${language}/review-rules`);

      expect(document.title).toContain(title);
      const page = harness.routeNativeElement as HTMLElement;
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(page.querySelectorAll('ol')).toHaveLength(1);
      expect(page.querySelectorAll('ol > li')).toHaveLength(8);
      expect(document.documentElement.lang).toBe(language);
    },
  );

  it('renders English on the server with one replies line and one moderation section', async () => {
    const harness = await open('/en/review-rules', 'server');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.querySelectorAll('ol > li')).toHaveLength(8);
    expect(page.querySelectorAll('ol + p')).toHaveLength(1);
    expect(page.querySelectorAll('section')).toHaveLength(1);
    expect(squash(page.querySelector('ol + p'))).toBe(
      'The same rules apply to garages’ replies.',
    );
    expect(document.documentElement.lang).toBe('en');
  });

  it('lists the page once in the public paths', () => {
    expect(PUBLIC_PATHS.filter((p) => p === 'review-rules')).toHaveLength(1);
  });
});

// @traces 182-FR-009
describe('the review rules styles', () => {
  const sizes = (file: string) => {
    const css = readFileSync(join(__dirname, file), 'utf8');
    return [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  };

  it('sets no font size under 12 px in the drawer styles', () => {
    for (const size of sizes('../../dashboard/review-task/review-task.css')) {
      const px = /^([\d.]+)px$/.exec(size);
      const rem = /^([\d.]+)rem$/.exec(size);
      if (px) expect(Number(px[1])).toBeGreaterThanOrEqual(12);
      else if (rem) expect(Number(rem[1]) * 16).toBeGreaterThanOrEqual(12);
      else expect(size).toMatch(/^(var\(--mf-size-[a-z]+\)|inherit)$/);
    }
  });

  it('keeps long words from scrolling the page sideways', () => {
    const css = readFileSync(join(__dirname, 'review-rules.css'), 'utf8');
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });
});
