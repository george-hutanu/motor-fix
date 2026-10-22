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

interface VoiceTexts {
  cta: string;
  feat2?: string;
}

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

const visible = (page: Page, selector: string) =>
  page.locator(selector).filter({ visible: true });
const headline = (page: Page) => visible(page, 'mf-home .hero h2');

// A phone-sized visit of its own, in the voice under test from the first
// load, near Bucharest so Results has garages to list.
async function visit(browser: Browser, voice: Voice): Promise<Page> {
  const context = await browser.newContext({
    geolocation: { latitude: 44.4268, longitude: 26.1025 },
    permissions: ['geolocation'],
    viewport: { height: 640, width: 320 },
  });
  await context.addInitScript((voice) => {
    try {
      localStorage.setItem('mf-copy', voice);
      localStorage.setItem('mf-copy-at', String(Date.now()));
    } catch {}
  }, voice);
  return context.newPage();
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
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settled(page);
}

// The review drawer opens on any driver view from the address; a job that is
// no id opens its "not found" view, whose title is the voice's text.
async function drawer(page: Page, language: Language) {
  await signInAs(page, 'driver', '/app/driver', [], language);
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

async function choose(page: Page, label: string, brand: string) {
  await page
    .getByRole('combobox', { name: label })
    .fill(brand.slice(0, 3).toLowerCase());
  await page.getByRole('option', { exact: true, name: brand }).click();
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
        const page = await visit(browser, voice);
        const name = `voice-${voice}-${language}`;

        await home(page, language);
        await expect(page.locator('html')).toHaveAttribute('data-voice', voice);
        await expect(headline(page)).toHaveCount(1);
        await measure(page, testInfo, `${name}-home`);
        // Voices without a second benefits line leave no empty line for it.
        await expect(page.locator('#how-it-works-title .second')).toHaveCount(
          TEXTS[language].voice[`v${voice}`].feat2 ? 1 : 0,
        );

        await results(page, voice, language);
        await measure(page, testInfo, `${name}-results`);

        const dialog = await drawer(page, language);
        await expect(dialog).toContainText(TEXTS[language].review[`v${voice}`]);
        await measure(page, testInfo, `${name}-review`);
        await page.context().close();
      });

  // @traces 008-FR-003
  // @traces 008-FR-004
  test('voice 4 in Romanian wraps its label on two lines and its headline in four, the brand whole', async ({
    browser,
  }) => {
    const page = await visit(browser, '4');
    await home(page, 'ro');
    const hero = visible(page, 'mf-home .hero [data-voice-of="4"]');

    expect(await lines(hero.locator('.label'))).toBe(2);
    for (const [brand, shown] of [
      ['BMW', 'BMW‑ul'],
      ['Mercedes-Benz', 'Mercedes‑Benz'],
    ]) {
      await choose(page, 'Caută marca', brand);
      await expect(headline(page)).toContainText(shown);
      expect(await lines(headline(page))).toBeLessThanOrEqual(4);
      expect(await lines(headline(page), shown)).toBe(1);
    }
    await page.context().close();
  });

  // @traces 008-FR-004
  test('a hyphenated brand is never split across lines, in any voice or language', async ({
    browser,
  }) => {
    for (const voice of VOICES) {
      const page = await visit(browser, voice);
      for (const language of LANGUAGES) {
        await home(page, language);
        await choose(
          page,
          language === 'ro' ? 'Caută marca' : 'Search for a brand',
          'Mercedes-Benz',
        );
        await expect(headline(page)).toContainText('Mercedes‑Benz');
        expect(await lines(headline(page), 'Mercedes‑Benz')).toBe(1);
      }
      await page.context().close();
    }
  });

  // @traces 008-FR-005
  test('a language switch keeps the voice and turns every voice text', async ({
    browser,
  }) => {
    const page = await visit(browser, '2');
    await home(page, 'ro');
    const before = (await headline(page).textContent())?.trim();

    await page
      .getByRole('group', { name: LANGUAGE_GROUP.ro })
      .getByRole('button', { name: OTHER.ro.toUpperCase() })
      .click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-voice', '2');
    await expect(headline(page)).not.toHaveText(before ?? '');
    await expect(
      page.getByRole('link', { name: TEXTS.en.voice['v2'].cta }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: TEXTS.ro.voice['v2'].cta }),
    ).toHaveCount(0);

    await page
      .getByRole('group', { name: LANGUAGE_GROUP.en })
      .getByRole('button', { name: OTHER.en.toUpperCase() })
      .click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
    await expect(page.locator('html')).toHaveAttribute('data-voice', '2');
    await expect(headline(page)).toHaveText(before ?? '');
    await page.context().close();
  });
});
