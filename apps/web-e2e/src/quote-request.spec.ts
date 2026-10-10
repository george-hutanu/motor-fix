import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { hydrated, PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, which works on Dacia and has an oil change on its price list.
const DRIVER = 'cerere@example.test';
const OWNER = 'militari@example.test';
const PROFILE = '/ro/garages/service-auto-militari?brand=dacia';
const OIL = 'Schimb de ulei și filtre';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function signedInDriver(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, DRIVER);
  await expect(page).toHaveURL('/app/driver');
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const dialog = (page: Page, name: string | RegExp) =>
  page.getByRole('dialog', { name });

// The dialog's car picker: exact, as "Ce se întâmplă cu mașina" holds the word too.
const car = (quote: ReturnType<typeof dialog>) =>
  quote.getByRole('combobox', { exact: true, name: 'Mașina' });

// @seeded: a driver sends a request from a garage's profile against the real API.
// @traces 221-SC-001 221-SC-002 221-SC-007 221-FR-003
test.describe('a quote request from a garage profile @seeded', () => {
  test('goes out from the profile, shows in Cererile mele without a reload and reaches the garage', async ({
    page,
    request,
  }) => {
    await signedInDriver(page);
    // A click before hydration is lost: the button answers once Angular has it.
    await hydrated(page, PROFILE);
    await page.getByRole('button', { name: 'Cere ofertă' }).click();
    const quote = dialog(page, 'Cere ofertă');
    await expect(car(quote)).toContainText('Dacia Logan');
    await quote.getByRole('switch', { name: OIL }).click();

    const sent = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/quote-requests') &&
        r.request().method() === 'POST',
    );
    await quote.getByRole('button', { name: 'Trimite' }).click();
    const response = await sent;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    await expect(
      quote.getByText('Trimis către Service Auto Militari.'),
    ).toBeVisible();

    await quote.getByRole('link', { name: 'Vezi Cererile mele' }).click();
    await expect(page).toHaveURL('/app/driver/requests');
    const newest = page.locator('[data-request]').first();
    await expect(newest).toContainText('Dacia Logan');
    await expect(newest).toContainText(OIL);
    await expect(newest).toContainText('Trimisă');

    // The garage's side is read only: the seeded owner's state is not touched.
    const token = await accessToken(request, OWNER);
    const list = await request.get('/api/v1/garage/requests', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.ok()).toBe(true);
    const { items } = (await list.json()) as { items: { id: string }[] };
    expect(items.map((item) => item.id)).toContain(id);
  });

  test('asks a visitor to sign in over the dialog, then shows their car with nothing lost', async ({
    page,
  }) => {
    // The profile holds a live stream, so networkidle never comes.
    await hydrated(page, PROFILE);
    await page.getByRole('button', { name: 'Cere ofertă' }).click();

    // The cars read is refused for a visitor; the sign-in gate opens over the
    // dialog and the read is sent again once the driver is in.
    await signIn(page, DRIVER);

    await expect(page).toHaveURL(PROFILE);
    const quote = dialog(page, 'Cere ofertă');
    await expect(car(quote)).toContainText('Dacia Logan');
    await expect(quote.getByRole('switch', { name: OIL })).toBeVisible();
  });

  for (const [width, scheme, language] of [
    [320, 'light', 'ro'],
    [320, 'dark', 'en'],
    [390, 'dark', 'ro'],
  ] as const) {
    test(`the dialog fits a ${width} px phone, ${scheme}, ${language}, with no sideways scroll`, async ({
      page,
    }) => {
      // Signed in at the desktop size, where the header carries Autentificare
      // (a phone's header folds it into Cont), then narrowed.
      await signedInDriver(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 800, width });
      await hydrated(page, PROFILE.replace('/ro/', `/${language}/`));
      const name = language === 'ro' ? 'Cere ofertă' : 'Request a quote';
      await page.getByRole('button', { name }).click();
      const quote = dialog(page, name);
      await expect(
        quote.getByRole('button', {
          name: language === 'ro' ? 'Trimite' : 'Send',
        }),
      ).toBeVisible();

      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});

// The API's half (the rate, the threshold, the flag on each recipient) is in
// the quote-requests and requests integration specs. Here the real send goes
// out and its reply is handed to the dialog with the flag set, so the line's
// place and fit are checked on a phone without touching any garage's figures.
// @traces 1025-FR-001 1025-FR-006
test.describe('the confirmation for a garage that usually answers the same day @seeded', () => {
  test('says so under the sent line on a 320 px phone, with no sideways scroll', async ({
    page,
  }) => {
    await signedInDriver(page);
    await page.setViewportSize({ height: 800, width: 320 });
    await page.route('**/api/v1/quote-requests', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        recipients: { answersSameDay: boolean }[];
      };
      for (const recipient of body.recipients) recipient.answersSameDay = true;
      await route.fulfill({ json: body, response });
    });
    await hydrated(page, PROFILE);
    await page.getByRole('button', { name: 'Cere ofertă' }).click();
    const quote = dialog(page, 'Cere ofertă');
    await expect(car(quote)).toContainText('Dacia Logan');
    await quote.getByRole('switch', { name: OIL }).click();

    await quote.getByRole('button', { name: 'Trimite' }).click();

    const status = quote.getByRole('status');
    await expect(
      status.getByText('Trimis către Service Auto Militari.'),
    ).toBeVisible();
    await expect(
      status.getByText(
        'Service Auto Militari răspunde de obicei în aceeași zi.',
      ),
    ).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});
