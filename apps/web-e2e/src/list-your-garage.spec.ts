import { expect, type Page } from '@playwright/test';

import { ownMap, settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

// The place step's map draws the app's empty style: no outside tiles or WebGL
// render moving the page after a jump has landed.
test.beforeEach(({ context }) => ownMap(context));

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
  await settled(page);
}

// The sections are empty until later stories fill them; give them the height
// their content will have so the page scrolls past each heading.
async function fill(page: Page) {
  await page.addStyleTag({ content: 'main section { min-height: 900px; }' });
}

// The smooth jump has ended once the page stops moving.
async function still(page: Page) {
  let y = -1;
  await expect
    .poll(async () => {
      const before = y;
      y = await page.evaluate(() => scrollY);
      return y === before;
    })
    .toBe(true);
  return y;
}

// The site bar stays on top of every public page; nothing of the form's may
// slide under it, so the element's middle is the element's own.
async function uncovered(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const site = document.querySelector('mf-public-frame > header');
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + Math.min(r.height, 44) / 2,
    );
    return (
      site !== null &&
      r.top >= site.getBoundingClientRect().bottom - 1 &&
      hit !== null &&
      el.contains(hit)
    );
  });
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
    await settled(page);

    await expect(sections(page).nth(3)).toBeInViewport();
    await expect(current(page)).toContainText('Mecanici');
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { height: 720, width: 1280 } });

  test('keeps the step list and the preview under the site bar while the page scrolls', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);

    await scrollTo(page, 3);
    await still(page);
    expect(await uncovered(page, 'nav[aria-label="Pași"]')).toBe(true);
    expect(await uncovered(page, 'aside mf-garage-preview')).toBe(true);
  });

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

      // Read where the heading is the moment the click has been handled: an
      // instant jump has landed by then, a smooth one has not yet moved.
      await page.evaluate(() =>
        addEventListener(
          'click',
          () => {
            const top = document
              .querySelectorAll('section h2')[5]
              .getBoundingClientRect().top;
            (window as { landed?: boolean }).landed =
              top >= 0 && top < innerHeight;
          },
          { once: true },
        ),
      );
      await entry(page, 'Verificare').click();

      expect(
        await page.evaluate(() => (window as { landed?: boolean }).landed),
      ).toBe(true);
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
    const y = await still(page);
    await page.evaluate(() => {
      (window as { kept?: boolean }).kept = true;
    });

    // A click that does not scroll: a real click would first bring the switch,
    // at the top of the page, into view and so make step 1 current.
    await page
      .getByRole('group', { name: 'Limba' })
      .getByRole('button', { name: 'EN' })
      .dispatchEvent('click');

    await expect(page).toHaveURL(/\/en\/list-your-garage/);
    await expect(page.locator('h1')).toHaveText('Put your garage on the map');
    await expect(steps(page, 'Steps')).toBeVisible();
    await expect(current(page)).toContainText('Mechanics');
    await page.waitForTimeout(300);
    await expect(current(page)).toContainText('Mechanics');
    expect(await page.evaluate(() => scrollY)).toBe(y);
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

  test('keeps the step bar under the site bar while the page scrolls', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);

    await scrollTo(page, 3);
    await still(page);
    expect(await uncovered(page, 'nav > button[aria-expanded]')).toBe(true);
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

    await page.waitForTimeout(300);
    await page.mouse.wheel(0, 2);
    await page.waitForTimeout(100);
    await expect(bar(page)).toHaveText('5 / 6 · Fotografii și adresă');
  });

  test('keeps "Salvează ciorna" pinned above the tab bar, so saving never scrolls', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);
    // With no e-mail, Save focuses the E-mail field at the top by design.
    await page
      .getByLabel('E‑mail')
      .fill(
        `pinned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      );
    await page.getByLabel('E‑mail').blur();
    await bar(page).click();
    await entry(page, 'Fotografii și adresă').click();
    const y = await still(page);

    const save = page.getByRole('button', { name: 'Salvează ciorna' });
    const tabs = page.locator('mf-public-tab-bar');
    await expect(tabs).toBeVisible();
    const saveBox = (await save.boundingBox())!;
    const tabsBox = (await tabs.boundingBox())!;
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(tabsBox.y + 1);
    expect(
      await save.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return hit !== null && b.contains(hit);
      }),
    ).toBe(true);

    await save.click();
    await expect(page.getByText('Ciorna e salvată')).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await expect(bar(page)).toHaveText('5 / 6 · Fotografii și adresă');
  });

  test('opens and closes the list over the page, which stays where it was', async ({
    page,
  }) => {
    await open(page, '/ro/list-your-garage');
    await fill(page);
    await bar(page).click();
    await entry(page, 'Fotografii și adresă').click();
    await expect(sections(page).nth(4)).toBeFocused();
    // The jump may start after the focus lands: wait for it to begin, then settle.
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const y = await still(page);
    const below = async () =>
      (await sections(page).nth(4).boundingBox())!.y >=
      (await bar(page).boundingBox())!.y +
        (await bar(page).boundingBox())!.height -
        1;
    expect(await below()).toBe(true);

    await bar(page).click();
    await expect(bar(page)).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => scrollY)).toBe(y);
    await page.keyboard.press('Escape');

    await expect(bar(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(await below()).toBe(true);
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

test.describe('the verification step on a phone', () => {
  test('checks the tax ID, counts the two values and offers no look-up', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await open(page, '/ro/list-your-garage');
    await bar(page).click();
    await entry(page, 'Verificare').click();
    const cui = page.getByLabel(/CUI.ul firmei/);
    const rar = page.getByLabel('Numărul autorizației tehnice RAR');
    const count = page.locator('section .count');

    await expect(count).toHaveText(/0 din 5 completate/);
    await cui.fill('RO 18547291');
    await cui.blur();
    await expect(page.locator('#listing-cui-error')).toHaveText('CUI invalid');
    await expect(cui).toHaveAttribute('aria-invalid', 'true');

    await cui.fill('RO18547290');
    await cui.blur();
    await expect(page.locator('#listing-cui-error')).toHaveText('');
    await expect(cui).toHaveValue('18547290');
    await rar.fill('abc');
    await expect(count).toHaveText(/2 din 5 completate/);

    await expect(
      page.getByRole('button', {
        name: /Verifică firma|Caută în registrul RAR/,
      }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });
});
