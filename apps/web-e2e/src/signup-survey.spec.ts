import { expect, type Page } from '@playwright/test';

import { ownMap, ready } from './accounts.js';
import { test } from './fixtures.js';
import { JOBS, jpeg, KEPT } from './listing-kept.js';

test.beforeEach(({ context }) => ownMap(context));

const survey = (page: Page) => page.locator('mf-signup-survey');
const forward = (page: Page) => survey(page).locator('button.forward');
const prices = (page: Page) => page.locator('mf-prices-step');
const photos = (page: Page) => page.locator('mf-photos-step');

async function range(page: Page, name: string, from: string, to: string) {
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, de la` })
    .fill(from);
  await prices(page)
    .getByRole('textbox', { exact: true, name: `${name}, până la` })
    .fill(to);
}

async function answer(page: Page, label: string) {
  await survey(page).getByRole('radio', { exact: true, name: label }).click();
  await forward(page).click();
}

test.describe('the sign-up survey', () => {
  // @traces 1359-FR-001 1359-FR-002 1359-FR-006 1359-FR-007 1359-FR-011 1359-FR-016
  test('from a complete listing: five answers, the starting features and the saved answers', async ({
    context,
    page,
  }) => {
    // An upload, a server check and the survey's saves on a CI runner.
    test.slow();
    await context.addInitScript((copy) => {
      if (sessionStorage.getItem('kept')) return;
      localStorage.setItem('mf.listing-draft', copy);
      sessionStorage.setItem('kept', '1');
    }, JSON.stringify(KEPT));
    await ready(page, '/ro/list-your-garage');
    const email = `survey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    await page.getByLabel('E‑mail').fill(email);
    await page.getByLabel('E‑mail').blur();
    await expect(
      photos(page).getByRole('button', { name: 'Alege fotografii' }),
    ).toBeEnabled();
    await page
      .locator('mf-brands-step .chips > li > button', { hasText: 'Dacia' })
      .first()
      .click();
    await range(page, 'Manoperă, pe oră', '120', '200');
    for (const [job, from, to] of JOBS) await range(page, job, from, to);
    await photos(page)
      .locator('input[type="file"]')
      .setInputFiles([jpeg('fata.jpg')]);
    await expect(photos(page).locator('li.photo')).toHaveCount(1);
    // The photo counts only once its upload has a key on the server.
    await expect(photos(page).locator('li.photo').first()).toHaveAttribute(
      'data-key',
      /garage_photo\//,
    );

    await page.getByRole('button', { name: 'Trimite spre verificare' }).click();
    await expect(page.locator('mf-missing-summary .complete')).toHaveText(
      'Am primit cererea. O verificăm în 1–2 zile lucrătoare.',
    );
    await page.getByRole('button', { name: /SPUNE‑NE CUM LUCREZI/ }).click();

    await expect(survey(page).locator('h1')).toHaveText('Spune‑ne cum lucrezi');
    await expect(page.locator('mf-details-step')).toHaveCount(0);
    await forward(page).click();
    await answer(page, 'Doar eu');
    await answer(page, 'Niciunul');
    await answer(page, 'Da');
    await answer(page, 'Nu, deocamdată');
    await answer(page, 'Căutare pe Google');

    await expect(survey(page).locator('h1')).toHaveText(
      'Pornim service‑ul tău cu:',
    );
    await expect(survey(page).locator('.features li')).toHaveText([
      /Echipă și mecanici\s*Oprit/,
      /Program pe elevatoare\s*Oprit/,
      /Poze și video live\s*Pornit/,
      /Foi de lucru\s*Oprit/,
      /WhatsApp\s*Pornit/,
    ]);
    await forward(page).click();
    await expect(survey(page).getByRole('status')).toHaveText(
      'Răspunsurile tale sunt salvate.',
    );
  });
});
