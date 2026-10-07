import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';

import { ACCOUNTS, PASSWORD, ready, signIn } from './accounts.js';

const SETTINGS = '/app/driver/settings';
const PREFERENCES = '/api/v1/notification-preferences';
const TITLES = [
  'Ofertă nouă',
  'Programare',
  'Scadențe',
  'Noutăți MotorFix',
  'Recenzii și istoric',
];

type Preferences = {
  groups: { key: string; enabled: boolean }[];
  newsConsent: {
    state: string;
    textVersion: string | null;
    currentTextVersion: string;
  };
};

async function headers(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: ACCOUNTS.driver, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

async function read(request: APIRequestContext) {
  const res = await request.get(PREFERENCES, {
    headers: await headers(request),
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Preferences;
}

const enabled = (answer: Preferences, key: string) =>
  answer.groups.find((group) => group.key === key)?.enabled;

// Every group back to its default, so the suite can run twice on one database.
async function restore(request: APIRequestContext) {
  const saved = await request.put(PREFERENCES, {
    data: {
      groups: [
        'offers',
        'bookings',
        'due_dates',
        'news',
        'reviews_history',
      ].map((key) => ({ enabled: key !== 'news', key })),
    },
    headers: await headers(request),
  });
  expect(saved.ok()).toBe(true);
}

const switchOf = (page: Page, name: string) =>
  page.getByRole('switch', { exact: true, name });

async function signedInSettings(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.driver);
  await expect(page).toHaveURL('/app/driver');
  // The live stream stays open, so the page never goes network-idle.
  await page.goto(SETTINGS);
  await expect(switchOf(page, 'Scadențe')).toBeEnabled();
}

const saving = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith(PREFERENCES) && r.request().method() === 'PUT',
  );

test.describe("the driver's notification switches @seeded", () => {
  // Every test signs in as the same driver and resets the same rows.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => restore(request));
  test.afterEach(async ({ request }) => restore(request));

  test('shows the five groups with their defaults, and keeps Scadențe off after a reload and a new sign-in', async ({
    page,
    request,
  }) => {
    await signedInSettings(page);

    await expect(
      page
        .getByRole('region', { exact: true, name: 'Notificări' })
        .getByRole('switch'),
    ).toHaveCount(TITLES.length);
    for (const title of TITLES) {
      const toggle = switchOf(page, title);
      if (title === 'Noutăți MotorFix') await expect(toggle).not.toBeChecked();
      else await expect(toggle).toBeChecked();
    }
    await expect(
      page.getByText(
        'Mereu trimise: programarea confirmată, ora nouă propusă de service, programarea anulată sau expirată, mașina e gata.',
      ),
    ).toBeVisible();

    const saved = saving(page);
    await switchOf(page, 'Scadențe').click();
    expect((await saved).ok()).toBe(true);
    await expect(switchOf(page, 'Scadențe')).not.toBeChecked();

    await page.reload();
    await expect(switchOf(page, 'Scadențe')).toBeEnabled();
    await expect(switchOf(page, 'Scadențe')).not.toBeChecked();

    await page.getByRole('button', { name: 'Ieși din cont' }).click();
    await expect(page).toHaveURL('/');
    await signedInSettings(page);
    await expect(switchOf(page, 'Scadențe')).not.toBeChecked();
    expect(enabled(await read(request), 'due_dates')).toBe(false);
  });

  test('turns MotorFix news on only after the driver agrees, and withdraws it when turned off', async ({
    page,
    request,
  }) => {
    await signedInSettings(page);
    const news = switchOf(page, 'Noutăți MotorFix');

    await news.click();
    const dialog = page.getByRole('dialog', {
      name: 'Primești noutăți MotorFix?',
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { exact: true, name: 'Renunță' }).click();
    await expect(dialog).toBeHidden();
    await expect(news).not.toBeChecked();
    expect(enabled(await read(request), 'news')).toBe(false);

    await news.click();
    const given = saving(page);
    await dialog
      .getByRole('button', { exact: true, name: 'Sunt de acord' })
      .click();
    expect((await given).ok()).toBe(true);
    await expect(news).toBeChecked();
    const on = await read(request);
    expect(enabled(on, 'news')).toBe(true);
    expect(on.newsConsent.state).toBe('given');
    expect(on.newsConsent.textVersion).toBe(on.newsConsent.currentTextVersion);

    const withdrawn = saving(page);
    await news.click();
    expect((await withdrawn).ok()).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(news).not.toBeChecked();
    expect((await read(request)).newsConsent.state).toBe('withdrawn');
  });

  test('puts the switch back and says so when the save fails', async ({
    page,
  }) => {
    await signedInSettings(page);
    await page.route(`**${PREFERENCES}`, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ body: '{}', status: 500 })
        : route.continue(),
    );

    await switchOf(page, 'Programare').click();

    await expect(page.getByText('Setarea nu a putut fi salvată')).toBeVisible();
    await expect(switchOf(page, 'Programare')).toBeChecked();
  });

  test('fits a 320 px phone with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await signedInSettings(page);

    await expect(switchOf(page, 'Recenzii și istoric')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
