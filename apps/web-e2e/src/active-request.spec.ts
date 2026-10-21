import { randomUUID } from 'node:crypto';

import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { openSignIn, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver with a Dacia Logan; other specs share the account, so the
// panel's request is not pinned, only its shape.
const DRIVER = 'cerere@example.test';
const MILITARI = 'militari@example.test';

const STAGE = {
  booked: 'Programată',
  done: 'Gata',
  in_work: 'În lucru',
  quoted: 'Ofertă',
  sent: 'Trimisă',
} as const;

// The part of the active request read this spec checks the panel against.
interface ActiveRead {
  request: {
    stage: keyof typeof STAGE;
    job: {
      startedAt: string | null;
      steps: { state: 'done' | 'now' | 'todo' }[];
    } | null;
  } | null;
}

async function bearer(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

// One request of the driver's to Militari, so at least one is open.
async function openRequest(request: APIRequestContext) {
  const me = await request.get('/api/v1/me', {
    headers: await bearer(request, MILITARI),
  });
  const { garageId } = (await me.json()) as { garageId: string };
  const headers = await bearer(request, DRIVER);
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const cars = await request.get('/api/v1/cars', { headers });
  const { items } = (await cars.json()) as { items: { id: string }[] };
  const sent = await request.post('/api/v1/quote-requests', {
    data: {
      carId: items[0].id,
      description: `Schimb de ulei ${randomUUID().slice(0, 8)}`,
      garageIds: [garageId],
      jobTypeIds: [oil.id],
      sources: ['profile_direct'],
    },
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
  });
  expect(sent.status()).toBe(201);
}

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, DRIVER);
  await expect(page).toHaveURL('/app/driver');
}

// @seeded: the seeded driver has at least one open request.
test.describe('Cererea activă @seeded', () => {
  // @traces 274-FR-010
  // @traces 274-FR-017
  // @traces 274-FR-018
  // @traces 274-FR-021
  test('Panou shows the driver’s open request on its five stages at 390 px, with Cerere nouă to Home', async ({
    page,
    request,
  }) => {
    await openRequest(request);
    await page.setViewportSize({ height: 844, width: 390 });
    await signedIn(page);

    const panel = page.locator('mf-active-request');
    await expect(
      panel.getByRole('heading', { name: 'Cererea activă' }),
    ).toBeVisible();
    const stages = panel.locator('ol > li');
    await expect(stages).toHaveText([
      'Trimisă',
      'Ofertă',
      'Programată',
      'În lucru',
      'Gata',
    ]);
    await expect(panel.locator('ol > li[aria-current="step"]')).toHaveCount(1);

    // The panel shows the request the read puts first: for the seed's job in
    // work, În lucru current, Început and the steps count.
    const read = await request.get('/api/v1/quote-requests/active', {
      headers: await bearer(request, DRIVER),
    });
    expect(read.ok()).toBe(true);
    const { request: shown } = (await read.json()) as ActiveRead;
    expect(shown).not.toBeNull();
    await expect(panel.locator('ol > li[aria-current="step"]')).toHaveText(
      STAGE[shown?.stage ?? 'sent'],
    );
    if (shown?.job?.startedAt) {
      await expect(panel.locator('dt', { hasText: 'Început' })).toBeVisible();
    }
    const steps = shown?.job?.steps ?? [];
    if (steps.length) {
      const done = steps.filter((step) => step.state === 'done').length;
      await expect(
        panel.getByRole('heading', {
          name: `Pașii lucrării · ${done} din ${steps.length} gata`,
        }),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    // On a 320 px phone every stage label stays inside its own column.
    await page.setViewportSize({ height: 640, width: 320 });
    const spill = await stages.evaluateAll((items) =>
      items.flatMap((item) => {
        const range = document.createRange();
        range.selectNodeContents(item);
        const text = range.getBoundingClientRect();
        const box = item.getBoundingClientRect();
        return text.left < box.left - 0.5 || text.right > box.right + 0.5
          ? [item.textContent?.trim() ?? '']
          : [];
      }),
    );
    expect(spill).toEqual([]);

    await panel.getByRole('link', { exact: true, name: 'Cerere nouă' }).click();
    await expect(page).toHaveURL('/ro');
  });
});
