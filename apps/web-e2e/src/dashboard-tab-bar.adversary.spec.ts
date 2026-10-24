import { expect } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

const OWNER = [
  'garage.requests',
  'garage.schedule',
  'garage.final_price',
  'garage.own_jobs',
  'garage.reviews',
  'garage.team',
  'garage.prices',
  'garage.profile',
  'garage.feature_switches',
  'garage.audit_history',
];

const NAMES = {
  en: { bar: 'Garage dashboard', first: 'Home', last: 'History' },
  ro: { bar: 'Panou service', first: 'Panou', last: 'Istoric' },
} as const;

const sideways = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth);

// @traces 1380-FR-002
test.describe('the garage bar reveals the active tab after the page is already open', () => {
  for (const width of [320, 390]) {
    for (const language of ['ro', 'en'] as const) {
      test(`reveals Settings, then History, then the first tab when clicked at ${width} px in ${language}`, async ({
        page,
      }) => {
        const names = NAMES[language];
        await signInAs(page, 'garage', '/app/garage', OWNER, language);
        await page.setViewportSize({ height: 640, width });
        await page.goto('/app/garage/reviews');
        await settled(page);
        const bar = page.getByRole('navigation', { name: names.bar });
        const links = bar.getByRole('link');

        await links.nth(8).click();
        await expect(page).toHaveURL('/app/garage/settings');
        await expect(links.nth(8)).toHaveAttribute('aria-current', 'page');
        await expect(links.nth(8)).toBeInViewport({ ratio: 1 });

        await links.nth(9).click();
        await expect(page).toHaveURL('/app/garage/history');
        await expect(links.nth(9)).toBeInViewport({ ratio: 1 });
        await expect(links.nth(0)).not.toBeInViewport();

        await links.nth(6).click();
        await expect(page).toHaveURL('/app/garage/reviews');
        await expect(links.nth(6)).toBeInViewport({ ratio: 1 });
        expect(await sideways(page)).toBeLessThanOrEqual(width);
      });
    }
  }

  test('scrolls back to reveal the first tab when History is left for the dashboard', async ({
    page,
  }) => {
    await signInAs(page, 'garage', '/app/garage', OWNER);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto('/app/garage/history');
    await settled(page);
    const bar = page.getByRole('navigation', { name: 'Panou service' });
    const first = bar.getByRole('link', { exact: true, name: 'Panou' });
    await expect(first).not.toBeInViewport();

    await first.click();
    await expect(page).toHaveURL('/app/garage');

    await expect(first).toBeInViewport({ ratio: 1 });
    await expect(
      bar.getByRole('link', { exact: true, name: 'Istoric' }),
    ).not.toBeInViewport();
  });

  test('keeps the active tab in view after a reload and after browser back', async ({
    page,
  }) => {
    await signInAs(page, 'garage', '/app/garage', OWNER);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto('/app/garage/settings');
    await settled(page);
    const bar = page.getByRole('navigation', { name: 'Panou service' });
    const settings = bar.getByRole('link', { exact: true, name: 'Setări' });

    await page.reload();
    await settled(page);
    await expect(settings).toBeInViewport({ ratio: 1 });

    await bar.getByRole('link', { exact: true, name: 'Istoric' }).click();
    await expect(page).toHaveURL('/app/garage/history');
    await page.goBack();
    await expect(page).toHaveURL('/app/garage/settings');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(settings).toBeInViewport({ ratio: 1 });
  });

  // @traces 1380-FR-005
  test('re-reveals the active tab when the phone turns sideways and back', async ({
    page,
  }) => {
    await signInAs(page, 'garage', '/app/garage', OWNER);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto('/app/garage/history');
    await settled(page);
    const last = page
      .getByRole('navigation', { name: 'Panou service' })
      .getByRole('link', { exact: true, name: 'Istoric' });

    await page.setViewportSize({ height: 320, width: 640 });
    await page.setViewportSize({ height: 640, width: 320 });

    await expect(last).toBeInViewport({ ratio: 1 });
    expect(await sideways(page)).toBeLessThanOrEqual(320);
  });

  test('every link stays at least 44 px wide and tall at 320 px so it can be tapped', async ({
    page,
  }) => {
    await signInAs(page, 'garage', '/app/garage', OWNER, 'en');
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto('/app/garage/history');
    await settled(page);

    const boxes = await page
      .getByRole('navigation', { name: 'Garage dashboard' })
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((a) => {
          const r = a.getBoundingClientRect();
          return { h: r.height, w: r.width };
        }),
      );

    expect(boxes.filter((b) => b.w < 44 || b.h < 44)).toEqual([]);
  });
});
