import { expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import {
  accessToken,
  type QuotedRequest,
  quotedRequest,
} from './quoted-request.js';

test.describe('comparing the quotes of a request @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its driver, car and garages straight to PostgreSQL, which needs DATABASE_URL',
  );
  test.describe.configure({ mode: 'serial' });

  let quoted: QuotedRequest;

  test.beforeAll(async ({ request }) => {
    quoted = await quotedRequest(request, 'compara');
  });

  test.afterAll(async () => {
    await quoted?.remove();
  });

  const panel = (page: Page) => page.locator('mf-quotes-compare');
  const names = (page: Page) =>
    panel(page).locator('li[data-quote] [data-part="name"]');

  async function signedIn(page: Page) {
    await page.setViewportSize({ height: 900, width: 1440 });
    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, quoted.driver, { password: quoted.password });
    await expect(page).toHaveURL('/app/driver');
  }

  // @traces 313-FR-001 313-FR-005 313-FR-006 313-FR-012 313-FR-013
  test('lists the two quotes fastest first on the overview and in Cererile mele', async ({
    page,
  }) => {
    await signedIn(page);

    await expect(names(page)).toHaveText([
      'Service Auto Militari',
      quoted.garages[0]!.name,
    ]);
    await expect(panel(page).locator('[data-part="header"]')).toHaveText(
      /· 2 oferte$/,
    );

    await page.goto(`/app/driver/requests?request=${quoted.requestId}`);
    await expect(names(page)).toHaveText([
      'Service Auto Militari',
      quoted.garages[0]!.name,
    ]);
  });

  // @traces 313-FR-004
  test('re-sorts the rows by price', async ({ page }) => {
    await signedIn(page);
    await expect(names(page)).toHaveCount(2);

    await panel(page).getByRole('radio', { name: 'Preț' }).check();

    await expect(names(page)).toHaveText([
      quoted.garages[0]!.name,
      'Service Auto Militari',
    ]);
  });

  // @traces 313-FR-010
  test('shows a third quote without a reload, and the count reads 3', async ({
    page,
    request,
  }) => {
    await signedIn(page);
    await page.goto(`/app/driver/requests?request=${quoted.requestId}`);
    await expect(names(page)).toHaveCount(2);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    await quoted.quote(
      request,
      await accessToken(request, quoted.garages[1]!.owner, quoted.password),
      400,
    );

    await expect(names(page)).toHaveCount(3, { timeout: 5_000 });
    await expect(panel(page).locator('[data-part="header"]')).toHaveText(
      /· 3 oferte$/,
    );
    expect(navigations).toBe(0);
  });
});
