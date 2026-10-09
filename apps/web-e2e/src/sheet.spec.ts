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

const SHAPES = [
  'cockpit.overlay.openDialog',
  'cockpit.overlay.openDrawer',
  'cockpit.overlay.openWide',
] as const;

async function openCockpit(
  page: Page,
  width: number,
  height: number,
  language: Language = 'ro',
) {
  await page.setViewportSize({ height, width });
  if (language === 'en')
    await page.addInitScript(() => localStorage.setItem('mf.lang', 'en'));
  await page.goto('/cockpit');
  await expect(opener(page, SHAPES[0], language)).toBeVisible();
  await settled(page);
}

const opener = (page: Page, key: string, language: Language = 'ro') =>
  page.getByRole('button', { exact: true, name: t(language, key) });

const task = (page: Page, language: Language = 'ro') =>
  page.getByRole('dialog', { name: t(language, 'cockpit.overlay.title') });
const sheet = (page: Page, language: Language = 'ro') =>
  task(page, language).locator('mf-overlay-panel');

// Two frames for a class change to start its pop or spring, then every
// animation inside the overlay container has finished.
const still = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) =>
          (
            (a.effect as KeyframeEffect | null)?.target as Element | null
          )?.closest('.cdk-overlay-container'),
        )
        .map((a) => a.finished.catch(() => undefined)),
    );
  });

async function open(page: Page, key: string, language: Language = 'ro') {
  await opener(page, key, language).scrollIntoViewIfNeeded();
  await opener(page, key, language).click();
  await expect(page.locator('mf-overlay-panel').last()).toBeVisible();
  await still(page);
}

async function box(page: Page) {
  const found = await sheet(page).boundingBox();
  if (!found) throw new Error('no sheet');
  return found;
}

async function dragGrip(page: Page, by: number) {
  const grip = await sheet(page).locator('.mf-overlay-grip').boundingBox();
  if (!grip) throw new Error('no grip');
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + by / 2, { steps: 4 });
  await page.mouse.move(x, y + by, { steps: 4 });
  await page.mouse.up();
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

const result = (page: Page) => page.locator('.mf-overlay-result');

test.describe('on a phone, every task is a bottom sheet', () => {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
  ] as const) {
    test(`at ${width} × ${height} the dialog, drawer and wide drawer rise as a full-width sheet with a grip, at most 92 % tall`, async ({
      page,
    }) => {
      await openCockpit(page, width, height);

      for (const key of SHAPES) {
        await open(page, key);
        const found = await box(page);
        expect(Math.round(found.width)).toBe(width);
        expect(Math.round(found.x)).toBe(0);
        expect(Math.round(found.y + found.height)).toBe(height);
        expect(found.height).toBeLessThanOrEqual(height * 0.92 + 0.5);
        await expect(sheet(page)).toHaveAttribute('data-side', 'bottom');

        const grip = sheet(page).locator('.mf-overlay-grip');
        await expect(grip).toHaveAttribute('aria-hidden', 'true');
        const row = await grip.boundingBox();
        expect(row?.height).toBeGreaterThanOrEqual(44);
        const bar = await grip.evaluate((element) => {
          const style = getComputedStyle(element, '::before');
          return [style.width, style.height];
        });
        expect(bar).toEqual(['36px', '4px']);

        const close = await task(page)
          .getByRole('button', { exact: true, name: 'Închide' })
          .boundingBox();
        expect(close?.width).toBeGreaterThanOrEqual(44);
        expect(close?.height).toBeGreaterThanOrEqual(44);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.keyboard.press('Escape');
        await expect(task(page)).toHaveCount(0);
      }
    });
  }

  test('767 px is a phone; 768 px, a tablet and a computer keep the dialog and the drawer', async ({
    page,
  }) => {
    await openCockpit(page, 767, 900);
    await open(page, SHAPES[0]);
    await expect(sheet(page)).toHaveAttribute('data-side', 'bottom');
    await page.keyboard.press('Escape');
    await expect(task(page)).toHaveCount(0);

    for (const width of [768, 1024, 1280]) {
      await page.setViewportSize({ height: 900, width });
      await open(page, SHAPES[0]);
      await expect(sheet(page)).toHaveClass(/mf-overlay-dialog/);
      await expect(sheet(page).locator('.mf-overlay-grip')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(task(page)).toHaveCount(0);
      await open(page, SHAPES[1]);
      await expect(sheet(page)).toHaveAttribute('data-side', 'right');
      await page.keyboard.press('Escape');
      await expect(task(page)).toHaveCount(0);
    }
  });

  test('turned sideways, the sheet stays a sheet at most 92 % of the new height', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    await open(page, SHAPES[0]);

    await page.setViewportSize({ height: 390, width: 844 });
    await expect(sheet(page)).toHaveAttribute('data-side', 'bottom');
    const found = await box(page);
    expect(found.height).toBeLessThanOrEqual(390 * 0.92 + 0.5);
    expect(Math.round(found.width)).toBe(844);
  });
});

test.describe('closing a sheet', () => {
  for (const [how, close] of [
    [
      'the X',
      (page: Page) =>
        task(page)
          .getByRole('button', { exact: true, name: 'Închide' })
          .click(),
    ],
    ['a tap outside', (page: Page) => page.mouse.click(195, 20)],
    ['Escape', (page: Page) => page.keyboard.press('Escape')],
  ] as const) {
    test(`with ${how}: cancelled, the page where it was, the focus back on the opener`, async ({
      page,
    }) => {
      await page.goto('/ro');
      const home = page.url();
      await openCockpit(page, 390, 844);
      const button = opener(page, SHAPES[0]);
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 80));
      const before = await page.evaluate(() => window.scrollY);
      await button.click();
      await expect(sheet(page)).toBeVisible();
      await still(page);

      await page.mouse.wheel(0, 600);
      await wheelSettled(page);
      expect(
        await page.evaluate(
          () => -Number.parseFloat(document.documentElement.style.top),
        ),
      ).toBe(before);

      await close(page);
      await expect(task(page)).toHaveCount(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
      await expect(button).toBeFocused();
      await expect(result(page)).toContainText(
        t('ro', 'cockpit.overlay.results.cancelled'),
      );

      await page.goBack();
      await expect(page).toHaveURL(home);
    });
  }

  test('while dragged, the sheet stays under the finger with no transition', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    await open(page, SHAPES[0]);
    const rest = await box(page);
    const grip = await sheet(page).locator('.mf-overlay-grip').boundingBox();
    if (!grip) throw new Error('no grip');
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 84, { steps: 4 });
    await expect(sheet(page)).toHaveCSS('transition-duration', '0s');
    expect(Math.round((await box(page)).y)).toBe(Math.round(rest.y + 84));
    await page.mouse.up();
  });

  test('a drag of a quarter springs back; past a third it closes', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    await open(page, SHAPES[0]);
    const rest = await box(page);

    await dragGrip(page, rest.height * 0.25);
    await still(page);
    await expect(task(page)).toHaveCount(1);
    expect(Math.round((await box(page)).y)).toBe(Math.round(rest.y));

    await dragGrip(page, rest.height * 0.4);
    await expect(task(page)).toHaveCount(0);
    await expect(result(page)).toContainText(
      t('ro', 'cockpit.overlay.results.cancelled'),
    );
  });

  test('with a changed field, a long drag asks the discard question', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    await open(page, SHAPES[0]);
    await task(page)
      .getByLabel(t('ro', 'cockpit.overlay.field'))
      .fill('B 123 ABC');

    await dragGrip(page, (await box(page)).height * 0.5);

    await expect(
      page.getByRole('alertdialog', {
        name: t('ro', 'shell.overlay.discard.question'),
      }),
    ).toBeVisible();
    await expect(task(page)).toHaveCount(1);
  });
});

test.describe('the browser’s Back button on a phone', () => {
  for (const [width, height] of [
    [390, 844],
    [320, 640],
  ] as const) {
    test(`at ${width} × ${height} Back closes the sheet and keeps the page`, async ({
      page,
    }) => {
      await openCockpit(page, width, height);
      const address = page.url();
      await open(page, SHAPES[0]);

      await page.goBack();

      await expect(task(page)).toHaveCount(0);
      expect(page.url()).toBe(address);
      await expect(result(page)).toContainText(
        t('ro', 'cockpit.overlay.results.cancelled'),
      );
    });

    test(`at ${width} × ${height} one Back after a drag closed the sheet leaves the page`, async ({
      page,
    }) => {
      await page.goto('/ro');
      const home = page.url();
      await openCockpit(page, width, height);
      await open(page, SHAPES[0]);

      await dragGrip(page, (await box(page)).height * 0.5);
      await expect(task(page)).toHaveCount(0);

      await page.goBack();
      await expect(page).toHaveURL(home);
    });
  }
});

test.describe('focus in a sheet', () => {
  test('the sheet gets the focus, not the field; 20 Tabs and Shift+Tabs stay inside', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    await open(page, SHAPES[0]);

    expect(
      await page.evaluate(
        () => document.activeElement?.getAttribute('role') === 'dialog',
      ),
    ).toBe(true);
    const inside = () =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '.cdk-overlay-pane [role="dialog"]',
          ),
      );
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(key);
        expect(await inside()).toBe(true);
      }
    }
  });
});

test.describe('the on-screen keyboard', () => {
  test('lifts the sheet above it and keeps the field in view', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    // The keyboard is simulated by the visual viewport the sheet follows.
    await page.evaluate(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 844,
        offsetTop: 0,
      });
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: viewport,
      });
    });
    await open(page, 'cockpit.form.open');
    const field = page
      .getByRole('dialog', { name: t('ro', 'cockpit.form.title') })
      .getByLabel(t('ro', 'cockpit.form.plate'));
    await field.focus();

    await page.evaluate(() => {
      const viewport = window.visualViewport as unknown as EventTarget & {
        height: number;
      };
      viewport.height = 500;
      viewport.dispatchEvent(new Event('resize'));
    });

    const panel = page.locator('mf-overlay-panel');
    await expect
      .poll(async () => {
        const found = await panel.boundingBox();
        return found ? Math.round(found.y + found.height) : 0;
      })
      .toBe(500);
    const found = await panel.boundingBox();
    expect(found?.height).toBeLessThanOrEqual(500 * 0.92 + 0.5);
    const at = await field.boundingBox();
    expect(at?.y).toBeGreaterThanOrEqual(found?.y ?? 0);
    expect((at?.y ?? 0) + (at?.height ?? 0)).toBeLessThanOrEqual(500);

    await page.evaluate(() => {
      const viewport = window.visualViewport as unknown as EventTarget & {
        height: number;
      };
      viewport.height = 844;
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect
      .poll(async () => {
        const back = await panel.boundingBox();
        return back ? Math.round(back.y + back.height) : 0;
      })
      .toBe(844);
  });
});

test.describe('the safe area', () => {
  test('the last button ends above a 34 px home bar', async ({ page }) => {
    await openCockpit(page, 390, 844);
    await page.addStyleTag({ content: ':root { --mf-safe-bottom: 34px; }' });
    await open(page, SHAPES[0]);

    const body = sheet(page).locator('.mf-overlay-body');
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const last = await body.locator('button').last().boundingBox();
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(844 - 34);
  });
});

test.describe('saving in a sheet', () => {
  test('taskSave explains the field, shows the conflict next to the button and keeps the text, at 320 px', async ({
    page,
  }) => {
    await openCockpit(page, 320, 640);
    await open(page, 'cockpit.form.open');
    const form = page.getByRole('dialog', {
      name: t('ro', 'cockpit.form.title'),
    });
    await expect(form.locator('mf-overlay-panel')).toHaveAttribute(
      'data-side',
      'bottom',
    );
    const plate = form.getByLabel(t('ro', 'cockpit.form.plate'));
    const save = form.locator('button[type="submit"]');

    await save.click();
    await expect(form).toContainText(t('ro', 'shell.form.field.required'));
    await expect(plate).toBeFocused();

    await form
      .getByLabel(t('ro', 'cockpit.form.answer'))
      .selectOption({ label: t('ro', 'cockpit.form.answers.conflict') });
    await plate.fill('B 123 ABC');
    await save.click();
    await expect(form.locator('mf-task-error')).toContainText(
      t('ro', 'shell.form.problem.conflict'),
    );
    await expect(plate).toHaveValue('B 123 ABC');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});

test.describe('in English', () => {
  test('the sheet, its X and the discard question read in English', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844, 'en');
    await open(page, SHAPES[0], 'en');
    await expect(
      task(page, 'en').getByRole('button', { exact: true, name: 'Close' }),
    ).toBeVisible();
    await task(page, 'en')
      .getByLabel(t('en', 'cockpit.overlay.field'))
      .fill('B 123 ABC');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('alertdialog', { name: 'Discard your changes?' }),
    ).toBeVisible();
  });
});

test.describe('accessibility', () => {
  for (const colorScheme of ['dark', 'light'] as const) {
    for (const language of ['ro', 'en'] as const) {
      test(`an open sheet passes axe, ${colorScheme}, ${language}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await openCockpit(page, 390, 844, language);
        await page.evaluate(AXE);
        await open(page, SHAPES[0], language);

        const violations = await page.evaluate(async () => {
          const axe = (globalThis as unknown as { axe: Axe }).axe;
          const found = await axe.run({
            include: [['.cdk-overlay-container']],
          });
          return found.violations.map((v) => `${v.id} (${v.nodes.length})`);
        });
        expect(violations).toEqual([]);
      });
    }
  }
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the sheet opens, springs back and closes with nothing moving', async ({
    page,
  }) => {
    await openCockpit(page, 390, 844);
    await opener(page, SHAPES[0]).click();
    await expect(sheet(page)).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

    const rest = await box(page);
    await dragGrip(page, rest.height * 0.2);
    await still(page);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(Math.round((await box(page)).y)).toBe(Math.round(rest.y));

    await page.keyboard.press('Escape');
    await expect(task(page)).toHaveCount(0);
  });
});
