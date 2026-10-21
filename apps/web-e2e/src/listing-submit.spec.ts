import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import { ACCOUNTS, ownAddress, ownMap, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { JOBS, jpeg, KEPT } from './listing-kept.js';

test.beforeEach(({ context }) => ownMap(context));

// A fake password for the accounts these tests create; never a real one.
const NEW_PASSWORD = 'parola-noua-de-test';

const TEXT = {
  en: {
    heading: 'Request received. We check it within 1–2 working days.',
    preview: 'Under review · not published',
    stages: ['Submitted', 'Under review', 'Approved, on the map'],
  },
  ro: {
    heading: 'Am primit cererea. O verificăm în 1–2 zile lucrătoare.',
    preview: 'În verificare · nepublicat',
    stages: ['Trimis', 'În verificare', 'Aprobat, pe hartă'],
  },
} as const;

type Language = keyof typeof TEXT;

const prices = (page: Page) => page.locator('mf-prices-step');
const photos = (page: Page) => page.locator('mf-photos-step');
const confirmation = (page: Page) =>
  page.locator('mf-missing-summary .summary');
const survey = (page: Page) => page.locator('mf-signup-survey');
const panel = (page: Page) =>
  page.getByRole('dialog').locator('mf-overlay-panel');
const statusView = (page: Page) => page.locator('.status-view');
const current = (scope: Locator) =>
  scope.locator('mf-verification-stages li[aria-current="step"] .name');

async function range(page: Page, name: string, from: string, to: string) {
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, de la` })
    .fill(from);
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, până la` })
    .fill(to);
}

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A listing with nothing missing, under a name of its own so the admin's
// queue shows its row; the e-mail is the one the sign-up dialog starts with.
async function fillListing(context: BrowserContext, page: Page, name: string) {
  const copy = structuredClone(KEPT);
  copy.data.steps['1'].name = name;
  await context.addInitScript((kept) => {
    if (sessionStorage.getItem('kept')) return;
    localStorage.setItem('mf.listing-draft', kept);
    sessionStorage.setItem('kept', '1');
  }, JSON.stringify(copy));
  await ready(page, '/ro/list-your-garage');
  const email = `trimis-${unique()}@example.test`;
  await page.getByLabel('E‑mail').fill(email);
  await page.getByLabel('E‑mail').blur();
  // The photo picker opens once the draft exists on the server.
  await expect(
    photos(page).getByRole('button', { name: 'Alege fotografii' }),
  ).toBeEnabled();
  // The most popular brand, whichever the catalogue ranks first.
  await page.locator('mf-brands-step .chips > li > button').first().click();
  await range(page, 'Manoperă, pe oră', '120', '200');
  for (const [job, from, to] of JOBS) await range(page, job, from, to);
  await photos(page)
    .locator('input[type="file"]')
    .setInputFiles([jpeg('fata.jpg')]);
  // The photo counts only once its upload has a key on the server.
  await expect(photos(page).locator('li.photo').first()).toHaveAttribute(
    'data-key',
    /garage_photo\//,
  );
}

// The public frame's switch, in a menu on a phone: a click that does not
// scroll, as the listing check spec does.
async function switchTo(page: Page, language: Language) {
  if (language === 'ro') return;
  await page
    .getByRole('group', { includeHidden: true, name: 'Limba' })
    .getByRole('button', { includeHidden: true, name: 'EN' })
    .dispatchEvent('click');
  await expect(page).toHaveURL(/\/en\/list-your-garage/);
}

async function press(page: Page, language: Language) {
  await page.locator('.actions .send').click();
  await expect(confirmation(page).locator('.complete')).toHaveText(
    TEXT[language].heading,
  );
}

// Five answers, each the first offered, then the starting features.
async function answerSurvey(page: Page) {
  await confirmation(page).locator('button.tell-us').click();
  const forward = survey(page).locator('button.forward');
  await forward.click();
  for (let question = 0; question < 5; question++) {
    await survey(page).getByRole('radio').first().click();
    await forward.click();
  }
  await expect(survey(page).locator('.features li')).toHaveCount(5);
  await forward.click();
  await expect(panel(page)).toBeVisible();
}

async function signUp(page: Page, email: string) {
  await expect(panel(page).locator('#mf-sign-up-email')).toHaveValue(email);
  await panel(page).locator('#mf-sign-up-password').fill(NEW_PASSWORD);
  await panel(page).getByRole('checkbox').check();
  await panel(page).locator('button[type="submit"]').click();
  await expect(statusView(page).locator('h1')).toBeFocused();
}

interface Layout {
  sideways: number;
  shortest: { height: number; label: string };
}

// How far the page scrolls sideways, and the shortest button in the part
// measured once the dialog's opening scale has played out.
const layout = (scope: Locator): Promise<Layout> =>
  scope.evaluate(async (root) => {
    await Promise.all(document.getAnimations().map((a) => a.finished));
    const buttons = [...root.querySelectorAll<HTMLElement>('button, a[hlmBtn]')]
      .filter((el) => el.checkVisibility())
      .map((el) => ({
        height: el.getBoundingClientRect().height,
        label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
      }))
      .sort((a, b) => a.height - b.height);
    return {
      shortest: buttons[0] ?? { height: Number.POSITIVE_INFINITY, label: '' },
      sideways:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

// The same screen in both schemes holds: no sideways scroll, every button
// tall enough to tap.
async function holds(page: Page, scope: Locator) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const { shortest, sideways } = await layout(scope);
    expect(sideways, `${colorScheme}: sideways scroll`).toBeLessThanOrEqual(0);
    expect(
      shortest.height,
      `${colorScheme}: the "${shortest.label}" button`,
    ).toBeGreaterThanOrEqual(44);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const stagesRead = (scope: Locator, language: Language) =>
  expect(scope.locator('mf-verification-stages li .name')).toHaveText([
    ...TEXT[language].stages,
  ]);

test.describe('sending a listing for verification @seeded', () => {
  // @traces 116-FR-040
  test('filled, sent, the survey answered and an account made: "Trimis" lit, then "În verificare" once an admin opens the file, with no reload', async ({
    browser,
    context,
    page,
  }) => {
    // An upload, the survey's saves, a sign-up, a send and a second browser.
    test.slow();
    await ownAddress(page, '198.18.0');
    const name = `Service Trimis ${unique()}`;
    await fillListing(context, page, name);
    const email = await page.getByLabel('E‑mail').inputValue();

    await press(page, 'ro');
    await expect(current(confirmation(page))).toHaveText('Trimis');
    await answerSurvey(page);
    await signUp(page, email);

    await expect(current(statusView(page))).toHaveText('Trimis');
    await expect(statusView(page).locator('mf-garage-preview')).toContainText(
      TEXT.ro.preview,
    );
    await expect(page.locator('body')).not.toContainText(/publică/i);
    const loads = await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    );

    const admin = await browser.newContext();
    try {
      const desk = await admin.newPage();
      await ready(desk, '/ro/garages');
      await desk
        .getByRole('banner')
        .getByRole('button', { exact: true, name: 'Autentificare' })
        .click();
      await signIn(desk, ACCOUNTS.admin);
      await expect(desk).toHaveURL('/app/admin');
      await desk.goto('/app/admin/garages');
      await desk
        .locator('mf-admin-queue li.row', { hasText: name })
        .locator('a.open')
        .click();
      await expect(desk.locator('mf-verification-file h3')).toHaveText(name);
    } finally {
      await admin.close();
    }

    await expect(current(statusView(page))).toHaveText('În verificare');
    expect(
      await page.evaluate(
        () => performance.getEntriesByType('navigation').length,
      ),
    ).toBe(loads);
    await expect(page).toHaveURL(/\/ro\/list-your-garage/);
  });
});

test.describe('the confirmation, the sign-up step and the status view on every size @seeded', () => {
  for (const [width, height, language] of [
    [320, 640, 'ro'],
    [320, 640, 'en'],
    [390, 844, 'ro'],
    [768, 1024, 'en'],
    [1280, 800, 'ro'],
  ] as const) {
    // @traces 116-FR-019
    test(`at ${width} px, ${language}: no sideways scroll, buttons of 44 px, the stages by name and focus on each heading`, async ({
      context,
      page,
    }) => {
      test.slow();
      await ownAddress(page, '198.18.1');
      await page.setViewportSize({ height, width });
      await fillListing(context, page, `Service Mărimi ${unique()}`);
      const email = await page.getByLabel('E‑mail').inputValue();
      await switchTo(page, language);

      await press(page, language);
      await expect(confirmation(page).locator('.complete')).toBeFocused();
      await stagesRead(confirmation(page), language);
      await expect(current(confirmation(page))).toHaveText(
        TEXT[language].stages[0],
      );
      await holds(page, confirmation(page));

      await answerSurvey(page);
      await holds(page, panel(page));

      await signUp(page, email);
      await stagesRead(statusView(page), language);
      await expect(current(statusView(page))).toHaveText(
        TEXT[language].stages[0],
      );
      await holds(page, statusView(page));
    });
  }
});
