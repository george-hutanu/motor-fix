import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import { hydrated } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

const SWAP = (
  JSON.parse(
    readFileSync(
      new URL('../../../libs/i18n/src/cockpit/ro.json', import.meta.url),
      'utf8',
    ),
  ).gauges as Record<string, string>
)['swap'] as string;

async function open(
  page: Page,
  scheme: 'dark' | 'light',
  width: number,
  reducedMotion: 'no-preference' | 'reduce' = 'no-preference',
) {
  await page.setViewportSize({ height: 800, width });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
  // Hydrated first: hydration sets every binding again, so an attribute a
  // test removes before it would be put back.
  await hydrated(page, '/cockpit');
  await expect(
    page.locator('mf-cockpit-gauges-sample mf-lamp').first(),
  ).toBeVisible();
  await settled(page);
}

// No finite animation still running, so axe reads colours as drawn.
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== 'running' ||
          a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );

const ids = async (
  page: Page,
  options: Record<string, unknown> = {},
  context?: unknown,
) =>
  (
    await violations(page, { resultTypes: ['violations'], ...options }, context)
  ).map(
    (v) => `${v.id} ${v.nodes.map((n) => JSON.stringify(n.target)).join(' ')}`,
  );

for (const scheme of ['light', 'dark'] as const) {
  test(`gauges catalogue has no axe violations after the estimate swap in ${scheme}`, async ({
    page,
  }) => {
    await open(page, scheme, 1280);
    await page.getByRole('button', { exact: true, name: SWAP }).click();
    await expect(
      page.locator('mf-cockpit-gauges-sample mf-odometer').nth(1),
    ).toContainText('1.400–1.800 lei');
    await settled(page);
    expect(await ids(page)).toEqual([]);
  });

  test(`gauges catalogue has no axe violations at 320 px in ${scheme}`, async ({
    page,
  }) => {
    await open(page, scheme, 320);
    expect(await ids(page)).toEqual([]);
  });

  test(`gauges catalogue has no axe violations with reduced motion in ${scheme}`, async ({
    page,
  }) => {
    await open(page, scheme, 1280, 'reduce');
    expect(await ids(page)).toEqual([]);
  });

  test(`gauges catalogue has no axe violations under best-practice rules in ${scheme}`, async ({
    page,
  }) => {
    await open(page, scheme, 1280);
    expect(
      await ids(page, {
        runOnly: {
          type: 'tag',
          values: [
            'wcag2a',
            'wcag2aa',
            'wcag21a',
            'wcag21aa',
            'wcag22aa',
            'best-practice',
          ],
        },
      }),
    ).toEqual([]);
  });

  // retired test: "gauges catalogue has no axe violations with enhanced contrast rule in ${scheme}" the spec holds the page to axe's default rules, whose contrast bar is WCAG AA (4.5:1); AAA's 7:1 is not a requirement of this page or the theme

  test(`gauges catalogue scan result is the same when run twice in ${scheme}`, async ({
    page,
  }) => {
    await open(page, scheme, 1280);
    const first = await ids(page);
    const second = await ids(page);
    expect(second).toEqual(first);
  });
}

test('gauges catalogue does not scroll sideways at 320 px', async ({
  page,
}) => {
  await open(page, 'light', 320);
  const over = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
});

test('every dial and lamp on the catalogue has an accessible name', async ({
  page,
}) => {
  await open(page, 'dark', 1280);
  const unnamed = await page
    .locator('mf-cockpit-gauges-sample [role="img"]')
    .evaluateAll((els) =>
      els
        .filter(
          (e) =>
            !(e.getAttribute('aria-label') ?? '').trim() &&
            !e.getAttribute('aria-labelledby'),
        )
        .map((e) => e.outerHTML.slice(0, 120)),
    );
  expect(unnamed).toEqual([]);
});

test('scanner helper flags a gauge whose accessible name is removed', async ({
  page,
}) => {
  await open(page, 'dark', 1280);
  // A copy beside the dial, outside Angular: a binding on the dial itself
  // writes its label back as the reading moves, before the scan (run
  // 40145209419 found none on its first try).
  const stripped = await page
    .locator('mf-cockpit-gauges-sample [role="img"][aria-label]')
    .first()
    .evaluate((el) => {
      const copy = el.cloneNode(true) as Element;
      copy.removeAttribute('aria-label');
      copy.removeAttribute('aria-labelledby');
      el.after(copy);
      return true;
    });
  expect(stripped).toBe(true);
  expect(await ids(page)).toContainEqual(
    expect.stringMatching(/^role-img-alt /),
  );
});

test('scanner helper scans only the included region', async ({ page }) => {
  await open(page, 'light', 1280);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'outside-probe';
    document.body.append(b);
  });
  const whole = await ids(page);
  const scoped = await ids(
    page,
    {},
    { include: [['mf-cockpit-gauges-sample']] },
  );
  expect(whole.filter((v) => v.includes('#outside-probe'))).toHaveLength(1);
  expect(scoped.filter((v) => v.includes('#outside-probe'))).toEqual([]);
});
