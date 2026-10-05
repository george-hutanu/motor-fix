import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page, test } from '@playwright/test';

type Axe = {
  run: (
    context: unknown,
    options: unknown,
  ) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }>;
};

const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const RULES = [
  'landmark-one-main',
  'region',
  'landmark-no-duplicate-main',
  'landmark-main-is-top-level',
];

async function landmarkViolations(page: Page) {
  await page.evaluate(AXE);
  return page.evaluate(async (rules) => {
    const axe = (globalThis as unknown as { axe: Axe }).axe;
    const result = await axe.run(document, {
      runOnly: { type: 'rule', values: rules },
    });
    return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
  }, RULES);
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
      await page.waitForLoadState('networkidle');

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
