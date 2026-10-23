import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
} from '@playwright/test';
import { Client } from 'pg';

import { ACCOUNTS, headers, openSignIn, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// An admin decides two proposals of this run's own in "Lucrări propuse" while
// the proposing owner has Prețuri open. Atelier Test's owner proposes, so the
// manage flow running beside this file in the serial price list project keeps
// Service Auto Militari's list to itself; Service Auto Militari's owner is the
// second garage whose picker offers the approved job. The seeded Dinamo
// proposal is never decided. After the tests the owner removes this run's rows
// and the approved and rejected jobs leave the catalogue through PostgreSQL.
const PROPOSER = ACCOUNTS.garage;
const OTHER_OWNER = 'militari@example.test';
const PRICES = '/app/garage/prices';
const QUEUE = '/app/admin/proposed-jobs';
const PREFIX = 'Curățare injectoare decizie e2e ';
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const APPROVED = `${PREFIX}${STAMP} a`;
const REJECTED = `${PREFIX}${STAMP} r`;
const REASON = 'Nu este clar ce lucrare este; există deja Diagnoză în catalog.';
const RANGE = { durationMinutes: 90, fromBani: 18_000, toBani: 42_000 };

const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });
const panel = (page: Page) => page.locator('mf-overlay-panel');
const priceRow = (page: Page, name: string) =>
  page
    .locator('[data-row]')
    .filter({ has: page.locator('[data-name]', { hasText: name }) });
const queueRow = (page: Page, name: string) =>
  page
    .locator('[data-row]')
    .filter({ has: page.locator('[data-job]', { hasText: name }) });

async function signedIn(page: Page, email: string, home: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await openSignIn(page);
  await signIn(page, email);
  await expect(page).toHaveURL(home);
}

async function ownerOn(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ height: 900, width: 1440 });
  await signedIn(page, email, '/app/garage');
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
  await page.goto(PRICES);
  return { context, page };
}

async function adminOn(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ height: 900, width: 1440 });
  await signedIn(page, ACCOUNTS.admin, '/app/admin');
  await page.goto(QUEUE);
  return { context, page };
}

async function proposer(request: APIRequestContext) {
  const auth = await headers(request, PROPOSER);
  const me = await request.get('/api/v1/me', { headers: auth });
  const { garageAccess } = (await me.json()) as {
    garageAccess: { garageId: string; name: string }[];
  };
  const garage = garageAccess.find((access) => access.name === 'Atelier Test');
  if (!garage) throw new Error('the seeded owner has no Atelier Test');
  const { garageId } = garage;
  return { auth, garageId, prices: `/api/v1/garages/${garageId}/prices` };
}

// The owner's own proposal through the API, as the "Propune o lucrare" form
// sends it (the manage flow drives the form itself).
async function proposed(request: APIRequestContext, name: string) {
  const { auth, garageId } = await proposer(request);
  const res = await request.post(`/api/v1/garages/${garageId}/catalogue-jobs`, {
    data: { ...RANGE, name },
    headers: auth,
  });
  expect(res.status(), await res.text()).toBe(201);
}

// This run's rows off the owner's list, through the owner's own removal, then
// its jobs out of the catalogue, which no route removes.
async function restore(request: APIRequestContext) {
  const { auth, prices } = await proposer(request);
  const list = await request.get(prices, { headers: auth });
  const { items } = (await list.json()) as {
    items: { nameRo: string; priceId?: string }[];
  };
  for (const item of items) {
    if (item.priceId && item.nameRo.startsWith(PREFIX)) {
      const gone = await request.delete(`${prices}/${item.priceId}`, {
        headers: auth,
      });
      expect([204, 404]).toContain(gone.status());
    }
  }
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query(
      `DELETE FROM job_type j
       WHERE j.name_ro LIKE $1
         AND NOT EXISTS (SELECT 1 FROM garage_price p WHERE p.job_type_id = j.id)
         AND NOT EXISTS (SELECT 1 FROM garage_brand_job b WHERE b.job_type_id = j.id)
         AND NOT EXISTS (SELECT 1 FROM request_job r WHERE r.job_type_id = j.id)`,
      [`${PREFIX}%`],
    );
  } finally {
    await db.end();
  }
}

// @seeded: signs in as the seeded owners and admin against the real API;
// @database: the restore removes this run's jobs from PostgreSQL.
// @traces 414-FR-015
// @traces 414-FR-011
// @traces 414-FR-014
test.describe('an admin decides a proposed job and the garage sees it @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async ({ request }) => {
    await restore(request);
  });

  test('the queue shows the seeded Dinamo proposal with its range', async ({
    browser,
  }) => {
    const admin = await adminOn(browser);
    try {
      const seeded = queueRow(admin.page, 'Recondiționare injectoare').filter({
        has: admin.page.locator('[data-garage]', {
          hasText: 'Atelier Dinamo',
        }),
      });
      await expect(seeded).toHaveCount(1);
      await expect(seeded.locator('[data-interval]')).toHaveText(
        '180 – 420 lei · 90 min',
      );
    } finally {
      await admin.context.close();
    }
  });

  test('approves a proposal: the owner row turns "pe profil" without a reload and a second garage can add the job', async ({
    browser,
    request,
  }) => {
    await proposed(request, APPROVED);
    const owner = await ownerOn(browser, PROPOSER);
    const admin = await adminOn(browser);
    try {
      const mine = priceRow(owner.page, APPROVED);
      await expect(mine.locator('[data-state]')).toHaveText(
        'ascuns · așteaptă aprobarea',
      );

      const queued = queueRow(admin.page, APPROVED);
      await expect(queued.locator('[data-garage]')).toHaveText('Atelier Test');
      await expect(queued.locator('[data-interval]')).toHaveText(
        '180 – 420 lei · 90 min',
      );
      await admin.page
        .getByRole('button', { exact: true, name: `Aprobă „${APPROVED}”` })
        .click();
      const dialog = panel(admin.page);
      await expect(dialog.getByRole('heading')).toHaveText(
        `Aprobi lucrarea „${APPROVED}”?`,
      );
      await expect(dialog.getByLabel('Nume în română')).toHaveValue(APPROVED);
      const approve = dialog.getByRole('button', {
        exact: true,
        name: 'Aprobă',
      });
      await expect(approve).toBeDisabled();
      await dialog
        .getByLabel('Nume în engleză')
        .fill(`Injector cleaning e2e ${STAMP}`);
      await dialog.getByLabel('Sistem').selectOption({ label: 'Motor' });
      await approve.click();
      await expect(dialog).toHaveCount(0);
      await expect(queued).toHaveCount(0);

      // Live: the owner's open page follows the decision, no reload.
      await expect(mine.locator('[data-state]')).toHaveText('pe profil');
      await expect(mine.locator('[data-price]')).toHaveText('180–420 lei');
    } finally {
      await admin.context.close();
      await owner.context.close();
    }

    const other = await ownerOn(browser, OTHER_OWNER);
    try {
      await other.page
        .getByRole('button', { exact: true, name: 'Modifică prețurile' })
        .click();
      await other.page
        .getByRole('button', { exact: true, name: 'Adaugă o lucrare' })
        .click();
      const picker = panel(other.page);
      await expect(picker.getByRole('heading')).toHaveText('Adaugă o lucrare');
      await picker.getByRole('searchbox').fill(STAMP);
      await expect(
        picker.getByRole('button', { exact: true, name: APPROVED }),
      ).toBeVisible();
    } finally {
      await other.context.close();
    }
  });

  test('rejects a proposal with a reason: the owner row reads "respins · {reason}" without a reload', async ({
    browser,
    request,
  }) => {
    await proposed(request, REJECTED);
    const owner = await ownerOn(browser, PROPOSER);
    const admin = await adminOn(browser);
    try {
      const mine = priceRow(owner.page, REJECTED);
      await expect(mine.locator('[data-state]')).toHaveText(
        'ascuns · așteaptă aprobarea',
      );

      const queued = queueRow(admin.page, REJECTED);
      await expect(queued).toHaveCount(1);
      await admin.page
        .getByRole('button', { exact: true, name: `Respinge „${REJECTED}”` })
        .click();
      const dialog = panel(admin.page);
      await expect(dialog.getByRole('heading')).toHaveText(
        `Respingi lucrarea „${REJECTED}”?`,
      );
      const reject = dialog.getByRole('button', {
        exact: true,
        name: 'Respinge',
      });
      await dialog.getByLabel('Motivul').fill('Neclar');
      await expect(reject).toBeDisabled();
      await dialog.getByLabel('Motivul').fill(REASON);
      await reject.click();
      await expect(dialog).toHaveCount(0);
      await expect(queued).toHaveCount(0);

      await expect(mine.locator('[data-state]')).toHaveText(
        `respins · ${REASON}`,
      );
    } finally {
      await admin.context.close();
      await owner.context.close();
    }

    // A rejected job is in no picker.
    const jobs = await request.get('/api/v1/job-types', {
      params: { q: STAMP },
    });
    const { items } = (await jobs.json()) as { items: { nameRo: string }[] };
    expect(items.map((job) => job.nameRo)).toEqual([APPROVED]);
  });
});
