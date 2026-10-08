import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';

const languageSwitch = (page: Page, name: 'Limba' | 'Language') =>
  page.getByRole('group', { name });

async function openHome(page: Page) {
  await page.goto('/');
  await expect(languageSwitch(page, 'Limba')).toBeVisible();
  // Hydrated: the remembered language is applied after the first render.
  await page.waitForLoadState('networkidle');
}

test('Home opens in Romanian with RO chosen, and each button is at least 44 px tall', async ({
  page,
}) => {
  await openHome(page);

  const group = languageSwitch(page, 'Limba');
  await expect(group.getByRole('button', { name: 'RO' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(group.getByRole('button', { name: 'EN' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  for (const name of ['RO', 'EN']) {
    const box = await group.getByRole('button', { name }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
});

test('EN switches both open tabs with no reload, and a reopened page is still English', async ({
  context,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await openHome(first);
  await openHome(second);
  await first.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  await languageSwitch(first, 'Limba')
    .getByRole('button', { name: 'EN' })
    .click();

  for (const page of [first, second]) {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(languageSwitch(page, 'Language')).toBeVisible();
  }
  expect(
    await first.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);

  await first.close();
  await second.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('html')).toHaveAttribute('lang', 'en');
  await expect(languageSwitch(reopened, 'Language')).toBeVisible();
});

test('with storage blocked the app works in Romanian and still switches', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openHome(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
  await languageSwitch(page, 'Limba')
    .getByRole('button', { name: 'EN' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // The address now says English; nothing remembered means `/` is Romanian.
  await page.goto('/');
  await expect(languageSwitch(page, 'Limba')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
  expect(errors).toEqual([]);
});

// Holds the app's scripts back, so a tap lands on the server's page before
// hydration; the returned function lets them load.
async function holdScripts(page: Page) {
  let release = () => {};
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*.js', async (route) => {
    await scripts;
    await route.continue();
  });
  return release;
}

test.describe('on a 320 px phone', () => {
  test.use({ viewport: { height: 640, width: 320 } });

  test('EN tapped before the app has loaded is kept, and a reload stays English', async ({
    page,
  }) => {
    const release = await holdScripts(page);

    await page.goto('/', { waitUntil: 'commit' });
    await languageSwitch(page, 'Limba')
      .getByRole('button', { name: 'EN' })
      .click();
    release();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveURL(/\/en$/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      languageSwitch(page, 'Language').getByRole('button', { name: 'EN' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('EN tapped before the app has loaded is kept with storage blocked', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    const release = await holdScripts(page);

    await page.goto('/', { waitUntil: 'commit' });
    await languageSwitch(page, 'Limba')
      .getByRole('button', { name: 'EN' })
      .click();
    release();

    await expect(page).toHaveURL(/\/en$/);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
