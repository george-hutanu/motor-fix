import { expect } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

// @traces 182-FR-002 182-FR-003 182-FR-007 182-FR-010

const JOB = '6c1f0a52-3b7e-4d1a-9f0e-2a4b5c6d7e8f';

// A done job the driver may review, answered in place of the API.
const CONTEXT = {
  author: { shortName: 'Andrei M.' },
  car: {
    brand: 'BMW',
    engine: '2.0',
    fuel: 'diesel',
    model: '320d',
    year: 2019,
  },
  eligibility: { jobId: JOB, offer: true, reason: null },
  emailConfirmed: true,
  existing: null,
  garage: { id: 'garage-1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
  hasEmail: true,
  job: { id: JOB, status: 'done' },
  jobs: [
    {
      id: 'rj-1',
      jobTypeId: 'jt-1',
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      position: 0,
    },
  ],
};

test('the rules open in a new tab from the review drawer and the draft stays', async ({
  page,
}) => {
  await signInAs(page, 'driver', '/app/driver');
  await page.route('**/api/v1/reviews/job/*', (route) =>
    route.fulfill({ json: CONTEXT }),
  );
  await page.goto(`/app/driver?review=${JOB}`);
  await settled(page);

  const drawer = page.getByRole('dialog');
  await drawer.locator('label.step', { hasText: '5' }).click();
  await drawer.locator('#mf-review-paid').fill('890');
  await drawer
    .locator('#mf-review-comment')
    .fill('Gata la timp, prețul din ofertă.');
  await expect(drawer).toContainText(
    'Fără insulte, date personale sau reclame. Scrie doar despre această reparație.',
  );

  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/reviews')) sent.push(request.url());
  });
  const [rules] = await Promise.all([
    page.context().waitForEvent('page'),
    drawer.getByRole('link', { name: /Regulile recenziilor/ }).click(),
  ]);
  await rules.waitForLoadState();

  await expect(rules).toHaveURL(/\/ro\/review-rules$/);
  await expect(rules.getByRole('heading', { level: 1 })).toHaveText(
    'Regulile recenziilor',
  );
  await expect(rules.locator('ol > li')).toHaveCount(8);
  await rules.close();

  await expect(drawer).toBeVisible();
  await expect(drawer.locator('input[type="radio"][value="5"]')).toBeChecked();
  await expect(drawer.locator('#mf-review-paid')).toHaveValue('890');
  await expect(drawer.locator('#mf-review-comment')).toHaveValue(
    'Gata la timp, prețul din ofertă.',
  );
  await expect(page).toHaveURL(new RegExp(`/app/driver\\?review=${JOB}`));
  expect(sent).toEqual([]);
});

test('a visitor reads the rules in English without signing in', async ({
  page,
}) => {
  await page.goto('/en/review-rules');
  await settled(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Review rules',
  );
  await expect(page.locator('ol > li')).toHaveCount(8);
  await expect(page.getByRole('heading', { level: 2 })).toContainText([
    'How moderation works',
  ]);
});

test('the footer links to the review rules', async ({ page }) => {
  await page.goto('/ro/');
  await settled(page);

  await page
    .locator('mf-public-footer')
    .getByRole('link', { name: 'Regulile recenziilor' })
    .click();

  await expect(page).toHaveURL(/\/ro\/review-rules$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Regulile recenziilor',
  );
});
