import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

// The page opens in Romanian, the default language.
const read = (path: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../libs/i18n/src/${path}`, import.meta.url),
      'utf8',
    ),
  );
const COCKPIT = read('cockpit/ro.json').gauges as Record<string, string>;
const SHELL = read('shell/ro.json').gauge as Record<string, string>;

// Each state's colour is read from the page's own tokens, so a token change
// in the theme cannot break this suite.
const STATE_TOKEN = {
  amber: '--mf-amber-ink',
  green: '--mf-green',
  grey: '--mf-text-secondary',
  red: '--mf-red',
} as const;

const token = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

async function open(page: Page, colorScheme: 'dark' | 'light', width: number) {
  await page.setViewportSize({ height: 900, width });
  await page.emulateMedia({ colorScheme });
  await page.goto('/cockpit');
  await expect(
    page.locator('mf-cockpit-gauges-sample mf-lamp').first(),
  ).toBeVisible();
}

for (const scheme of ['dark', 'light'] as const) {
  for (const width of [375, 1280]) {
    test(`shows every gauge state in ${scheme} at ${width} px`, async ({
      page,
    }) => {
      await open(page, scheme, width);
      const section = page.locator('mf-cockpit-gauges-sample');

      for (const [state, label] of [
        ['green', COCKPIT['lampGreen']],
        ['red', COCKPIT['lampRed']],
        ['amber', COCKPIT['lampAmber']],
        ['grey', COCKPIT['lampGrey']],
      ] as const) {
        const lamp = section.locator(`mf-lamp[data-state="${state}"]`);
        await expect(lamp).toHaveText(label);
        await expect(lamp.locator('.mf-lamp-dot')).toHaveCSS(
          'background-color',
          rgb(await token(page, STATE_TOKEN[state])),
        );
      }

      await expect(
        section.getByRole('img', {
          name: SHELL['rating'].replace('{value}', '4,8'),
        }),
      ).toHaveCount(2);
      await expect(
        section.getByRole('img', { name: SHELL['none'] }),
      ).toHaveCount(2);

      const small = section
        .locator('mf-rating-dial[data-size="small"]')
        .first();
      const box = await small.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(
        Number.parseFloat(
          await small
            .locator('.mf-dial-value')
            .evaluate((el) => getComputedStyle(el).fontSize),
        ),
      ).toBeGreaterThanOrEqual(12);

      await expect(section.locator('mf-odometer').nth(1)).toContainText(
        '1.250–1.600 lei',
      );
    });
  }
}

test('updates the estimate and tells screen readers the new value once', async ({
  page,
}) => {
  await open(page, 'dark', 1280);
  const odometer = page.locator('mf-cockpit-gauges-sample mf-odometer').nth(1);

  await page
    .getByRole('button', { exact: true, name: COCKPIT['swap'] })
    .click();

  await expect(odometer.locator('[aria-hidden="true"]')).toHaveText(
    '1.400–1.800 lei',
  );
  const live = odometer.locator('[aria-live="polite"]');
  await expect(live).toHaveCount(1);
  await expect(live).toHaveText('1.400–1.800 lei');
});

test('keeps the space before "lei" and every separator visible', async ({
  page,
}) => {
  await open(page, 'dark', 1280);

  const empty = await page
    .locator('mf-cockpit-gauges-sample mf-odometer')
    .first()
    .evaluate((el) =>
      [...el.querySelectorAll('[aria-hidden="true"] > span')]
        .filter((s) => s.getBoundingClientRect().width === 0)
        .map((s) => JSON.stringify(s.textContent)),
    );

  expect(empty).toEqual([]);
});

test('fits a 320 px wide screen without scrolling sideways', async ({
  page,
}) => {
  for (const scheme of ['dark', 'light'] as const) {
    await open(page, scheme, 320);

    const result = await page.evaluate(() => {
      const panel = document.querySelector(
        'mf-cockpit-gauges-sample section.mf-panel',
      ) as HTMLElement;
      const frame = panel.getBoundingClientRect();
      const screen = document.documentElement.clientWidth;
      const outside = [
        ...panel.querySelectorAll('mf-lamp, mf-rating-dial, mf-odometer'),
      ]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.left < frame.left || box.right > frame.right;
        })
        .map((el) => el.outerHTML.slice(0, 80));
      return {
        outside,
        pageScrolls: document.documentElement.scrollWidth > screen,
        panelOffScreen: frame.left < 0 || frame.right > screen,
        panelScrolls: panel.scrollWidth > panel.clientWidth,
      };
    });

    expect(result).toEqual({
      outside: [],
      pageScrolls: false,
      panelOffScreen: false,
      panelScrolls: false,
    });
  }
});
