import { readdirSync, readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { signInAs } from './sign-in.js';

type Language = 'ro' | 'en';
interface Texts {
  [key: string]: string | Texts;
}

const files = new URL('../../../libs/i18n/src/', import.meta.url);

const values = (texts: Texts): string[] =>
  Object.values(texts).flatMap((v) =>
    typeof v === 'string' ? [v] : values(v),
  );

const textsOf = (language: Language) =>
  new Set(
    readdirSync(files, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) =>
        values(
          JSON.parse(
            readFileSync(new URL(`${e.name}/${language}.json`, files), 'utf8'),
          ) as Texts,
        ),
      )
      // A text with a placeholder never shows as written in the file.
      .filter((text) => !text.includes('{'))
      .map((text) => text.replace(/\s+/g, ' ').trim()),
  );

const TEXTS = { en: textsOf('en'), ro: textsOf('ro') };
// What only the other language's files say; a word both share ("Service") is
// not a sign of the other language.
const onlyIn = (other: Language, own: Language) =>
  new Set([...TEXTS[other]].filter((text) => !TEXTS[own].has(text)));
const FOREIGN = { en: onlyIn('ro', 'en'), ro: onlyIn('en', 'ro') };

const screens: { path: string; language: Language; role?: string }[] = [
  { language: 'ro', path: '/ro' },
  { language: 'en', path: '/en' },
  { language: 'ro', path: '/ro/nu-exista' },
  { language: 'en', path: '/en/no-such-page' },
  ...(['ro', 'en'] as const).flatMap((language) => [
    { language, path: '/cockpit' },
    { language, path: '/app/driver', role: 'driver' },
    { language, path: '/app/garage', role: 'garage' },
    { language, path: '/app/admin', role: 'admin' },
  ]),
];

async function open(
  page: Page,
  { language, path, role }: (typeof screens)[number],
) {
  if (role) await signInAs(page, role, path);
  if (path === '/cockpit')
    await page.addInitScript(
      (lang) => localStorage.setItem('mf.lang', lang),
      language,
    );
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // A dashboard opens in the account's language; English is chosen on it.
  if (role && language === 'en') {
    await page
      .getByRole('group', { name: 'Limba' })
      .getByRole('button', { name: 'EN' })
      .click();
    // <html lang> changes before the view renders the new texts.
    await expect(page.getByRole('group', { name: 'Language' })).toBeVisible();
  }
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

// Every visible text and person-facing label outside text shown as written.
const shownTexts = (page: Page) =>
  page.evaluate(() => {
    const shown = (el: Element) =>
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('[translate="no"]');
    const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
    const elements = [...document.body.querySelectorAll('*')].filter(shown);
    return [
      ...new Set(
        [
          ...elements.flatMap((el) =>
            [...el.childNodes]
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => tidy(n.textContent ?? '')),
          ),
          ...elements.map((el) => tidy(el.textContent ?? '')),
          ...elements.flatMap((el) =>
            ['aria-label', 'title', 'placeholder', 'alt'].map((name) =>
              tidy(el.getAttribute(name) ?? ''),
            ),
          ),
        ].filter(Boolean),
      ),
    ];
  });

for (const screen of screens) {
  const { language, path } = screen;

  test.describe(`${path} in ${language === 'ro' ? 'Romanian' : 'English'}`, () => {
    test('shows no interface text of the other language', async ({ page }) => {
      await open(page, screen);

      const mixed = (await shownTexts(page)).filter((text) =>
        FOREIGN[language].has(text),
      );

      expect(mixed).toEqual([]);
    });

    test('fits 320 px: no sideways scroll, no text cut by its box, nothing under 12 px', async ({
      page,
    }) => {
      await page.setViewportSize({ height: 640, width: 320 });
      await open(page, screen);

      const report = await page.evaluate(() => {
        const texts = [
          ...document.body.querySelectorAll('*:not(script, style)'),
        ]
          .filter(
            (el) =>
              el.getClientRects().length > 0 &&
              getComputedStyle(el).visibility !== 'hidden' &&
              [...el.childNodes].some(
                (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
              ),
          )
          .map((el) => ({
            cut:
              getComputedStyle(el).display !== 'inline' &&
              el.getBoundingClientRect().width > 1 &&
              el.scrollWidth > el.clientWidth + 1,
            label: `${el.tagName} "${el.textContent?.trim()}"`,
            size: Number.parseFloat(getComputedStyle(el).fontSize),
          }));
        return {
          cut: texts.filter((t) => t.cut).map((t) => t.label),
          small: texts.filter((t) => t.size < 12).map((t) => t.label),
          width: document.documentElement.scrollWidth,
        };
      });

      expect(report.width).toBeLessThanOrEqual(320);
      expect(report.cut).toEqual([]);
      expect(report.small).toEqual([]);
    });
  });
}

test('the dashboard shows the signed-in name as written in English', async ({
  page,
}) => {
  await open(page, { language: 'en', path: '/app/driver', role: 'driver' });

  await expect(
    page.locator('[translate="no"]', { hasText: 'Test driver' }),
  ).toBeVisible();
});
