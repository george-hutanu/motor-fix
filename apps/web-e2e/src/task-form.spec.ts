import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';

type Language = 'ro' | 'en';
type Texts = Record<string, unknown>;

const read = (path: string): Texts =>
  JSON.parse(
    readFileSync(
      new URL(`../../../libs/i18n/src/${path}`, import.meta.url),
      'utf8',
    ),
  );
const TEXTS = {
  en: { cockpit: read('cockpit/en.json'), shell: read('shell/en.json') },
  ro: { cockpit: read('cockpit/ro.json'), shell: read('shell/ro.json') },
};
const t = (language: Language, key: string): string =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Texts)[part],
      TEXTS[language],
    ) as string;

type Axe = {
  run: (context: unknown) => Promise<{
    violations: Array<{ id: string; nodes: unknown[] }>;
  }>;
};

const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

async function openForm(page: Page, language: Language = 'ro') {
  if (language === 'en')
    await page.addInitScript(() => localStorage.setItem('mf.lang', 'en'));
  await page.goto('/cockpit');
  const opener = page.getByRole('button', {
    exact: true,
    name: t(language, 'cockpit.form.open'),
  });
  await expect(opener).toBeVisible();
  await settled(page);
  await opener.click();
  // The panel: on a phone the dialog container around the sheet has no box.
  await expect(task(page, language).locator('mf-overlay-panel')).toBeVisible();
}

const task = (page: Page, language: Language = 'ro') =>
  page.getByRole('dialog', { name: t(language, 'cockpit.form.title') });
const plate = (page: Page, language: Language = 'ro') =>
  task(page, language).getByLabel(t(language, 'cockpit.form.plate'));
const save = (page: Page, language: Language = 'ro') =>
  task(page, language).locator('button[type="submit"]');
const errorLine = (page: Page) => task(page).locator('mf-task-error');

async function answer(page: Page, key: string, language: Language = 'ro') {
  await task(page, language)
    .getByLabel(t(language, 'cockpit.form.answer'))
    .selectOption({ label: t(language, `cockpit.form.answers.${key}`) });
}

test.describe('a small task saves once', () => {
  test('an empty press explains the field, focuses it and saves nothing', async ({
    page,
  }) => {
    await openForm(page);
    await save(page).click();

    await expect(task(page)).toContainText(
      t('ro', 'shell.form.field.required'),
    );
    await expect(plate(page)).toBeFocused();
    await expect(plate(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.mf-form-result')).toContainText(
      t('ro', 'cockpit.form.none'),
    );
  });

  test('the button is busy while saving and ten more presses change nothing; the page already shows the value', async ({
    page,
  }) => {
    await openForm(page);
    await plate(page).fill('B 123 ABC');
    await save(page).click();

    await expect(save(page)).toHaveAttribute('aria-busy', 'true');
    await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
    for (let i = 0; i < 10; i++) await save(page).click({ force: true });

    await expect(task(page)).toHaveCount(0);
    await expect(page.locator('.mf-form-result')).toContainText('B 123 ABC');
    await expect(page.locator('.mf-form-saves')).toHaveText('1');
  });

  test('the confirmation ending shows the sentence and Close', async ({
    page,
  }) => {
    await openForm(page);
    await task(page)
      .getByLabel(t('ro', 'cockpit.form.ending'))
      .selectOption({ label: t('ro', 'cockpit.form.endings.confirm') });
    await plate(page).fill('B 123 ABC');
    await save(page).click();

    await expect(task(page).getByRole('status')).toHaveText(
      t('ro', 'cockpit.form.saved'),
    );
    const close = task(page)
      .locator('mf-task-done')
      .getByRole('button', {
        exact: true,
        name: t('ro', 'shell.form.done'),
      });
    await expect(close).toBeFocused();
    await expect(page.locator('.mf-form-result')).toContainText('B 123 ABC');
    await close.click();
    await expect(task(page)).toHaveCount(0);
  });
});

test.describe('a refused or failed save', () => {
  for (const [key, message] of [
    ['conflict', 'shell.form.problem.conflict'],
    ['server', 'shell.form.problem.internal_error'],
    ['network', 'shell.form.problem.network'],
  ] as const) {
    test(`${key}: the message shows next to the button and the text stays`, async ({
      page,
    }) => {
      await openForm(page);
      await answer(page, key);
      await plate(page).fill('B 123 ABC');
      await save(page).click();

      await expect(errorLine(page)).toHaveText(t('ro', message));
      await expect(plate(page)).toHaveValue('B 123 ABC');
      await expect(save(page)).not.toHaveAttribute('aria-busy', 'true');
    });
  }

  test('a field error shows under the field, focuses it, and clears as it changes', async ({
    page,
  }) => {
    await openForm(page);
    await answer(page, 'field');
    await plate(page).fill('B 123 ABC');
    await save(page).click();

    await expect(task(page)).toContainText(
      t('ro', 'cockpit.form.messages.field.plate_taken'),
    );
    await expect(errorLine(page)).toHaveText(
      t('ro', 'shell.form.problem.validation_failed'),
    );
    await expect(plate(page)).toBeFocused();
    await expect(plate(page)).toHaveValue('B 123 ABC');

    await plate(page).fill('B 124 ABC');
    await expect(task(page)).not.toContainText(
      t('ro', 'cockpit.form.messages.field.plate_taken'),
    );
  });

  test('a retry after a failure saves', async ({ page }) => {
    await openForm(page);
    await answer(page, 'server');
    await plate(page).fill('B 123 ABC');
    await save(page).click();
    await expect(errorLine(page)).toHaveText(
      t('ro', 'shell.form.problem.internal_error'),
    );

    await answer(page, 'ok');
    await save(page).click();
    await expect(task(page)).toHaveCount(0);
    await expect(page.locator('.mf-form-result')).toContainText('B 123 ABC');
  });
});

test.describe('in English', () => {
  test('the messages read in English', async ({ page }) => {
    await openForm(page, 'en');
    await save(page, 'en').click();
    await expect(task(page, 'en')).toContainText('This field is required.');

    await answer(page, 'conflict', 'en');
    await plate(page, 'en').fill('B 123 ABC');
    await save(page, 'en').click();
    await expect(task(page, 'en').locator('mf-task-error')).toHaveText(
      t('en', 'shell.form.problem.conflict'),
    );
  });
});

test.describe('on a phone', () => {
  for (const width of [320, 390]) {
    test(`at ${width} px the failed form fits without sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 700, width });
      await openForm(page);
      await answer(page, 'conflict');
      await plate(page).fill('B 123 ABC');
      await save(page).click();
      await expect(errorLine(page)).toBeVisible();

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const box = await save(page).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    });
  }
});

test.describe('accessibility', () => {
  for (const colorScheme of ['dark', 'light'] as const) {
    test(`the invalid and failed form pass axe, ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await openForm(page);
      await page.evaluate(AXE);
      const scan = () =>
        page.evaluate(async () => {
          const axe = (globalThis as unknown as { axe: Axe }).axe;
          const result = await axe.run({
            include: [['.cdk-overlay-container']],
          });
          return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
        });

      await save(page).click();
      await expect(task(page)).toContainText(
        t('ro', 'shell.form.field.required'),
      );
      expect(await scan()).toEqual([]);

      await answer(page, 'server');
      await plate(page).fill('B 123 ABC');
      await save(page).click();
      await expect(errorLine(page)).toBeVisible();
      expect(await scan()).toEqual([]);
    });
  }
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the busy button does not spin', async ({ page }) => {
    await openForm(page);
    await plate(page).fill('B 123 ABC');
    await save(page).click();
    await expect(save(page)).toHaveAttribute('aria-busy', 'true');

    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});
