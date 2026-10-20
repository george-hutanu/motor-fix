import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { PASSWORD, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// The seed's Service Auto Militari lists all six catalogue jobs, so the flow
// removes air-con regas and adds it back. The other flows read that list,
// its order and its BMW ticks, so this file runs in the serial price list
// project after them (playwright.config.mts) and puts the seed back after
// its tests, the place and the tick a removal drops through PostgreSQL.
const OWNER = 'militari@example.test';
const PROFILE = '/ro/garages/service-auto-militari';
const PRICES = '/app/garage/prices';
const REGAS = 'Încărcare freon climă';
const CHAIN = 'Kit lanț de distribuție';
// Each run proposes a name of its own: a repeat would be refused.
const PROPOSED = `Recondiționare injectoare e2e ${Date.now().toString(36)}`;
const PROPOSED_PREFIX = 'Recondiționare injectoare e2e ';
// The seed's place of air-con regas (seed.ts, MILITARI_PRICES).
const REGAS_POSITION = 4;
const REGAS_SEEDED = { durationMinutes: 45, fromBani: 28_000, toBani: 36_000 };

const language = (page: Page) =>
  page.getByRole('group', { name: /^(Limba|Language)$/ });
const row = (page: Page, name: string) =>
  page
    .locator('[data-row]')
    .filter({ has: page.locator('[data-name]', { hasText: name }) });
const profileNames = (page: Page) =>
  page.locator('section[data-slot="prices"] .row .name');
const panel = (page: Page) => page.locator('mf-overlay-panel');
const pressed = (page: Page, name: string) =>
  page.getByRole('button', { exact: true, name }).click();

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, OWNER);
  await expect(page).toHaveURL('/app/garage');
  await language(page).getByRole('button', { exact: true, name: 'RO' }).click();
}

async function editing(page: Page) {
  await page.goto(PRICES);
  await expect(row(page, CHAIN)).toBeVisible();
  await pressed(page, 'Modifică prețurile');
  await expect(
    page.getByRole('button', { exact: true, name: 'Gata' }),
  ).toHaveAttribute('aria-pressed', 'true');
}

// What a driver reads on the profile, in a context of its own.
async function profileLists(page: Page, name: string, listed: boolean) {
  const visitor = await page.context().browser()?.newContext();
  if (!visitor) throw new Error('no browser for the visitor');
  try {
    const profile = await visitor.newPage();
    await profile.goto(PROFILE);
    await expect(profileNames(profile).first()).toBeVisible();
    const names = profileNames(profile).filter({ hasText: name });
    await expect(names).toHaveCount(listed ? 1 : 0);
  } finally {
    await visitor.close();
  }
}

async function removed(page: Page, name: string) {
  await pressed(page, `Șterge ${name}`);
  const dialog = panel(page);
  await expect(dialog.getByRole('heading')).toHaveText(
    'Ștergi lucrarea din listă?',
  );
  await dialog.getByRole('button', { exact: true, name: 'Șterge' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, name)).toHaveCount(0);
}

type Item = {
  jobTypeId: string;
  nameRo: string;
  priceId?: string;
  visible?: boolean;
};

async function owner(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: OWNER, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const me = await request.get('/api/v1/me', { headers });
  const { garageId } = (await me.json()) as { garageId: string };
  const prices = `/api/v1/garages/${garageId}/prices`;
  const items = async () => {
    const list = await request.get(prices, { headers });
    return ((await list.json()) as { items: Item[] }).items;
  };
  return { headers, items, prices };
}

// Puts the seed back through the owner's own writes: air-con regas listed,
// the chain kit shown, this flow's proposals gone; then its place and its
// BMW tick in PostgreSQL, which no write sets back; then a hide and show of
// the chain kit, whose events drop the cached profiles.
async function restore(request: APIRequestContext) {
  const { headers, items, prices } = await owner(request);
  let listed = await items();
  for (const item of listed) {
    if (item.priceId && item.nameRo.startsWith(PROPOSED_PREFIX)) {
      const gone = await request.delete(`${prices}/${item.priceId}`, {
        headers,
      });
      expect([204, 404]).toContain(gone.status());
    }
  }
  if (!listed.some((item) => item.nameRo === REGAS && item.priceId)) {
    const found = await request.get('/api/v1/job-types', {
      params: { q: 'freon' },
    });
    const { items: jobs } = (await found.json()) as {
      items: { id: string; nameRo: string }[];
    };
    const job = jobs.find((j) => j.nameRo === REGAS);
    if (!job) throw new Error('the catalogue has no air-con regas');
    const added = await request.post(prices, {
      data: { ...REGAS_SEEDED, jobTypeId: job.id },
      headers,
    });
    expect(added.status()).toBe(201);
  }

  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query(
      `UPDATE garage_price p SET position = $1
       FROM garage g, job_type j
       WHERE p.garage_id = g.id AND g.slug = 'service-auto-militari'
         AND p.job_type_id = j.id AND j.key = 'ac-regas' AND p.brand_id IS NULL`,
      [REGAS_POSITION],
    );
    await db.query(
      `INSERT INTO garage_brand_job (garage_id, brand_id, job_type_id)
       SELECT gb.garage_id, gb.brand_id, j.id
       FROM garage_brand gb
       JOIN garage g ON g.id = gb.garage_id AND g.slug = 'service-auto-militari'
       JOIN brand b ON b.id = gb.brand_id AND b.key = 'bmw'
       JOIN job_type j ON j.key = 'ac-regas'
       ON CONFLICT DO NOTHING`,
    );
  } finally {
    await db.end();
  }

  listed = await items();
  const chain = listed.find((item) => item.nameRo === CHAIN);
  if (!chain?.priceId) throw new Error('the seeded chain kit row is missing');
  for (const visible of [false, true]) {
    const flip = await request.patch(`${prices}/${chain.priceId}`, {
      data: { visible },
      headers,
    });
    expect(flip.ok()).toBe(true);
  }
}

// @seeded: signs in as the seeded owner against the real API; @database: the
// restore writes the seed's place and tick back to PostgreSQL.
// @traces 1352-FR-018
// @traces 1352-FR-001
// @traces 1352-FR-004
// @traces 1352-FR-006
// @traces 1352-FR-009
test.describe('the owner adds, hides, shows, proposes and removes jobs @seeded @database', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async ({ request }) => {
    await restore(request);
  });

  test('removes air-con regas, then adds it back from the catalogue with 45 min and 280–360 lei', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page);
    await editing(page);

    await removed(page, REGAS);
    await profileLists(page, REGAS, false);

    await pressed(page, 'Adaugă o lucrare');
    const picker = panel(page);
    await expect(picker.getByRole('heading')).toHaveText('Adaugă o lucrare');
    await picker.getByRole('searchbox').fill('freon');
    await picker.getByRole('button', { exact: true, name: REGAS }).click();

    const editor = panel(page);
    await expect(editor.getByRole('heading')).toHaveText(REGAS);
    await editor.getByLabel('Durată').fill('45');
    await editor.getByLabel('De la').fill('280');
    await editor.getByLabel('Până la').fill('360');
    await editor.getByRole('button', { exact: true, name: 'Salvează' }).click();
    await expect(editor).toHaveCount(0);

    const added = row(page, REGAS);
    await expect(page.locator('[data-row]').last()).toContainText(REGAS);
    await expect(added.locator('[data-state]')).toHaveText('pe profil');
    await expect(added.locator('[data-price]')).toHaveText('280–360 lei');
    await expect(added.locator('[data-duration]')).toHaveText('45 min');
    await profileLists(page, REGAS, true);
  });

  test('hides the chain kit from the profile, then shows it again', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page);
    await editing(page);
    const chain = row(page, CHAIN);

    await pressed(page, `Ascunde ${CHAIN}`);
    await expect(chain.locator('[data-state]')).toHaveText('ascuns de tine');
    await expect(
      chain.getByRole('button', { exact: true, name: `Arată ${CHAIN}` }),
    ).toBeVisible();
    await profileLists(page, CHAIN, false);

    await pressed(page, `Arată ${CHAIN}`);
    await expect(chain.locator('[data-state]')).toHaveText('pe profil');
    await expect(chain.locator('[data-price]')).toHaveText('4.200–6.800 lei');
    await profileLists(page, CHAIN, true);
  });

  test('proposes a job the catalogue lacks, sees it waiting, then removes it', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page);
    await editing(page);

    await pressed(page, 'Adaugă o lucrare');
    await panel(page)
      .getByRole('button', { name: /^Nu găsești lucrarea\? Propune.o$/ })
      .click();

    const form = panel(page);
    await expect(form.getByRole('heading')).toHaveText('Propune o lucrare');
    await form.getByLabel('Numele lucrării').fill(PROPOSED);
    await form.getByLabel('Durată').fill('90');
    await form.getByLabel('De la').fill('600');
    await form.getByLabel('Până la').fill('900');
    await form.getByRole('button', { exact: true, name: 'Trimite' }).click();
    await expect(form).toHaveCount(0);

    const proposed = row(page, PROPOSED);
    await expect(proposed.locator('[data-state]')).toHaveText(
      'ascuns · așteaptă aprobarea',
    );
    await expect(proposed.locator('[data-note]')).toHaveText(
      'O verificăm și îți spunem când e pe profil.',
    );
    await expect(proposed.locator('[data-price]')).toHaveText('600–900 lei');
    await profileLists(page, PROPOSED, false);

    await removed(page, PROPOSED);
  });
});
