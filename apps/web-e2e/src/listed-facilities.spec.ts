import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { ready, settled } from './accounts.js';
import { test } from './fixtures.js';

const hours = (page: Page) => page.locator('mf-hours-step');
const facility = (page: Page, name: string) =>
  hours(page).locator('.facilities button', { hasText: name });
const note = (page: Page) =>
  hours(page).locator('input[name="facilitiesNote"]');
const NOTE = 'Mașina la schimb se cere la programare';

// @traces 330-FR-001 330-FR-002
test.describe('list your garage, the facilities note', () => {
  test('at 320 px: two facilities and a note come back after a reload, and a note too long says so', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, '/ro/list-your-garage');

    await facility(page, 'Mașină la schimb').click();
    await facility(page, 'Sală de așteptare').click();
    await note(page).fill(NOTE);
    await expect
      .poll(() =>
        page.evaluate(
          (wanted) =>
            Object.keys(localStorage).some((key) =>
              (localStorage.getItem(key) ?? '').includes(wanted),
            ),
          `"facilitiesNote":"${NOTE}"`,
        ),
      )
      .toBe(true);

    await page.reload();
    await settled(page);

    await expect(note(page)).toHaveValue(NOTE);
    await expect(facility(page, 'Sală de așteptare')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await note(page).fill('a'.repeat(201));
    await note(page).blur();
    await expect(note(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(hours(page)).toContainText(
      'Nota poate avea cel mult 200 de caractere',
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
});

// @traces 330-FR-005 330-FR-006
test.describe('the facilities of an approved garage @seeded', () => {
  test.skip(
    !process.env['DATABASE_URL'],
    'writes its garages straight to PostgreSQL, which needs DATABASE_URL',
  );

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let db: Client;
  const garageIds: string[] = [];

  async function seeded(status: 'approved' | 'draft') {
    const made = await db.query<{ id: string }>(
      `INSERT INTO garage (id, name, slug, status, approved_at, facilities_note)
       VALUES (gen_random_uuid(), $1, $2, $3::garage_status, now(), $4) RETURNING id`,
      [
        `Atelier Dinamo ${stamp}`,
        `e2e-facilitati-${status}-${stamp}`,
        status,
        NOTE,
      ],
    );
    const id = made.rows[0]?.id ?? '';
    garageIds.push(id);
    await db.query(
      `INSERT INTO garage_facility (garage_id, facility)
       VALUES ($1, 'waiting_area'), ($1, 'courtesy_car')`,
      [id],
    );
    return `e2e-facilitati-${status}-${stamp}`;
  }

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
  });

  test.afterAll(async () => {
    await db.query('DELETE FROM garage WHERE id = ANY($1)', [garageIds]);
    await db.end();
  });

  test('the profile lists every facility and the note; a draft garage shows nothing', async ({
    request,
  }) => {
    const profile = await request.get(
      `/api/v1/garages/${await seeded('approved')}`,
    );
    expect(profile.status()).toBe(200);
    expect(await profile.json()).toMatchObject({
      facilities: ['courtesy_car', 'waiting_area'],
      facilitiesNote: NOTE,
    });

    const draft = await request.get(`/api/v1/garages/${await seeded('draft')}`);
    expect(draft.status()).toBe(404);
    expect(await draft.text()).not.toContain('programare');
  });
});
