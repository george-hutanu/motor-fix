import { type BrowserContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, signIn } from './accounts.js';
import { COLLECTOR, needsAnalytics, test } from './fixtures.js';
import { ownDriver } from './own-driver.js';

const GARAGE = 'Service Auto Militari';
const PROFILE = '/ro/garages/service-auto-militari?brand=dacia';
const OIL = 'Schimb de ulei și filtre';

interface Sent {
  n: string;
  u?: string;
  p?: Record<string, string | number>;
}

// Answers plausible.io here, as analytics.spec.ts does: a stand-in script
// that posts each call with its name and properties, which are recorded.
// `calls` counts every request to plausible.io, the script itself included.
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

// A context of its own, so the fixture's voice 1 pin does not apply: the
// first load of the tab takes voice 2 off the stored round, and every later
// load keeps it.
async function voiceTwo(context: BrowserContext) {
  await context.route(COLLECTOR, (route) => route.fulfill({ status: 204 }));
  await context.addInitScript(() => {
    if (sessionStorage.getItem('e2e-voice-set')) return;
    sessionStorage.setItem('e2e-voice-set', '1');
    localStorage.setItem('mf-copy-deck', '2');
    localStorage.removeItem('mf-copy');
    localStorage.removeItem('mf-copy-at');
  });
}

const bar = (page: Page) =>
  page.getByRole('region', { name: 'Statistici de utilizare' });

async function signedIn(page: Page, email: string) {
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/driver');
}

// An oil change request to the garage, from its profile; answers the body the
// browser posted.
async function sendRequest(page: Page) {
  await ready(page, PROFILE);
  await expect(page.locator('html')).toHaveAttribute('data-voice', '2');
  await page.getByRole('button', { exact: true, name: 'Cere ofertă' }).click();
  const quote = page.getByRole('dialog', { name: 'Cere ofertă' });
  await expect(
    quote.getByRole('combobox', { exact: true, name: 'Mașina' }),
  ).toContainText('Dacia Logan');
  await quote.getByRole('switch', { name: OIL }).click();
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/v1/quote-requests') &&
      r.request().method() === 'POST',
  );
  await quote.getByRole('button', { name: 'Trimite' }).click();
  const response = await sent;
  expect(response.status()).toBe(201);
  await expect(quote.getByText(`Trimis către ${GARAGE}.`)).toBeVisible();
  return response.request().postDataJSON() as Record<string, unknown>;
}

async function storedVoices(email: string) {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    const { rows } = await db.query<{ copy_voice: number | null }>(
      `SELECT qr.copy_voice FROM quote_request qr
       JOIN account a ON a.id = qr.driver_id WHERE a.email = $1`,
      [email],
    );
    return rows.map((row) => row.copy_voice);
  } finally {
    await db.end();
  }
}

// @traces 009-FR-012
test.describe('copy voice analytics', { tag: '@database' }, () => {
  test('sends the voice on the Home visit, the request events and the stored request with consent', async ({
    browser,
    request,
  }) => {
    await needsAnalytics(request);
    const driver = await ownDriver(request, 'voice-consent');
    const context = await browser.newContext();
    try {
      await voiceTwo(context);
      const page = await context.newPage();
      const { events } = await plausible(page);

      await ready(page, '/ro');
      await expect(page.locator('html')).toHaveAttribute('data-voice', '2');
      await bar(page)
        .getByRole('button', { exact: true, name: 'Accept' })
        .click();
      await signedIn(page, driver.email);
      const body = await sendRequest(page);

      await expect
        .poll(() => events.map(({ n }) => n))
        .toEqual(['home_visit', 'quote_request_started', 'quote_request_sent']);
      expect(events[0]?.p).toEqual({ voice: 2 });
      expect(events[1]?.p).toMatchObject({ voice: 2 });
      expect(events[2]?.p).toMatchObject({ voice: 2 });
      expect(body['copyVoice']).toBe(2);
      expect(await storedVoices(driver.email)).toEqual([2]);
    } finally {
      await context.close();
      await driver.remove();
    }
  });

  test('sends no analytics call and stores no voice without consent', async ({
    browser,
    request,
  }) => {
    const driver = await ownDriver(request, 'voice-no-consent');
    const context = await browser.newContext();
    try {
      await voiceTwo(context);
      const page = await context.newPage();
      const { calls } = await plausible(page);

      await ready(page, '/ro');
      await expect(page.locator('html')).toHaveAttribute('data-voice', '2');
      await expect(bar(page)).toBeVisible();
      await signedIn(page, driver.email);
      const body = await sendRequest(page);

      expect(calls).toEqual([]);
      expect(body).not.toHaveProperty('copyVoice');
      expect(await storedVoices(driver.email)).toEqual([null]);
    } finally {
      await context.close();
      await driver.remove();
    }
  });
});
