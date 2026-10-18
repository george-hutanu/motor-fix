import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { violations } from './axe.js';
import { test } from './fixtures.js';

// @traces 248-FR-013
const RULES = [
  'landmark-one-main',
  'region',
  'landmark-no-duplicate-main',
  'landmark-main-is-top-level',
];

async function landmarkViolations(page: Page) {
  const found = await violations(page, {
    runOnly: { type: 'rule', values: RULES },
  });
  return found.map((v) => `${v.id} (${v.nodes.length})`);
}

for (const [label, width, height] of [
  ['a 320 px phone', 320, 640],
  ['a desktop', 1440, 900],
] as const) {
  for (const language of ['ro', 'en'] as const) {
    test(`Home has its landmarks on ${label}, ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ height, width });
      await page.addInitScript((lang) => {
        localStorage.setItem('mf.lang', lang);
      }, language);
      await page.goto('/');
      await expect(page).toHaveURL(new RegExp(`/${language}/?$`));
      await expect(
        page.getByRole('heading', { name: 'MotorFix' }),
      ).toBeVisible();
      await settled(page);

      expect(await landmarkViolations(page)).toEqual([]);
    });
  }
}

test('the page the server sends for / already has one main', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();

  expect(html.match(/<main[\s>]/g)).toHaveLength(1);
});
