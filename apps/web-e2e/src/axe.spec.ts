import { expect } from '@playwright/test';

import { violations } from './axe.js';
import { test } from './fixtures.js';

// A card still rising in (mf-rise, from opacity 0) blends its text into the
// background: axe must measure the settled page, not a frame of the entry.
test('the axe scan waits for a rising card to settle before measuring contrast', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      @keyframes rise { from { opacity: 0.3; transform: translateY(14px); } }
      body { background: #ffffff; }
      p { color: #595959; animation: rise 1500ms ease 200ms backwards; }
    </style>
    <main><p>Nota service-ului</p></main>
  `);

  expect(await violations(page, { runOnly: ['color-contrast'] })).toEqual([]);
  expect(
    await page.evaluate(() =>
      document.getAnimations().every((a) => a.playState === 'finished'),
    ),
  ).toBe(true);
});
