import { randomUUID } from 'node:crypto';

import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  ACCOUNTS,
  openSignIn,
  ready,
  signIn,
  signUpDriver,
} from './accounts.js';
import { accessToken, bearer, confirmed, MILITARI } from './booking.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

const STAGE = {
  booked: 'Programată',
  done: 'Gata',
  in_work: 'În lucru',
  quoted: 'Ofertă',
  sent: 'Trimisă',
} as const;

const bucharestDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
});

// A driver of the test's own with a Dacia Logan: a driver may send 20
// requests a day, and the specs beside this one use the seeded driver's up.
async function ownDriver(request: APIRequestContext) {
  const email = await signUpDriver(request, 'live-etape');
  const driver = bearer(await accessToken(request, email));
  const brands = await request.get('/api/v1/brands?q=Dacia', {
    headers: driver,
  });
  const [dacia] = ((await brands.json()) as { items: { id: string }[] }).items;
  const car = await request.post('/api/v1/cars', {
    data: {
      brandId: dacia.id,
      fuel: 'petrol',
      model: 'Logan',
      odometerKm: 98_000,
      year: 2018,
    },
    headers: { ...driver, 'Idempotency-Key': randomUUID() },
  });
  expect(car.status(), await car.text()).toBe(201);
  return email;
}

// A job of this test's own: a request of the test's own driver booked and
// confirmed at Militari, received, with one step whose text no other test
// writes. Every assertion follows that step, so other workers' writes to the
// shared seed never move what the test waits for.
async function ownJob(request: APIRequestContext) {
  const garage = bearer(await accessToken(request, MILITARI));
  const driver = await ownDriver(request);
  const { bookingId, startsAt } = await confirmed(request, driver);
  // Followed page by page: jobs in work sort first and could fill the first.
  const from = bucharestDay.format(new Date(startsAt));
  type Job = { bookingId: string; car: { odometerKm: number }; id: string };
  let job: Job | undefined;
  let cursor: string | null = null;
  do {
    const page = await request.get(
      `/api/v1/garage/jobs?from=${from}${cursor ? `&cursor=${cursor}` : ''}`,
      { headers: garage },
    );
    expect(page.ok()).toBe(true);
    const body = (await page.json()) as {
      items: Job[];
      nextCursor: string | null;
    };
    job = body.items.find((item) => item.bookingId === bookingId);
    cursor = body.nextCursor;
  } while (!job && cursor);
  expect(job).toBeDefined();
  const id = job?.id ?? '';
  const call = async (verb: string, data?: object) => {
    const res = await request.post(`/api/v1/garage/jobs/${id}/${verb}`, {
      data,
      headers: garage,
    });
    expect(res.ok(), `${verb}: ${res.status()}`).toBe(true);
  };
  await call('receive', { odometerKm: job?.car.odometerKm ?? 0 });
  const text = `Verificare ${randomUUID().slice(0, 8)}`;
  const added = await request.post(`/api/v1/garage/jobs/${id}/steps`, {
    data: { text },
    headers: { ...garage, 'Idempotency-Key': randomUUID() },
  });
  expect(added.status()).toBe(201);
  const step = ((await added.json()) as { id: string }).id;
  const tick = async () => {
    const res = await request.put(
      `/api/v1/garage/jobs/${id}/steps/${step}/done`,
      { data: { done: true }, headers: garage },
    );
    expect(res.ok()).toBe(true);
  };
  // Leaves no job of the test's in work, whatever stage it stopped at.
  const close = async () => {
    for (const verb of ['resume', 'start', 'finish']) {
      await request.post(`/api/v1/garage/jobs/${id}/${verb}`, {
        headers: garage,
      });
    }
  };
  return { call, close, driver, id, text, tick };
}

async function signedIn(
  context: BrowserContext,
  email: string,
  landing: string,
) {
  const page = await context.newPage();
  await page.setViewportSize({ height: 844, width: 390 });
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, email);
  await expect(page).toHaveURL('/app/driver');
  if (landing !== '/app/driver') await page.goto(landing);
  return page;
}

const panel = (page: Page) => page.locator('mf-active-request');
const stepOf = (where: Locator, text: string) =>
  where.locator('li[data-step]', { hasText: text });
const current = (where: Locator) =>
  where.locator('ol > li[aria-current="step"]');
// Within seconds and without a reload.
const SOON = { timeout: 10_000 };

// The same check on every page, in turn.
async function onEach(pages: Page[], check: (shown: Locator) => Promise<void>) {
  for (const page of pages) await check(panel(page));
}

// Every non-GET call the pages send to the API from now on.
function writesOf(pages: Page[]) {
  const writes: string[] = [];
  for (const page of pages) {
    page.on('request', (sent) => {
      if (sent.url().includes('/api/') && sent.method() !== 'GET') {
        writes.push(`${sent.method()} ${sent.url()}`);
      }
    });
  }
  return writes;
}

// @seeded: Militari of the seed, and a driver of each test's own.
test.describe('each stage change within seconds @seeded', () => {
  // @traces 275-FR-001
  // @traces 275-FR-003
  // @traces 275-FR-006
  // @traces 275-FR-008
  // @traces 275-FR-009
  test('the garage’s start, pause, resume, tick and finish reach the overview, Cererile mele and a second tab without a reload', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const job = await ownJob(request);
    const home = await browser.newContext();
    let list: BrowserContext | undefined;
    try {
      list = await browser.newContext();
      const overview = await signedIn(home, job.driver, '/app/driver');
      const requests = await signedIn(list, job.driver, '/app/driver/requests');
      // A second tab of the overview's browser shares its stream.
      const second = await home.newPage();
      await second.setViewportSize({ height: 844, width: 390 });
      await second.goto('/app/driver');
      const pages = [overview, requests, second];
      await onEach(pages, (shown) => expect(current(shown)).toBeVisible(SOON));
      // From here the driver's pages only read: no write of any kind.
      const writes = writesOf(pages);

      // Started most recently, the job's request is the one in work shown.
      await job.call('start');
      await onEach(pages, async (shown) => {
        await expect(stepOf(shown, job.text)).toBeVisible(SOON);
        await expect(current(shown)).toHaveText(STAGE.in_work);
        await expect(shown.locator('dt', { hasText: 'Început' })).toBeVisible();
      });

      await job.call('pause');
      await onEach(pages, (shown) =>
        expect(shown.getByText('În pauză')).toBeVisible(SOON),
      );
      await job.call('resume');
      await onEach(pages, (shown) =>
        expect(shown.getByText('În pauză')).toBeHidden(SOON),
      );

      await job.tick();
      await onEach(pages, async (shown) => {
        await expect(stepOf(shown, job.text)).toHaveAttribute(
          'data-state',
          'done',
          SOON,
        );
        await expect(
          shown.getByRole('heading', { name: /1 din 1 gata/ }),
        ).toBeVisible();
      });

      // The test's driver has this one request: once finished, every page
      // shows the stage the active read now gives, or no request at all.
      await job.call('finish');
      const read = await request.get('/api/v1/quote-requests/active', {
        headers: bearer(await accessToken(request, job.driver)),
      });
      expect(read.ok()).toBe(true);
      const { request: shown } = (await read.json()) as {
        request: { stage: keyof typeof STAGE } | null;
      };
      await onEach(pages, (where) =>
        shown
          ? expect(current(where)).toHaveText(STAGE[shown.stage], SOON)
          : expect(stepOf(where, job.text)).toBeHidden(SOON),
      );

      expect(overview.url()).toMatch(/\/app\/driver$/);
      expect(requests.url()).toMatch(/\/app\/driver\/requests$/);
      expect(writes).toEqual([]);
    } finally {
      await job.close();
      await home.close();
      await list?.close();
    }
  });

  // @traces 275-FR-002
  // @traces 275-FR-005
  test('after a network cut the panel says Reconectare… and catches up on what changed meanwhile, keeping the focus', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const job = await ownJob(request);
    const context = await browser.newContext();
    try {
      await job.call('start');
      const page = await signedIn(context, job.driver, '/app/driver');
      const step = stepOf(panel(page), job.text);
      await expect(step).toBeVisible(SOON);
      await expect(step).not.toHaveAttribute('data-state', 'done');
      const link = panel(page).getByRole('link', {
        exact: true,
        name: 'Cerere nouă',
      });
      await link.focus();

      await context.setOffline(true);
      await expect(
        panel(page).getByRole('status').filter({ hasText: 'Reconectare…' }),
      ).toBeVisible({ timeout: 20_000 });
      await job.tick();

      const cut = Date.now();
      await context.setOffline(false);
      await expect(step).toHaveAttribute('data-state', 'done', SOON);
      test.info().annotations.push({
        description: `${Date.now() - cut} ms`,
        type: 'caught up after the cut',
      });
      await expect(panel(page).getByText('Reconectare…')).toBeHidden();
      await expect(link).toBeFocused();
    } finally {
      await context.setOffline(false);
      await job.close();
      await context.close();
    }
  });

  // @traces 275-FR-004
  test('the job’s change reaches its driver’s stream and never another driver’s', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const job = await ownJob(request);
    await ready(page, '/ro');

    // Each stream's text over the next few seconds, read in the page; a
    // stream counts itself open in `window.opened` once its headers arrive.
    const listen = (authorization: string) =>
      page.evaluate(async (auth) => {
        const marks = window as unknown as { opened?: number };
        const stop = new AbortController();
        setTimeout(() => stop.abort(), 6_000);
        const res = await fetch('/api/v1/live', {
          headers: { Accept: 'text/event-stream', Authorization: auth },
          signal: stop.signal,
        }).catch(() => null);
        marks.opened = (marks.opened ?? 0) + 1;
        if (!res?.body) return '';
        // The stream's text until the window closes it.
        const decoder = new TextDecoder();
        let text = '';
        await res.body
          .pipeTo(
            new WritableStream<Uint8Array>({
              write: (chunk) => {
                text += decoder.decode(chunk, { stream: true });
              },
            }),
          )
          .catch(() => undefined);
        return text;
      }, authorization);
    const tokenOf = async (email: string) =>
      bearer(await accessToken(request, email)).Authorization;

    try {
      const mine = listen(await tokenOf(job.driver));
      const theirs = listen(await tokenOf(ACCOUNTS.otherDriver));
      // Both streams open before the garage writes.
      await page.waitForFunction(
        () => ((window as unknown as { opened?: number }).opened ?? 0) >= 2,
      );
      await job.call('start');
      const [driverText, otherText] = await Promise.all([mine, theirs]);
      // A job event's data carries the job's id.
      expect(driverText).toContain(job.id);
      expect(otherText).not.toContain(job.id);
    } finally {
      await job.close();
    }
  });
});
