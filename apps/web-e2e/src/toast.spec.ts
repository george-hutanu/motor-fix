import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

type Axe = {
  run: (
    context: unknown,
    options?: unknown,
  ) => Promise<{
    violations: Array<{ id: string; impact: string; nodes: unknown[] }>;
  }>;
};

const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const TEXTS = {
  en: { cockpit: 'Show a notification', saved: 'Saved' },
  ro: { cockpit: 'Arată o notificare', saved: 'Salvat' },
};

async function toasterViolations(page: Page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const axe = (globalThis as unknown as { axe: Axe }).axe;
    const result = await axe.run(
      { include: [['hlm-toaster']] },
      { resultTypes: ['violations'] },
    );
    return result.violations.map((v) => `${v.id} (${v.impact})`);
  });
}

test.describe('the toast on the kit page', () => {
  for (const colorScheme of ['dark', 'light'] as const) {
    for (const language of ['ro', 'en'] as const) {
      test(`passes axe and is announced, ${colorScheme}, ${language}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        if (language === 'en')
          await page.addInitScript(() => localStorage.setItem('mf.lang', 'en'));
        await page.goto('/cockpit');
        await settled(page);

        await page
          .getByRole('button', { exact: true, name: TEXTS[language].cockpit })
          .click();
        const item = page
          .locator('li[data-sonner-toast]')
          .filter({ hasText: TEXTS[language].saved });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('aria-live', 'polite');
        await expect(item).toHaveAttribute('aria-atomic', 'true');

        expect(await toasterViolations(page)).toEqual([]);
      });
    }
  }
});

const SIZES = [
  { height: 640, name: '320 px phone', width: 320 },
  { height: 844, name: '390 px phone', width: 390 },
  { height: 1024, name: 'tablet', width: 768 },
  { height: 900, name: 'desktop', width: 1440 },
];

test.describe('the toast on a dashboard', () => {
  for (const size of SIZES) {
    for (const colorScheme of ['dark', 'light'] as const) {
      test(`passes axe on a ${size.name}, ${colorScheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ height: size.height, width: size.width });
        await signInAs(page, 'driver', '/app/driver');
        await page.route('**/api/v1/me/email-confirmation', (route) =>
          route.fulfill({ json: {}, status: 202 }),
        );
        await page.goto('/app/driver');

        // The unconfirmed e-mail banner's "send again" answers with a toast.
        await page
          .getByRole('button', { exact: true, name: 'Retrimite' })
          .click();
        const item = page
          .locator('li[data-sonner-toast]')
          .filter({ hasText: 'Am trimis un link nou pe e‑mail.' });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('aria-live', 'polite');

        expect(await toasterViolations(page)).toEqual([]);
      });
    }
  }
});
