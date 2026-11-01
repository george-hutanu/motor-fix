import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
} from '@playwright/test';

// The accounts libs/domain/src/seed.ts adds outside production. Their password
// is a fake default locally and in CI; a deployed address has its own secret.
export const PASSWORD = process.env['E2E_PASSWORD'] || 'parola-de-test';

export const ACCOUNTS = {
  admin: 'admin@example.test',
  // A second admin, so a rule that needs two can be asked and approved.
  admin2: 'admin2@example.test',
  // The owner of Atelier Nou, a garage still waiting for approval.
  draftOwner: 'nou@example.test',
  driver: 'sofer@example.test',
  garage: 'service@example.test',
  // Garage only, with no garage: adding a first car makes it a driver.
  garageOnly: 'masina-noua@example.test',
  mechanic: 'mecanic@example.test',
  otherDriver: 'sofer2@example.test',
  receptionist: 'receptie@example.test',
  staleDriver: 'termeni-vechi@example.test',
  suspended: 'suspendat@example.test',
  switcher: 'comutare@example.test',
  twoRoles: 'doua-roluri@example.test',
} as const;

let addresses = 0;
// Sign-up is limited per address per hour, and every test comes from this
// machine: each sign-up comes from an address of its own, on the TEST-NET
// block a spec names so two specs never share one.
export async function ownAddress(page: Page, net: string) {
  const address = `${net}.${(Date.now() + ++addresses) % 250}`;
  await page.route('**/api/v1/auth/sign-up', (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  );
}

// Waits for the page to take clicks: the server-rendered HTML arrives first.
export async function ready(page: Page, path: string) {
  await page.goto(path);
  await settled(page);
}

// Waits for the page to take clicks. A public page is rendered by the server
// and opens the public live stream once quiet, a stream that never ends, so
// networkidle may never come: wait for hydration instead. A dashboard is drawn
// in the browser alone, with no hydration marker, and keeps networkidle.
export async function settled(page: Page) {
  if (new URL(page.url()).pathname.startsWith('/app/')) {
    await page.waitForLoadState('networkidle');
    return;
  }
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !document.querySelector('[ngh]'));
}

// Hydrated is not yet listening: with event replay, Angular holds a hydrated
// node's listeners back and queues what the person does until the app is
// first stable, then replays it and clears its early event contract
// (window._ejsas[appId]). A key pressed before that may land only seconds
// later. Wait for the contract to be cleared before asserting what a key does.
export async function listening(page: Page, path?: string) {
  await hydrated(page, path);
  await page.waitForFunction(() =>
    Object.values(
      (window as { _ejsas?: Record<string, unknown> })._ejsas ?? {},
    ).every((contract) => contract === undefined),
  );
}

// The results map shows a static image until the driver asks for the
// interactive one: a test that drives MapLibre asks for it first, through the
// map's control, and waits for the static layer to go (it also goes when the
// interactive map cannot load).
// On a phone the sheet can rest over the control, which then hides
// (static-map.css): a tap on whatever part of the image shows still asks.
// With the consent bar asking on a 320 x 568 phone the bar and the sheet
// above it hide the whole image at every rest: the image is asked through its
// own click then, leaving the bar and the sheet as the test set them.
export async function openMap(page: Page) {
  const still = page.locator('mf-results-map mf-static-map');
  const button = still.getByRole('button');
  await expect(async () => {
    if (await button.isVisible()) return button.click({ timeout: 1_000 });
    const spot = await still.evaluate((map) => {
      const box = map.getBoundingClientRect();
      const spots = Array.from({ length: Math.ceil(box.height / 8) }, (_, i) =>
        Array.from({ length: Math.ceil(box.width / 8) }, (_, j) => ({
          x: 4 + j * 8,
          y: 4 + i * 8,
        })),
      ).flat();
      return spots.find(({ x, y }) =>
        map.contains(document.elementFromPoint(box.left + x, box.top + y)),
      );
    });
    if (!spot) return still.dispatchEvent('click');
    await still.click({ position: spot, timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await still.waitFor({ state: 'detached' });
}

// The place step's map reads the app's own empty style: no outside tiles, and
// no software WebGL render holding the page's thread.
export const ownMap = (target: Page | BrowserContext) =>
  target.addInitScript(() => {
    (window as { __MF_MAP_STYLE?: string }).__MF_MAP_STYLE =
      '/map/empty-style.json';
  });

// Angular drops each server-rendered node's ngh marker as it hydrates it, so
// none left means the page answers. Unlike networkidle, it still comes on a
// page that holds a live stream, which never ends. Only for a page the server
// renders: one drawn in the browser alone has no marker to wait for. Without
// a path it waits on the page already there, after a reload. It keeps the
// page's default timeout, the one goto and the networkidle wait it replaces
// use, rather than setting one of its own.
export async function hydrated(page: Page, path?: string) {
  if (path !== undefined) await page.goto(path);
  await page.waitForFunction(() => !document.querySelector('[ngh]'));
}

export async function signIn(
  page: Page,
  email: string,
  { password = PASSWORD, remember = true } = {},
) {
  const dialog = page.getByRole('dialog', { name: 'Autentificare' });
  // The panel: on a phone the dialog container around the sheet has no box.
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByLabel('E‑mail').fill(email);
  await dialog.getByLabel('Parolă').fill(password);
  if (!remember) await dialog.getByLabel('Ține‑mă autentificat').uncheck();
  await dialog.getByRole('button', { name: 'Intră în cont' }).click();
}

// Signs in at the width the site bar shows its button at, waits for the
// landing page, then goes back to the page's own size.
export async function signedIn(
  page: Page,
  email: string,
  landing: string | RegExp,
  password = PASSWORD,
) {
  const size = page.viewportSize();
  await page.setViewportSize({ height: 900, width: 1280 });
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email, { password });
  await expect(page).toHaveURL(landing);
  if (size) await page.setViewportSize(size);
}

// A driver of the caller's own, signed up with the seeded password, for a
// flow that must not share a seeded driver another spec signs in with at the
// same time. Each sign-up comes from an address of its own (the API admits 10
// an hour from one), so a test repeated twenty times never meets the limit.
export async function signUpDriver(request: APIRequestContext, tag: string) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${tag}-${stamp}@example.test`;
  const address = `198.19.${Math.floor(Math.random() * 250)}.${Date.now() % 250}`;
  const res = await request.post('/api/v1/auth/sign-up', {
    data: {
      consent: CURRENT_CONSENT,
      email,
      language: 'ro',
      name: `Șofer ${stamp}`,
      password: PASSWORD,
    },
    headers: { 'x-forwarded-for': address },
  });
  expect(res.status(), await res.text()).toBe(201);
  return email;
}

// A bearer header for one seeded account, for the API calls a flow sets up with.
export async function headers(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}

// Opens the sign-in dialog as the public frame offers it at this width: a
// phone from the tab bar's account link, a tablet (768 to 1023 px) from the
// top bar's account button, which stands in for the sign-in link there, and a
// desktop from the top bar's sign-in button.
const BAR = {
  en: { account: 'Account', nav: 'Main navigation', signIn: 'Sign in' },
  ro: { account: 'Cont', nav: 'Navigare principală', signIn: 'Autentificare' },
} as const;

export async function openSignIn(page: Page, language: 'ro' | 'en' = 'ro') {
  const width = page.viewportSize()?.width ?? 1280;
  const bar = BAR[language];
  const opener =
    width < 768
      ? page
          .getByRole('navigation', { name: bar.nav })
          .getByRole('link', { exact: true, name: bar.account })
      : page.getByRole('banner').getByRole('button', {
          exact: true,
          name: width < 1024 ? bar.account : bar.signIn,
        });
  await opener.click();
}

// The second admin, signed in from the public header, landing on the dashboard.
export async function signInAsAdmin2(page: Page) {
  await ready(page, '/ro/garages');
  await openSignIn(page);
  await signIn(page, ACCOUNTS.admin2);
  await expect(page).toHaveURL('/app/admin');
}
