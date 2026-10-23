import { readFileSync } from 'node:fs';

import {
  type Browser,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { settled } from './accounts.js';
import { fits } from './fits.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

type Language = 'ro' | 'en';
type Voice = '1' | '2' | '3' | '4' | '5';

type VoiceTexts = Record<string, unknown> & { cta: string; feat2?: string };

const files = new URL('../../../libs/i18n/src/', import.meta.url);
const read = (area: string, language: Language) =>
  JSON.parse(readFileSync(new URL(`${area}/${language}.json`, files), 'utf8'));
const TEXTS = {
  en: {
    review: read('driver', 'en').review.voices as Record<string, string>,
    voice: read('public', 'en').voice as Record<string, VoiceTexts>,
  },
  ro: {
    review: read('driver', 'ro').review.voices as Record<string, string>,
    voice: read('public', 'ro').voice as Record<string, VoiceTexts>,
  },
};

const VOICES: Voice[] = ['1', '2', '3', '4', '5'];
const LANGUAGES: Language[] = ['ro', 'en'];
const LANGUAGE_GROUP = { en: 'Language', ro: 'Limba' };
const OTHER = { en: 'ro', ro: 'en' } as const;
const SEARCH = { en: 'Search for a brand', ro: 'Caută marca' };

const visible = (page: Page, selector: string) =>
  page.locator(selector).filter({ visible: true });
const headline = (page: Page) => visible(page, 'mf-home .hero h2');

// A phone-sized visit of its own, in the voice under test from the first
// load, near Bucharest so Results has garages to list. The voice is set once:
// a later load keeps whatever the app itself stored. Home takes the next
// voice of the round unless the visit's was taken under 2.5 s before
// (index.html), and a walk that measures Home and loads it again for Results
// passes that on a loaded runner: every load stamps the voice as just taken,
// so the visit keeps it.
async function visiting(
  browser: Browser,
  voice: Voice,
  body: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    geolocation: { latitude: 44.4268, longitude: 26.1025 },
    permissions: ['geolocation'],
    viewport: { height: 640, width: 320 },
  });
  await context.addInitScript((voice) => {
    try {
      if (localStorage.getItem('mf-copy') === null)
        localStorage.setItem('mf-copy', voice);
      localStorage.setItem('mf-copy-at', String(Date.now()));
    } catch {}
  }, voice);
  try {
    await body(await context.newPage());
  } finally {
    // At a timeout Playwright has closed the context already: a failing close
    // must not stand in for the step that was still waiting.
    await context.close().catch(() => undefined);
  }
}

async function home(page: Page, language: Language) {
  await page.goto(`/${language}`);
  await settled(page);
}

async function results(page: Page, voice: Voice, language: Language) {
  await home(page, language);
  await page
    .getByRole('link', { name: TEXTS[language].voice[`v${voice}`].cta })
    .click();
  // Home has a level-one heading too: wait for the Results address first.
  await expect(page).toHaveURL(new RegExp(`/${language}/garages`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settled(page);
}

// The review drawer opens on any driver view from the address; a job that is
// no id opens its "not found" view, whose title is the voice's text.
async function drawer(page: Page) {
  await page.goto('/app/driver?review=none');
  await settled(page);
  return page.getByRole('dialog');
}

async function measure(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  const report = await fits(page);
  expect(report.width, name).toBeLessThanOrEqual(320);
  expect(report.cut, name).toEqual([]);
  expect(report.small, name).toEqual([]);
}

// The line boxes a text takes: one per distinct top among its fragments.
const lines = (locator: Locator, part?: string) =>
  locator.evaluate((el, part) => {
    const range = document.createRange();
    const node = [...el.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
    );
    if (!node) return 0;
    const text = node.textContent ?? '';
    const from = part ? text.indexOf(part) : 0;
    if (from < 0) return 0;
    range.setStart(node, from);
    range.setEnd(node, part ? from + part.length : text.length);
    return new Set(
      [...range.getClientRects()]
        .filter((r) => r.width > 0)
        .map((r) => Math.round(r.top)),
    ).size;
  }, part);

async function choose(page: Page, language: Language, brand: string) {
  await page
    .getByRole('combobox', { name: SEARCH[language] })
    .fill(brand.slice(0, 3).toLowerCase());
  await page.getByRole('option', { exact: true, name: brand }).click();
}

// The brand whose hyphen each voice shows: voice 4 says "your <brand>" in
// Romanian, and of the seeded forms only BMW's carries a hyphen.
const hyphenated = (voice: Voice, language: Language) =>
  voice === '4' && language === 'ro'
    ? { brand: 'BMW', word: 'BMW‑ul' }
    : { brand: 'Mercedes-Benz', word: 'Mercedes‑Benz' };

// The slots of a voice whose words, around their placeholders, all show in
// the page's visible text. Compared without case: a label may be uppercased.
async function shownSlots(page: Page, voice: Voice, language: Language) {
  const words = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
  const screen = words(await page.locator('body').innerText());
  const texts: Record<string, unknown> = {
    ...TEXTS[language].voice[`v${voice}`],
    review: TEXTS[language].review[`v${voice}`],
  };
  return Object.entries(texts)
    .filter(
      ([, text]) =>
        typeof text === 'string' &&
        text
          .split(/\{[^}]*\}/)
          .map((part) => words(part).trim())
          .filter(Boolean)
          .every((part) => screen.includes(part)),
    )
    .map(([slot]) => slot)
    .sort();
}

// Tap the other language; the same voice's slots are on screen, now all in
// that language, and none is left in the first.
async function switchKeepsVoice(page: Page, voice: Voice, from: Language) {
  const to = OTHER[from];
  // Results fills its list after the page settles: read the slots once two
  // reads half a second apart agree.
  let before: string[] = [];
  await expect
    .poll(
      async () => {
        const seen = await shownSlots(page, voice, from);
        const same = seen.length > 0 && seen.join() === before.join();
        before = seen;
        return same;
      },
      { intervals: [500] },
    )
    .toBe(true);

  await page
    .getByRole('group', { name: LANGUAGE_GROUP[from] })
    .getByRole('button', { name: to.toUpperCase() })
    .click();

  await expect(page.locator('html')).toHaveAttribute('lang', to);
  await expect(page.locator('html')).toHaveAttribute('data-voice', voice);
  await expect.poll(() => shownSlots(page, voice, to)).toEqual(before);
  expect(await shownSlots(page, voice, from)).toEqual([]);
}

test.describe('every voice on a 320 px phone @seeded', () => {
  // @traces 008-FR-002
  // @traces 008-FR-008
  // @traces 008-FR-010
  for (const voice of VOICES)
    for (const language of LANGUAGES)
      test(`voice ${voice} in ${language === 'ro' ? 'Romanian' : 'English'} fits Home, Results and the review drawer`, async ({
        browser,
      }, testInfo) => {
        await visiting(browser, voice, async (page) => {
          const name = `voice-${voice}-${language}`;

          await home(page, language);
          await expect(page.locator('html')).toHaveAttribute(
            'data-voice',
            voice,
          );
          await expect(headline(page)).toHaveCount(1);
          await measure(page, testInfo, `${name}-home`);
          // Voices without a second benefits line leave no empty line for it.
          await expect(page.locator('#how-it-works-title .second')).toHaveCount(
            TEXTS[language].voice[`v${voice}`].feat2 ? 1 : 0,
          );

          await results(page, voice, language);
          await measure(page, testInfo, `${name}-results`);

          await signInAs(page, 'driver', '/app/driver', [], language);
          const dialog = await drawer(page);
          await expect(dialog).toContainText(
            TEXTS[language].review[`v${voice}`],
          );
          await measure(page, testInfo, `${name}-review`);
        });
      });

  // @traces 008-FR-003
  // @traces 008-FR-004
  // @traces 008-FR-006
  test('voice 4 in Romanian wraps its label on two lines and its headline in four, the brand whole', async ({
    browser,
  }) => {
    await visiting(browser, '4', async (page) => {
      await home(page, 'ro');
      const hero = visible(page, 'mf-home .hero [data-voice-of="4"]');

      expect(await lines(hero.locator('.label'))).toBe(2);
      // A phone reads the label at body size, never the 12 px label type.
      expect(
        await hero
          .locator('.label')
          .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      // The headline keeps the mock's Michroma capitals (FR-006).
      expect(
        await headline(page).evaluate((e) => {
          const s = getComputedStyle(e);
          return [
            s.fontFamily.split(',')[0].replace(/["']/g, ''),
            s.textTransform,
          ];
        }),
      ).toEqual(['Michroma', 'uppercase']);
      for (const [brand, shown] of [
        ['BMW', 'BMW‑ul tău'],
        ['Mercedes-Benz', 'Mercedesul tău'],
      ]) {
        await choose(page, 'ro', brand);
        await expect(headline(page)).toContainText(shown);
        expect(await lines(headline(page))).toBeLessThanOrEqual(4);
        expect(await lines(headline(page), shown.split(' ')[0])).toBe(1);
      }
    });
  });

  // @traces 008-FR-004
  test('a hyphenated brand is never split across lines, in any voice or language', async ({
    browser,
  }) => {
    for (const voice of VOICES)
      await visiting(browser, voice, async (page) => {
        for (const language of LANGUAGES) {
          const { brand, word } = hyphenated(voice, language);
          await home(page, language);
          await choose(page, language, brand);
          // Voice 5 names the brand in the paragraph under the headline.
          const carrier = visible(
            page,
            'mf-home .hero :is(h2, p:not(.label))',
          ).filter({
            hasText: word,
          });
          await expect(carrier).toHaveCount(1);
          expect(await lines(carrier, word)).toBe(1);
        }
      });
  });

  // @traces 008-FR-005
  test('a language switch keeps the voice and turns every voice text, on Home, Results and the review drawer', async ({
    browser,
  }) => {
    await visiting(browser, '2', async (page) => {
      await home(page, 'ro');
      await switchKeepsVoice(page, '2', 'ro');
      await switchKeepsVoice(page, '2', 'en');

      await results(page, '2', 'ro');
      await switchKeepsVoice(page, '2', 'ro');
      await switchKeepsVoice(page, '2', 'en');

      // The drawer is modal, so the switch is tapped on the dashboard and
      // the drawer opened again: its title follows the account's language.
      await signInAs(page, 'driver', '/app/driver', [], 'ro');
      await expect(await drawer(page)).toContainText(TEXTS.ro.review['v2']);
      await page.goto('/app/driver');
      await settled(page);
      await page
        .getByRole('group', { name: LANGUAGE_GROUP.ro })
        .getByRole('button', { name: 'EN' })
        .click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(await drawer(page)).toContainText(TEXTS.en.review['v2']);
      await expect(page.locator('html')).toHaveAttribute('data-voice', '2');
    });
  });
});
