import { expect, type Locator, type Page } from '@playwright/test';

import { ACCOUNTS, ownAddress, ownMap, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import {
  answerSurvey,
  confirmation,
  current,
  fillListing,
  panel,
  signUp,
  statusView,
  unique,
} from './listing-send.js';

test.beforeEach(({ context }) => ownMap(context));

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
