import { expect, type Page } from '@playwright/test';

import { ready, settled } from './accounts.js';
import { test } from './fixtures.js';

// The link e-mail as the API sent it, read from the test mailbox the local
// run starts (mailbox.mjs); a deployed address has none, so the config leaves
// out flows tagged @mailbox there.
const MAILBOX = 'http://127.0.0.1:3025';
const DRAFT_LINK =
  /https?:\/\/[^\s"<>]+\/(ro|en)\/list-your-garage\?draft=[A-Za-z0-9_-]{43}/;

async function draftLink(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/messages?to=${encodeURIComponent(email)}`,
        );
        const sent: { textContent: string }[] = await res.json();
        link = sent
          .map((m) => DRAFT_LINK.exec(m.textContent)?.[0])
          .filter(Boolean)
          .at(-1);
        return link;
      },
      { message: 'no draft link e-mail sent', timeout: 20_000 },
    )
    .toBeDefined();
  const url = new URL(String(link));
  return url.pathname + url.search;
}

const current = (page: Page) => page.locator('nav [aria-current="step"]');

test.describe('saving a listing draft @mailbox', () => {
  test('the link from the e-mail opens the same draft at the same step on another device', async ({
    browser,
    page,
  }) => {
    const email = `service-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

    await ready(page, '/ro/list-your-garage');
    await page.getByLabel('E‑mail').fill(email);
    await page.getByLabel('E‑mail').blur();
    await page
      .getByRole('navigation', { name: 'Pași' })
      .getByRole('button', { name: /^3 / })
      .click();
    await page.getByRole('button', { name: 'Salvează ciorna' }).click();

    const link = await draftLink(page, email);
    expect(link).toMatch(/^\/ro\/list-your-garage\?draft=/);

    const other = await browser.newContext();
    try {
      const phone = await other.newPage();
      await ready(phone, link);
      await expect(phone.getByLabel('E‑mail')).toHaveValue(email);
      await expect(current(phone)).toHaveText(/^\s*3 /);
      await expect(phone).not.toHaveURL(/draft=/);
    } finally {
      await other.close();
    }

    await page.reload();
    await settled(page);
    await expect(page.getByLabel('E‑mail')).toHaveValue(email);
  });

  test('a link to no draft says so and offers to start again', async ({
    page,
  }) => {
    await ready(page, `/ro/list-your-garage?draft=${'x'.repeat(43)}`);

    await expect(
      page.getByRole('heading', { name: 'Linkul nu mai e valid' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Începe din nou' }),
    ).toBeVisible();
  });
});
