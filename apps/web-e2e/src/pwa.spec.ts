import { expect, test } from '@playwright/test';

// Every other spec blocks service workers so their API stubs reach the page.
test.use({ serviceWorkers: 'allow' });

test('serves the manifest and its icons, and registers the service worker', async ({
  page,
  request,
}) => {
  await page.goto('/');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const answer = await request.get(`/${href}`);
  expect(answer.status()).toBe(200);
  const manifest = await answer.json();
  expect(manifest.name).toBe('MotorFix');
  for (const { src } of manifest.icons as { src: string }[]) {
    expect((await request.get(`/${src}`)).status()).toBe(200);
  }

  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(new URL(scope).pathname).toBe('/');
});
