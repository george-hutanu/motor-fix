import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ownAddress, ownMap, signInAsAdmin2 } from './accounts.js';
import { test } from './fixtures.js';
import { jpeg } from './listing-kept.js';
import {
  answerSurvey,
  confirmation,
  current,
  fillListing,
  signUp,
  statusView,
  unique,
} from './listing-send.js';

test.beforeEach(({ context }) => ownMap(context));

const NOTE = 'Adăugați trei fotografii cu atelierul din interior.';

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const photos = (page: Page) => page.locator('mf-photos-step');

// A listing sent by a new owner, asked for photos by an admin, completed and
// sent back from the same form: the admins' queue shows it updated, with the
// photos among what changed.
// @traces 208-FR-009
test.describe('sending the file again after a request for more @database', () => {
  let db: Client;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.end();
  });

  test('adds the photos asked for and sends the file back to the queue', async ({
    browser,
    context,
    page,
  }) => {
    test.slow();
    const name = `Retrimis ${unique()}`;
    await ownAddress(page, '198.51.100');
    await fillListing(context, page, name);
    const email = await page.getByLabel('E‑mail').inputValue();
    await page.locator('.actions .send').click();
    await answerSurvey(page);
    await signUp(page, email);

    // The admin's request for more, as the drawer's dialog makes it.
    const { rows } = await db.query<{ id: string }>(
      `UPDATE verification_file f
       SET status = 'more_requested', requested_items = ARRAY['photos'],
           reason_note = $2, decided_at = now()
       FROM garage g WHERE g.id = f.garage_id AND g.name = $1 RETURNING f.id::text`,
      [name, NOTE],
    );
    expect(rows).toHaveLength(1);

    await page.goto('/app/garage');
    await expect(page.getByText(NOTE)).toBeVisible();
    const complete = page.getByRole('button', { name: 'Completează' });
    await complete.click();
    await expect(page).toHaveURL(/\/ro\/list-your-garage/);
    await expect(page.locator('#pasul-5 > h2 .asked')).toHaveText(
      '· Cerut de MotorFix',
    );
    await expect(page.locator('mf-details-step [name="name"]')).toHaveValue(
      name,
    );
    expect(await sideways(page)).toBe(0);

    await photos(page)
      .locator('input[type="file"]')
      .setInputFiles([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);
    await expect(photos(page).locator('li.photo[data-key]')).toHaveCount(4);
    await page.locator('.actions .send').click();
    await confirmation(page).locator('button.tell-us').click();
    const sent = Date.now();
    await page.locator('mf-signup-survey button.forward').click();
    await expect(statusView(page).locator('h1')).toBeFocused({
      timeout: 5_000,
    });
    expect(Date.now() - sent).toBeLessThan(5_000);
    await expect(current(statusView(page))).toHaveText('Trimis');
    expect(await sideways(page)).toBe(0);

    const admin = await browser.newContext();
    try {
      const queue = await admin.newPage();
      // Signed in before leaving: a navigation cuts a sign-in still in flight.
      await signInAsAdmin2(queue);
      await queue.goto('/app/admin/garages');
      const row = queue.locator('li.row').filter({ hasText: name });
      await expect(row.locator('.tag')).toHaveText('Actualizat', {
        timeout: 15_000,
      });
      await row.getByRole('link').click();
      const changes = queue
        .locator('mf-verification-file')
        .getByRole('region', { name: 'Ce s‑a schimbat' });
      await expect(changes.locator('[data-area="photos"]')).toContainText('3');
    } finally {
      await admin.close();
    }
  });
});
