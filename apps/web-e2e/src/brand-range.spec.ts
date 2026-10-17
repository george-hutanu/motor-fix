import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD } from './accounts.js';
import { test } from './fixtures.js';

const MILITARI = 'service-auto-militari';
const OWNER = 'militari@example.test';
const DIAGNOSIS = 'Diagnoză și citire coduri de eroare';

const rows = (page: Page) => page.locator('section[data-slot="prices"] .row');
const diagnosis = (page: Page) =>
  rows(page).filter({ hasText: DIAGNOSIS }).locator('.range');

async function owner(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: OWNER, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const me = await request.get('/api/v1/me', { headers });
  const { garageId } = (await me.json()) as { garageId: string };
  const jobs = await request.get('/api/v1/job-types?keys=diagnosis');
  const [job] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const profile = await request.get(`/api/v1/garages/${MILITARI}?brand=bmw`);
  const { brand } = (await profile.json()) as { brand: { id: string } };
  if (!job || !brand)
    throw new Error('the seeded diagnosis job or BMW is missing');
  return {
    headers,
    url: `/api/v1/garages/${garageId}/prices/${job.id}/brands/${brand.id}`,
  };
}

// Militari takes BMW and lists the diagnosis for it at the default 150–220
// lei; the seeded BMW range sits on the front brakes, which the price list
// spec reads, so this one writes the diagnosis and removes it after.
// @traces 386-FR-002 386-FR-013 386-FR-014
test.describe("an owner's brand range on the profile @seeded", () => {
  test.describe.configure({ mode: 'serial' });

  test('shows the range to an open BMW profile, keeps Audi on the default, and removal brings the default back', async ({
    page,
    request,
  }) => {
    const { headers, url } = await owner(request);
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/live/public?') &&
        r.url().includes('garages=') &&
        r.ok(),
    );
    await page.goto(`/ro/garages/${MILITARI}?brand=bmw`);
    await expect(diagnosis(page)).toHaveText('150–220 lei');
    await stream;

    try {
      const set = await request.put(url, {
        data: { fromBani: 20_000, toBani: 30_000 },
        headers,
      });
      expect(set.status()).toBe(200);

      await expect(diagnosis(page)).toHaveText('200–300 lei', {
        timeout: 15_000,
      });
      const audi = await page.context().newPage();
      await audi.goto(`/ro/garages/${MILITARI}?brand=audi`);
      await expect(diagnosis(audi)).toHaveText('150–220 lei');
    } finally {
      const removed = await request.delete(url, { headers });
      expect(removed.status()).toBe(204);
    }

    await page.reload();
    await expect(diagnosis(page)).toHaveText('150–220 lei');
  });
});
