import { expect, test } from '@playwright/test';

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
