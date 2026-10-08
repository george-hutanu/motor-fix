import { expect } from '@playwright/test';

import { test } from './fixtures.js';

test('the skeleton page shows the release and both checks', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'MotorFix' })).toBeVisible();
  await expect(
    page.getByText(process.env['RELEASE_SHA'] ?? 'dev'),
  ).toBeVisible();
  await expect(page.getByText('PostgreSQL: ok · Redis: ok')).toBeVisible();
});

test('the server sends the page in Romanian, every text filled in', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();

  expect(html).toContain('<html lang="ro"');
  expect(html).toMatch(/<h1[^>]*>MotorFix<\/h1>/);
  expect(html).not.toMatch(/shell\.[a-z]/);
});
