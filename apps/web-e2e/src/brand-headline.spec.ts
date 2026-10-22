import { type Browser, expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';

const headline = (page: Page) =>
  page.locator('mf-home .hero h2').filter({ visible: true });

// The fixture pins voice 1 on its own context; these open one that speaks
// the voice under test on every load.
async function inVoice(
  browser: Browser,
  voice: '3' | '4',
  near = false,
): Promise<Page> {
  const context = await browser.newContext(
    near
      ? {
          geolocation: { latitude: 44.4268, longitude: 26.1025 },
          permissions: ['geolocation'],
        }
      : {},
  );
  await context.addInitScript((voice) => {
    try {
      localStorage.setItem('mf-copy', voice);
      localStorage.setItem('mf-copy-at', String(Date.now()));
    } catch {}
  }, voice);
  return context.newPage();
}

async function choose(page: Page, label: string, brand: string) {
  await page
    .getByRole('combobox', { name: label })
    .fill(brand.slice(0, 3).toLowerCase());
  await page.getByRole('option', { exact: true, name: brand }).click();
}

test.describe('the headline names the brand chosen @seeded', () => {
  // @traces 007-brand-headline-FR-019
  test('voice 4 says the brand in its own form, and keeps the voice', async ({
    browser,
  }) => {
    const page = await inVoice(browser, '4');
    await page.goto('/ro');
    await settled(page);

    await choose(page, 'Caută marca', 'Dacia');
    await expect(headline(page)).toHaveText(/^Dacia ta merită mai mult/);
    await choose(page, 'Caută marca', 'BMW');
    await expect(headline(page)).toHaveText(/^BMW‑ul tău merită mai mult/);
    await expect(page.locator('html')).toHaveAttribute('data-voice', '4');

    await page.goto('/en');
    await settled(page);
    await choose(page, 'Search for a brand', 'BMW');
    await expect(headline(page)).toHaveText(/^Your BMW deserves better/);
    await page.context().close();
  });

  // @traces 007-brand-headline-FR-019
  test('voice 3 reads the count line and the dial, and says when nobody takes the brand', async ({
    browser,
  }) => {
    const page = await inVoice(browser, '3', true);
    await page.goto('/ro');
    await settled(page);
    await page.locator('mf-home .place').getByRole('button').click();
    await page
      .getByRole('dialog', { name: 'Alege locul' })
      .getByRole('button', { name: 'Folosește locația mea' })
      .click();
    await expect(page.locator('mf-home .place')).toHaveText(/Lângă tine/);

    await page.getByRole('radio', { exact: true, name: 'Dacia' }).click();
    const tally = page.locator('mf-home .tally');
    await expect(tally).toHaveText(/^\s*\d+ din \d+ service‑uri primesc Dacia/);
    const takers = ((await tally.textContent()) ?? '').trim().split(' ')[0];
    const rating = (
      (await page
        .locator('mf-home .dial mf-rating-dial .mf-dial-value')
        .textContent()) ?? ''
    ).trim();
    await expect(headline(page)).toHaveText(
      new RegExp(
        `^Dacia\\. ${takers} (de )?service(‑uri)?\\. Nota maximă: ${rating}\\.$`,
      ),
    );

    await choose(page, 'Caută marca', 'Tesla');
    await expect(headline(page)).toHaveText('Tesla. Niciun service încă.');
    await page.context().close();
  });
});
