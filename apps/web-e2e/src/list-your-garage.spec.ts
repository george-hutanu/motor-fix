import { expect, type Page, test } from '@playwright/test';

import { signInAs } from './sign-in.js';

const steps = (page: Page, name: 'Pași' | 'Steps') =>
  page.getByRole('navigation', { name });
const entry = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name });
const current = (page: Page) => page.locator('nav [aria-current="step"]');
const bar = (page: Page) => page.locator('nav > button[aria-expanded]');
const sections = (page: Page) => page.locator('section h2');

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

// The sections are empty until later stories fill them; give them the height
// their content will have so the page scrolls past each heading.
async function fill(page: Page) {
  await page.addStyleTag({ content: 'section { min-height: 900px; }' });
}

async function scrollTo(page: Page, n: number) {
  await sections(page)
    .nth(n - 1)
    .evaluate((heading) =>
      window.scrollTo(0, heading.getBoundingClientRect().top + scrollY),
    );
}

test.describe('the list your garage page', () => {
  for (const [path, heading, first] of [
    ['/ro/list-your-garage', 'Pune-ți service-ul pe hartă', '1 Service-ul'],
    ['/en/list-your-garage', 'Put your garage on the map', '1 The garage'],
  ]) {
    test(`${path} opens for a visitor in its language, with no sign-in dialog`, async ({
      page,
    }) => {
      await open(page, path);

      // The Romanian catalogue writes its hyphens non-breaking.
      await expect(page.locator('h1')).toHaveText(
        new RegExp(heading.replace(/-/g, '.')),
      );
      await expect(sections(page)).toHaveCount(6);
      await expect(sections(page).first()).toHaveText(
        new RegExp(first.replace(/-/g, '.')),
      );
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  test('opens for a signed-in driver too', async ({ page }) => {
    await signInAs(page, 'driver', '/app/driver');
    await open(page, '/ro/list-your-garage');

    await expect(sections(page)).toHaveCount(6);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('lands on the section a fragment names', async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 1280 });
    await page.goto('/ro/list-your-garage');
    await fill(page);
    await page.goto('/ro/list-your-garage#pasul-4');
    await page.waitForLoadState('networkidle');

    await expect(sections(page).nth(3)).toBeInViewport();
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { height: 720, width: 1280 } });

  test('starts at step 1, keeps the list in view and follows the section on screen', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await expect(current(page)).toHaveText(/^\s*1\s*Service.ul\s*$/);
    await fill(page);

    await scrollTo(page, 3);
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toContainText('Prețuri');
    await expect(steps(page, 'Pași')).toBeInViewport();

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(current(page)).toContainText('Verificare');
    await expect(steps(page, 'Pași')).toBeInViewport();
    await expect(bar(page)).toBeHidden();
  });

  test('jumps to each of the six sections, focusing its heading', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);

    for (const [n, label] of [
      [4, 'Mecanici'],
      [1, 'Service'],
      [6, 'Verificare'],
      [2, 'Mărci'],
      [5, 'Fotografii și adresă'],
      [3, 'Prețuri'],
    ] as const) {
      await entry(page, label).click();
      const heading = sections(page).nth(n - 1);

      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      await expect(current(page)).toHaveCount(1);
      await expect(current(page)).toContainText(label);
    }
  });

  test('jumps from the keyboard', async ({ page }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);

    await entry(page, 'Prețuri').focus();
    await page.keyboard.press('Enter');

    await expect(sections(page).nth(2)).toBeFocused();
    await expect(current(page)).toContainText('Prețuri');
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('jumps at once, without a smooth scroll', async ({ page }) => {
      await open(page, '/ro/list-your-garage');
      await fill(page);

      await entry(page, 'Verificare').click();
      const y = await page.evaluate(() => scrollY);
      await page.waitForTimeout(50);

      expect(await page.evaluate(() => scrollY)).toBe(y);
      await expect(sections(page).nth(5)).toBeInViewport();
    });
  });

  test('keeps the step and the page when the language switches', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);
    await entry(page, 'Mecanici').click();
    await expect(current(page)).toContainText('Mecanici');
    await page.evaluate(() => {
      (window as { kept?: boolean }).kept = true;
    });

    await page
      .getByRole('group', { name: 'Limba' })
      .getByRole('button', { name: 'EN' })
      .click();

    await expect(page).toHaveURL(/\/en\/list-your-garage/);
    await expect(page.locator('h1')).toHaveText('Put your garage on the map');
    await expect(steps(page, 'Steps')).toBeVisible();
    await expect(current(page)).toContainText('Mechanics');
    expect(await page.evaluate(() => (window as { kept?: boolean }).kept)).toBe(
      true,
    );
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test('shows the current step in a bar that follows the scroll', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await expect(bar(page)).toHaveText(/1 \/ 6 · Service.ul/);
    await fill(page);

    await scrollTo(page, 3);
    await expect(bar(page)).toHaveText('3 / 6 · Prețuri');
    await expect(bar(page)).toBeInViewport();
  });

  test('opens the list, jumps to step 5 and closes', async ({ page }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);

    await bar(page).click();
    await expect(bar(page)).toHaveAttribute('aria-expanded', 'true');
    await entry(page, 'Fotografii și adresă').click();

    await expect(bar(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(bar(page)).toHaveText('5 / 6 · Fotografii și adresă');
    await expect(sections(page).nth(4)).toBeFocused();
    await expect(sections(page).nth(4)).toBeInViewport();
  });

  test('closes the open list on Escape and gives the focus back to the bar', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');

    await bar(page).click();
    await entry(page, 'Prețuri').focus();
    await page.keyboard.press('Escape');

    await expect(bar(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(bar(page)).toBeFocused();
    await expect(bar(page)).toHaveText(/1 \/ 6/);
  });

  test('does not scroll sideways at 320 px with the list open', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await open(page, '/en/list-your-garage');
    await bar(page).click();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });
});
