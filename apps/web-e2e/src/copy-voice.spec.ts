import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';

// Every other flow pins voice 1 (fixtures.ts); these open a context of their
// own, so the round runs as a visitor's would.
const headline = (page: Page) =>
  page.locator('mf-home .hero h2').filter({ visible: true });

test.describe('the copy voice of a visit', () => {
  // @traces 006-FR-002
  // @traces 006-FR-004
  test('takes the next voice on each Home load, and the same one on a quick reload', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const seen: string[] = [];
    const headlines = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await page.goto('/ro');
      seen.push((await page.locator('html').getAttribute('data-voice')) ?? '');
      await expect(headline(page)).toHaveCount(1);
      headlines.add(((await headline(page).textContent()) ?? '').trim());
      await page.waitForTimeout(2_600);
    }
    expect([...seen].sort()).toEqual(['1', '2', '3', '4', '5']);
    // Five voices, five different headlines.
    expect(headlines.size).toBe(5);

    await page.goto('/ro');
    const voice = await page.locator('html').getAttribute('data-voice');
    const words = await headline(page).textContent();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute(
      'data-voice',
      voice ?? '',
    );
    await expect(headline(page)).toHaveText(words ?? '');
    await expect(headline(page)).toHaveCount(1);
    await context.close();
  });

  // @traces 006-FR-006
  // @traces 006-FR-008
  test('keeps the voice from Home to Results @seeded', async ({ browser }) => {
    // Results searches only from a place: here, the one the browser gives.
    const context = await browser.newContext({
      geolocation: { latitude: 44.4268, longitude: 26.1025 },
      permissions: ['geolocation'],
    });
    await context.addInitScript(() => {
      localStorage.setItem('mf-copy-deck', '2');
      localStorage.removeItem('mf-copy');
    });
    const page = await context.newPage();
    await page.goto('/ro');
    await expect(headline(page)).toHaveText(/Știm un mecanic bun pentru/);
    await page.waitForFunction(() => !document.querySelector('[ngh]'));

    await page.getByRole('link', { name: 'Arată‑mi mecanicii' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^Recomandați pentru /,
    );
    // A refusing garage says so in the same voice: every card's list of
    // refused brands, and the red lamp of any garage that refuses this one.
    const cards = page.locator('mf-result-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().locator('.key').nth(1)).toHaveText(
      'Nu lucrează pe',
    );
    for (const lamp of await page
      .locator('mf-result-card mf-lamp[data-state="red"]')
      .all())
      await expect(lamp).toHaveText(/^Nu lucrează pe /);
    await context.close();
  });

  // @traces 006-FR-010
  test('shows voice 1 when the page runs no script', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/ro');

    await expect(headline(page)).toHaveCount(1);
    await expect(headline(page)).toHaveText(/^Cine se pricepe la /);
    await context.close();
  });

  // @traces 006-FR-009
  test('shows a voice and stores nothing when the browser refuses to store', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      // The real store stays reachable to the test only, to prove it empty.
      const real = window.localStorage;
      Object.defineProperty(window, '__realStorage', { value: real });
      const refuse = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: refuse });
    });
    const page = await context.newPage();
    await page.goto('/ro');

    await expect(page.locator('html')).toHaveAttribute('data-voice', /^[1-5]$/);
    await expect(headline(page)).toHaveCount(1);
    const stored = await page.evaluate(
      () =>
        (window as unknown as { __realStorage: Storage }).__realStorage.length,
    );
    expect(stored).toBe(0);
    await context.close();
  });
});
