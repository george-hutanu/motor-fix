import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page } from '@playwright/test';

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

async function openCockpit(page: Page, language: Language = 'ro') {
  if (language === 'en')
    await page.addInitScript(() => localStorage.setItem('mf.lang', 'en'));
  await page.goto('/cockpit');
  await expect(
    page.getByRole('button', {
      name: t(language, 'cockpit.overlay.openDialog'),
    }),
  ).toBeVisible();
  // Hydrated: the remembered language and the click handlers are in.
  await page.waitForLoadState('networkidle');
}

// The cockpit reached from Home, so one Back too many leaves it.
async function fromHome(page: Page) {
  await page.goto('/ro');
  const home = page.url();
  await openCockpit(page);
  return home;
}

const opener = (page: Page, key: string, language: Language = 'ro') =>
  page.getByRole('button', { exact: true, name: t(language, key) });

const task = (page: Page, language: Language = 'ro') =>
  page.getByRole('dialog', { name: t(language, 'cockpit.overlay.title') });

const field = (page: Page) =>
  task(page).getByLabel(t('ro', 'cockpit.overlay.field')).last();

// The panel, once its pop has finished (the dialog container itself has no box).
async function shown(page: Page, language: Language = 'ro') {
  await expect(
    task(page, language).locator('mf-overlay-panel').last(),
  ).toBeVisible();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) =>
        (
          (a.effect as KeyframeEffect | null)?.target as Element | null
        )?.closest('.cdk-overlay-container'),
      )
      .every((a) => a.playState !== 'running'),
  );
}

async function open(page: Page, key = 'cockpit.overlay.openDialog') {
  await opener(page, key).click();
  await shown(page);
}

// A wheel scroll runs on for a moment after the wheel; closing before it ends
// lets the rest land on the page once the scroll lock lifts.
const wheelSettled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        document.addEventListener('scrollend', () => done(), { once: true });
        setTimeout(done, 1000);
      }),
  );

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
// While the page is locked the root is pinned at minus its scroll position.
const lockedAt = (page: Page) =>
  page.evaluate(() => -Number.parseFloat(document.documentElement.style.top));
const focusedInsideTask = (page: Page) =>
  page.evaluate(
    () =>
      !!document.activeElement?.closest('.cdk-overlay-pane [role="dialog"]'),
  );

test.describe('a task over the page', () => {
  for (const [how, close] of [
    ['Escape', (page: Page) => page.keyboard.press('Escape')],
    ['a click outside', (page: Page) => page.mouse.click(4, 4)],
    [
      'the X',
      (page: Page) =>
        task(page)
          .getByRole('button', {
            exact: true,
            name: t('ro', 'shell.overlay.close'),
          })
          .click(),
    ],
  ] as const) {
    test(`closes with ${how}, leaving the address, the scroll and the focus as they were`, async ({
      page,
    }) => {
      const home = await fromHome(page);
      const button = opener(page, 'cockpit.overlay.openDialog');
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 120));
      const address = page.url();
      const before = await scrollY(page);
      expect(before).toBeGreaterThan(0);

      await button.click();
      await shown(page);
      await page.mouse.wheel(0, 600);
      await wheelSettled(page);
      await expect.poll(() => lockedAt(page)).toBe(before);
      expect(page.url()).toBe(address);

      await close(page);
      await expect(task(page)).toHaveCount(0);
      expect(page.url()).toBe(address);
      expect(await scrollY(page)).toBe(before);
      await expect(button).toBeFocused();
      await expect(page.locator('.mf-overlay-result')).toContainText(
        t('ro', 'cockpit.overlay.results.cancelled'),
      );

      await page.goBack();
      await expect(page).toHaveURL(home);
    });
  }

  test('is a centred modal dialog named by its title, its X named Închide, the backdrop dimmed', async ({
    page,
  }) => {
    await openCockpit(page);
    await open(page);

    const dialog = task(page);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(
      dialog.getByRole('button', { exact: true, name: 'Închide' }),
    ).toBeVisible();
    const box = await dialog.locator('mf-overlay-panel').boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('no layout');
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(
      2,
    );
    expect(box.width).toBe(480);
    await expect(page.locator('.cdk-overlay-backdrop')).not.toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
  });

  test('puts the focus on the first field and keeps it inside for 20 Tabs and Shift+Tabs', async ({
    page,
  }) => {
    await openCockpit(page);
    await open(page);

    await expect(field(page)).toBeFocused();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect(await focusedInsideTask(page)).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusedInsideTask(page)).toBe(true);
    }
  });

  test('hands the opener the result the task closes with', async ({ page }) => {
    await openCockpit(page);
    await open(page);

    await task(page)
      .getByRole('button', {
        exact: true,
        name: t('ro', 'cockpit.overlay.done'),
      })
      .click();

    await expect(task(page)).toHaveCount(0);
    await expect(page.locator('.mf-overlay-result')).toContainText(
      t('ro', 'cockpit.overlay.results.saved'),
    );
  });

  test('says a task did not load and loads it on Retry', async ({ page }) => {
    await openCockpit(page);
    await opener(page, 'cockpit.overlay.openFailing').click();
    const failing = page.getByRole('dialog', {
      name: t('ro', 'cockpit.overlay.failing'),
    });

    await expect(failing.getByRole('alert')).toHaveText(
      t('ro', 'shell.form.problem.error'),
    );
    await failing
      .getByRole('button', {
        exact: true,
        name: t('ro', 'shell.overlay.retry'),
      })
      .click();

    await expect(failing.getByRole('alert')).toHaveCount(0);
    await expect(
      failing.getByLabel(t('ro', 'cockpit.overlay.field')),
    ).toBeVisible();
    await failing
      .getByRole('button', { name: t('ro', 'shell.overlay.close') })
      .click();
    await expect(failing).toHaveCount(0);
  });
});

test.describe('the drawer', () => {
  for (const [key, width] of [
    ['cockpit.overlay.openDrawer', 480],
    ['cockpit.overlay.openWide', 720],
  ] as const) {
    test(`comes in on the right, full height, ${width} px wide on a computer`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: 800, width: 1280 });
      await openCockpit(page);
      await open(page, key);

      const box = await task(page).locator('mf-overlay-panel').boundingBox();
      expect(box).toEqual({ height: 800, width, x: 1280 - width, y: 0 });
    });
  }
});

test.describe('changed fields', () => {
  test('ask before closing; keep editing keeps the text, discard closes', async ({
    page,
  }) => {
    await openCockpit(page);
    await open(page);
    await field(page).fill('B 123 ABC');

    await page.keyboard.press('Escape');
    const question = page.getByRole('alertdialog', {
      name: t('ro', 'shell.overlay.discard.question'),
    });
    await expect(question).toBeVisible();

    await question
      .getByRole('button', { name: t('ro', 'shell.overlay.discard.keep') })
      .click();
    await expect(question).toHaveCount(0);
    await expect(field(page)).toHaveValue('B 123 ABC');

    await page.mouse.click(4, 4);
    await expect(question).toBeVisible();
    await question
      .getByRole('button', { name: t('ro', 'shell.overlay.discard.discard') })
      .click();
    await expect(task(page)).toHaveCount(0);
    await expect(page.locator('.mf-overlay-result')).toContainText(
      t('ro', 'cockpit.overlay.results.cancelled'),
    );
  });
});

test.describe('stacked tasks', () => {
  test('a second task opens on top; Escape closes only the top one', async ({
    page,
  }) => {
    await openCockpit(page);
    await open(page);

    await task(page)
      .getByRole('button', {
        exact: true,
        name: t('ro', 'cockpit.overlay.again'),
      })
      .click();
    await expect(task(page)).toHaveCount(2);

    await page.keyboard.press('Escape');
    await expect(task(page)).toHaveCount(1);
    expect(await focusedInsideTask(page)).toBe(true);
  });
});

test.describe('the browser’s Back button', () => {
  for (const key of [
    'cockpit.overlay.openDialog',
    'cockpit.overlay.openDrawer',
  ]) {
    test(`closes the task opened by ${key} and keeps the page, its address, scroll and focus`, async ({
      page,
    }) => {
      await openCockpit(page);
      const button = opener(page, key);
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 120));
      const address = page.url();
      const before = await scrollY(page);
      const result = page.locator('.mf-overlay-result');
      await result.evaluate((node) => {
        (globalThis as { pageNode?: Element }).pageNode = node;
      });
      await button.click();
      await shown(page);

      await page.goBack();

      await expect(task(page)).toHaveCount(0);
      expect(page.url()).toBe(address);
      expect(await scrollY(page)).toBe(before);
      await expect(button).toBeFocused();
      await expect(result).toContainText(
        t('ro', 'cockpit.overlay.results.cancelled'),
      );
      expect(
        await result.evaluate(
          (node) => (globalThis as { pageNode?: Element }).pageNode === node,
        ),
      ).toBe(true);

      await page.goForward();
      await expect(task(page)).toHaveCount(0);
      expect(page.url()).toBe(address);
    });
  }

  test('closes stacked tasks one at a time, the top one first', async ({
    page,
  }) => {
    await openCockpit(page);
    await open(page);
    await task(page)
      .getByRole('button', {
        exact: true,
        name: t('ro', 'cockpit.overlay.again'),
      })
      .click();
    await expect(task(page)).toHaveCount(2);

    await page.goBack();
    await expect(task(page)).toHaveCount(1);
    expect(await focusedInsideTask(page)).toBe(true);

    await page.goBack();
    await expect(task(page)).toHaveCount(0);
  });

  test('after a task closes with its result, one Back leaves the page', async ({
    page,
  }) => {
    const home = await fromHome(page);
    await open(page);
    await task(page)
      .getByRole('button', {
        exact: true,
        name: t('ro', 'cockpit.overlay.done'),
      })
      .click();
    await expect(task(page)).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(home);
  });

  test('asks first on a changed task, again on each Back, until kept or discarded', async ({
    page,
  }) => {
    const home = await fromHome(page);
    await open(page);
    await field(page).fill('B 123 ABC');
    const question = page.getByRole('alertdialog', {
      name: t('ro', 'shell.overlay.discard.question'),
    });

    await page.goBack();
    await expect(question).toBeVisible();
    await page.goBack();
    await expect(question).toBeVisible();
    await expect(task(page)).toHaveCount(1);

    await question
      .getByRole('button', { name: t('ro', 'shell.overlay.discard.keep') })
      .click();
    await expect(question).toHaveCount(0);
    await expect(field(page)).toHaveValue('B 123 ABC');

    await page.goBack();
    await question
      .getByRole('button', { name: t('ro', 'shell.overlay.discard.discard') })
      .click();
    await expect(task(page)).toHaveCount(0);
    await expect(page.locator('.mf-overlay-result')).toContainText(
      t('ro', 'cockpit.overlay.results.cancelled'),
    );

    await page.goBack();
    await expect(page).toHaveURL(home);
  });
});

test.describe('in English', () => {
  test('the task, its X and the discard question read in English', async ({
    page,
  }) => {
    await openCockpit(page, 'en');
    await opener(page, 'cockpit.overlay.openDialog', 'en').click();
    const dialog = task(page, 'en');
    await shown(page, 'en');
    await expect(
      dialog.getByRole('button', { exact: true, name: 'Close' }),
    ).toBeVisible();

    await dialog.getByLabel(t('en', 'cockpit.overlay.field')).fill('B 123 ABC');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('alertdialog', { name: 'Discard your changes?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: 'Keep editing' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: 'Discard' }),
    ).toBeVisible();
  });
});

test.describe('accessibility', () => {
  for (const colorScheme of ['dark', 'light'] as const) {
    for (const language of ['ro', 'en'] as const) {
      test(`an open dialog and drawer pass axe, ${colorScheme}, ${language}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await openCockpit(page, language);
        await page.evaluate(AXE);

        for (const key of [
          'cockpit.overlay.openDialog',
          'cockpit.overlay.openDrawer',
        ]) {
          await opener(page, key, language).click();
          await shown(page, language);
          const violations = await page.evaluate(async () => {
            const axe = (globalThis as unknown as { axe: Axe }).axe;
            const result = await axe.run({
              include: [['.cdk-overlay-container']],
            });
            return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
          });
          expect(violations).toEqual([]);
          await page.keyboard.press('Escape');
          await expect(task(page, language)).toHaveCount(0);
        }
      });
    }
  }
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the dialog and the drawer open and close with nothing moving', async ({
    page,
  }) => {
    await openCockpit(page);
    for (const key of [
      'cockpit.overlay.openDialog',
      'cockpit.overlay.openDrawer',
    ]) {
      await open(page, key);
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(
        0,
      );
      await page.keyboard.press('Escape');
      await expect(task(page)).toHaveCount(0);
    }
  });
});
