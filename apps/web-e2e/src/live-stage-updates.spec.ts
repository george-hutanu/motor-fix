import { randomUUID } from 'node:crypto';

import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import { ACCOUNTS, openSignIn, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seeded driver whose Dacia Logan (B101QAT) has the seed's job in work at
// Atelier Test: in work ranks first, so the panel shows that request.
const DRIVER = 'cerere@example.test';
const PLATE = 'B101QAT';

interface ActiveRead {
  request: {
    job: { steps: { state: 'done' | 'now' | 'todo' }[] } | null;
  } | null;
}

async function headers(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

// The seed's job on the driver's car, still in work or paused.
async function seededJob(
  request: APIRequestContext,
  garage: Record<string, string>,
) {
  const res = await request.get('/api/v1/garage/jobs', { headers: garage });
  expect(res.ok()).toBe(true);
  const { items } = (await res.json()) as {
    items: { car: { plate?: string }; id: string; status: string }[];
  };
  const job = items.find(
    (item) =>
      item.car.plate === PLATE &&
      (item.status === 'in_work' || item.status === 'paused'),
  );
  expect(job).toBeDefined();
  return job?.id ?? '';
}

// The heading the panel's steps carry for what the read returns now.
async function stepsHeading(
  request: APIRequestContext,
  driver: Record<string, string>,
) {
  const read = await request.get('/api/v1/quote-requests/active', {
    headers: driver,
  });
  expect(read.ok()).toBe(true);
  const steps = ((await read.json()) as ActiveRead).request?.job?.steps ?? [];
  const done = steps.filter((step) => step.state === 'done').length;
  return `Pașii lucrării · ${done} din ${steps.length} gata`;
}

async function signedIn(context: BrowserContext, landing: string) {
  const page = await context.newPage();
  await page.setViewportSize({ height: 844, width: 390 });
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, DRIVER);
  await expect(page).toHaveURL('/app/driver');
  if (landing !== '/app/driver') await page.goto(landing);
  return page;
}

const panel = (page: Page) => page.locator('mf-active-request');

// Within seconds, without a reload: the heading must match the read.
async function shows(where: Locator, heading: string) {
  await expect(where.getByRole('heading', { name: heading })).toBeVisible({
    timeout: 10_000,
  });
}

// @seeded: the seed's job in work on the driver's car.
test.describe('each stage change within seconds @seeded', () => {
  // @traces 275-FR-001
  // @traces 275-FR-003
  // @traces 275-FR-006
  // @traces 275-FR-009
  test('a step the garage adds and ticks reaches the overview, Cererile mele and a second tab without a reload', async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const garage = await headers(request, ACCOUNTS.garage);
    const driver = await headers(request, DRIVER);
    const job = await seededJob(request, garage);

    const home = await browser.newContext();
    const list = await browser.newContext();
    const overview = await signedIn(home, '/app/driver');
    const requests = await signedIn(list, '/app/driver/requests');
    // A second tab of the overview's browser shares its stream.
    const second = await home.newPage();
    await second.setViewportSize({ height: 844, width: 390 });
    await second.goto('/app/driver');
    const pages = [overview, requests, second];
    for (const page of pages) {
      await shows(panel(page), await stepsHeading(request, driver));
    }

    const added = await request.post(`/api/v1/garage/jobs/${job}/steps`, {
      data: { text: `Verificare ${randomUUID().slice(0, 6)}` },
      headers: { ...garage, 'Idempotency-Key': randomUUID() },
    });
    expect(added.status()).toBe(201);
    const step = ((await added.json()) as { id: string }).id;
    try {
      const afterAdd = await stepsHeading(request, driver);
      for (const page of pages) await shows(panel(page), afterAdd);

      const ticked = await request.put(
        `/api/v1/garage/jobs/${job}/steps/${step}/done`,
        { data: { done: true }, headers: garage },
      );
      expect(ticked.ok()).toBe(true);
      const afterTick = await stepsHeading(request, driver);
      for (const page of pages) await shows(panel(page), afterTick);
      expect(overview.url()).toMatch(/\/app\/driver$/);
      expect(requests.url()).toMatch(/\/app\/driver\/requests$/);
    } finally {
      await request.delete(`/api/v1/garage/jobs/${job}/steps/${step}`, {
        headers: garage,
      });
      await home.close();
      await list.close();
    }
  });

  // @traces 275-FR-002
  // @traces 275-FR-005
  test('after a network cut the panel says Reconectare… and catches up on what changed meanwhile, keeping the focus', async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const garage = await headers(request, ACCOUNTS.garage);
    const driver = await headers(request, DRIVER);
    const job = await seededJob(request, garage);
    const context = await browser.newContext();
    const page = await signedIn(context, '/app/driver');
    await shows(panel(page), await stepsHeading(request, driver));
    const link = panel(page).getByRole('link', {
      exact: true,
      name: 'Cerere nouă',
    });
    await link.focus();

    let step = '';
    try {
      await context.setOffline(true);
      await expect(
        panel(page).getByRole('status').filter({ hasText: 'Reconectare…' }),
      ).toBeVisible({ timeout: 20_000 });

      const added = await request.post(`/api/v1/garage/jobs/${job}/steps`, {
        data: { text: `Verificare ${randomUUID().slice(0, 6)}` },
        headers: { ...garage, 'Idempotency-Key': randomUUID() },
      });
      expect(added.status()).toBe(201);
      step = ((await added.json()) as { id: string }).id;

      const cut = Date.now();
      await context.setOffline(false);
      await shows(panel(page), await stepsHeading(request, driver));
      test.info().annotations.push({
        description: `${Date.now() - cut} ms`,
        type: 'caught up after the cut',
      });
      await expect(panel(page).getByText('Reconectare…')).toBeHidden();
      await expect(link).toBeFocused();
    } finally {
      await context.setOffline(false);
      if (step) {
        await request.delete(`/api/v1/garage/jobs/${job}/steps/${step}`, {
          headers: garage,
        });
      }
      await context.close();
    }
  });
});
