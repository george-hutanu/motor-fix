import { expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { needsAnalytics, test } from './fixtures.js';

// The seeded driver with a Dacia Logan, and Service Auto Militari, which works
// on Dacia and has an oil change on its price list; Atelier Berceni, near it,
// takes the same oil change for Dacia.
const DRIVER = 'cerere@example.test';
const GARAGE = 'Service Auto Militari';
const SLUG = 'service-auto-militari';
const NEARBY = 'Atelier Berceni';
// Militari itself, as a place picked on Home: the request then lists the
// garages near it.
const MILITARI = { label: 'Militari', lat: 44.435, lng: 26.015 };
const OIL = 'Schimb de ulei și filtre';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface Sent {
  n: string;
  u?: string;
  p?: Record<string, string | number>;
}

// Answers plausible.io here, so nothing leaves: a stand-in script that posts
// each call with its name, page and properties, which are recorded. `calls`
// counts every request to plausible.io, the script itself included.
async function plausible(page: Page) {
  const events: Sent[] = [];
  const calls: string[] = [];
  await page.route('https://plausible.io/**', (route) => {
    const request = route.request();
    calls.push(request.url());
    if (request.url().endsWith('.js')) {
      return route.fulfill({
        body: `(() => {
          const send = (n, options) => fetch('https://plausible.io/api/event', {
            body: JSON.stringify({ n, u: options && options.u, p: options && options.props }),
            method: 'POST',
          });
          const queued = (window.plausible && window.plausible.q) || [];
          window.plausible = send;
          for (const args of queued) send(...args);
        })();`,
        contentType: 'text/javascript',
      });
    }
    const sent = request.postDataJSON() as Sent | null;
    if (sent && sent.n !== 'pageview') events.push(sent);
    return route.fulfill({ status: 202 });
  });
  return { calls, events };
}

const bar = (page: Page) =>
  page.getByRole('region', { name: 'Statistici de utilizare' });

const accept = (page: Page) =>
  bar(page).getByRole('button', { exact: true, name: 'Accept' }).click();

async function signedIn(page: Page) {
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, DRIVER);
  await expect(page).toHaveURL('/app/driver');
}

// The place the browser keeps, set before any page reads it.
const nearMilitari = (page: Page) =>
  page.addInitScript((place) => {
    localStorage.setItem(
      'mf-place',
      JSON.stringify({ ...place, origin: 'address' }),
    );
  }, MILITARI);

// Home → a brand → Results → the garage's profile, as a driver walks it.
async function toProfile(page: Page, near?: typeof MILITARI) {
  await ready(page, '/ro');
  await page
    .getByRole('radiogroup', { name: 'Marca mașinii' })
    .getByRole('radio', { exact: true, name: 'Dacia' })
    .click();
  await page.getByRole('link', { name: 'Caută service‑uri' }).click();
  if (near) {
    await expect(page).toHaveURL(/^[^?]*\/ro\/garages\?/);
    const query = new URL(page.url()).searchParams;
    expect(query.get('brand')).toBe('dacia');
    expect(query.get('near')).toBe(`${near.lat},${near.lng}`);
  } else {
    await expect(page).toHaveURL('/ro/garages?brand=dacia');
  }
  await page
    .locator('article.card', {
      has: page.getByRole('heading', { exact: true, name: GARAGE }),
    })
    .getByRole('link', { name: 'Vezi service‑ul' })
    .click();
  await expect(page).toHaveURL(`/ro/garages/${SLUG}?brand=dacia`);
  await expect(
    page.getByRole('heading', { level: 1, name: GARAGE }),
  ).toBeVisible();
}

// The request for an oil change to this garage and the nearby ones ticked.
async function sendRequest(page: Page, others: string[] = []) {
  await page.getByRole('button', { name: 'Cere ofertă' }).click();
  const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
  await expect(
    quote.getByRole('combobox', { exact: true, name: 'Mașina' }),
  ).toContainText('Dacia Logan');
  await quote.getByRole('switch', { name: OIL }).click();
  for (const name of others) {
    await quote.getByRole('checkbox', { name }).check();
  }
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/v1/quote-requests') &&
      r.request().method() === 'POST',
  );
  await quote.getByRole('button', { name: 'Trimite' }).click();
  const response = await sent;
  expect(response.status()).toBe(201);
  await expect(
    quote.getByText(
      others.length === 0
        ? `Trimis către ${GARAGE}.`
        : `Trimis către ${others.length + 1} service‑uri.`,
    ),
  ).toBeVisible();
}

const named = (events: Sent[]) => events.map(({ n, p }) => ({ n, p }));

// @traces 250-FR-001
// @traces 250-FR-002
// @traces 250-FR-003
// @traces 250-FR-005
// @traces 250-FR-010
test.describe('the launch events @seeded', () => {
  test('follow a driver from a brand to a request sent to two garages once analytics are accepted, naming no garage', async ({
    page,
    request,
  }) => {
    await needsAnalytics(request);
    const { events } = await plausible(page);
    await nearMilitari(page);
    await ready(page, '/ro');
    await accept(page);
    await signedIn(page);

    await toProfile(page, MILITARI);
    await sendRequest(page, [NEARBY]);

    await expect
      .poll(() => named(events))
      .toEqual([
        { n: 'brand_picked', p: { brand: 'dacia', source: 'home_picker' } },
        { n: 'garage_opened', p: { source: 'results' } },
        { n: 'quote_request_started', p: { source: 'profile' } },
        {
          n: 'quote_request_sent',
          p: { brand: 'dacia', garages: '2–3', jobs: 1 },
        },
      ]);
    for (const { u, p } of events) {
      expect(u ?? '').not.toMatch(UUID);
      expect(u ?? '').not.toContain(SLUG);
      expect(JSON.stringify(p)).not.toMatch(UUID);
    }
  });

  test('send nothing after a refusal, the walk unchanged', async ({ page }) => {
    const { calls } = await plausible(page);
    await ready(page, '/ro');
    await bar(page).getByRole('button', { exact: true, name: 'Refuz' }).click();

    await toProfile(page);

    expect(calls).toEqual([]);
  });

  test('send nothing while the bar is left unanswered', async ({ page }) => {
    const { calls } = await plausible(page);

    await toProfile(page);

    await expect(bar(page)).toBeVisible();
    expect(calls).toEqual([]);
  });

  test('stop the moment analytics are turned off mid-walk, and the request still goes', async ({
    page,
    request,
  }) => {
    await needsAnalytics(request);
    const { events } = await plausible(page);
    await ready(page, '/ro');
    await accept(page);
    await signedIn(page);
    await toProfile(page);
    await expect.poll(() => events.length).toBe(2);

    await page
      .getByRole('button', { exact: true, name: 'Setări cookie' })
      .click();
    const settings = page.getByRole('dialog', { name: 'Setări cookie' });
    await settings
      .getByRole('switch', { name: 'Statistici de utilizare' })
      .click();
    await settings
      .getByRole('button', { exact: true, name: 'Salvează' })
      .click();
    await expect(settings).toBeHidden();
    await sendRequest(page);

    expect(named(events).map(({ n }) => n)).toEqual([
      'brand_picked',
      'garage_opened',
    ]);
  });

  test('leave the walk working when Plausible is blocked', async ({
    page,
    request,
  }) => {
    await needsAnalytics(request);
    await page.route('https://plausible.io/**', (route) => route.abort());
    await ready(page, '/ro');
    await accept(page);

    await toProfile(page);

    await page.getByRole('button', { name: 'Cere ofertă' }).click();
    // A visitor gets the request dialog, then the sign-in dialog over it once
    // the API answers 401; either may be open, so check the topmost.
    await expect(
      page.getByRole('dialog', { name: /Cere ofertă|Autentificare/ }).last(),
    ).toBeVisible();
  });
});
