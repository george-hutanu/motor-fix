import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { MAILBOX, test } from './fixtures.js';

// The invite e-mail as the API sent it, read from the test mailbox the local
// run starts (mailbox.mjs); a deployed address has none, so the config leaves
// out flows tagged @mailbox there.
const INVITE_LINK = /https?:\/\/[^\s"<>]+\/invite\/[A-Za-z0-9_-]{43}/;
// A fake password for the account this test creates; never a real one.
const NEW_PASSWORD = 'parola-mecanic-de-test';

async function lastInviteLink(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/messages?to=${encodeURIComponent(email)}`,
        );
        const sent: { textContent: string }[] = await res.json();
        link = sent
          .map((m) => INVITE_LINK.exec(m.textContent)?.[0])
          .filter(Boolean)
          .at(-1);
        return link;
      },
      { message: 'no invite e-mail sent', timeout: 20_000 },
    )
    .toBeDefined();
  return new URL(String(link)).pathname;
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe('inviting a mechanic @seeded @mailbox', () => {
  test('the owner invites by e-mail; the invitee creates an account from the link and lands on the garage dashboard as a mechanic', async ({
    browser,
    page,
  }) => {
    const email = `mecanic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

    await ready(page, '/ro');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.garage);
    await expect(page).toHaveURL('/app/garage');

    await page.getByRole('button', { name: 'Invită în echipă' }).click();
    const invite = page.getByRole('dialog', { name: 'Invită în echipă' });
    await invite.getByLabel('Nume').fill('Elena Stan');
    await invite.getByLabel('E‑mail').fill(email);
    await expect(invite.getByLabel('Mecanic')).toBeChecked();
    await invite.getByLabel('Poate înregistra prețul final').check();
    await invite.getByRole('button', { name: 'Trimite invitația' }).click();
    await expect(invite.getByText('Invitația a fost trimisă.')).toBeVisible();

    const link = await lastInviteLink(page, email);
    expect(link).toMatch(/^\/ro\/invite\/[A-Za-z0-9_-]{43}$/);

    const fresh = await browser.newContext();
    const invitee = await fresh.newPage();
    await ready(invitee, link);
    await expect(
      invitee.getByText('te invită să te alături echipei ca mecanic.'),
    ).toBeVisible();
    expect(await noSideScroll(invitee)).toBe(true);
    await invitee.getByRole('button', { exact: true, name: 'Acceptă' }).click();

    const form = invitee.getByRole('dialog', { name: 'Cont nou' });
    await expect(form.getByLabel('Nume')).toHaveValue('Elena Stan');
    await expect(form.getByLabel('E‑mail')).toHaveValue(email);
    await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Creează contul' }).click();

    await expect(invitee).toHaveURL('/app/garage');
    await expect(
      invitee
        .getByRole('group', { name: 'Rolul tău' })
        .getByRole('button', { name: 'Mecanic' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await ready(invitee, link);
    await expect(
      invitee.getByText(
        'Invitația nu mai este valabilă. Cere service‑ului una nouă.',
      ),
    ).toBeVisible();
    await fresh.close();
  });

  test('a link that was never issued says it is no longer valid', async ({
    page,
  }) => {
    await ready(page, `/en/invite/${'Z'.repeat(43)}`);

    await expect(
      page.getByText(
        'This invitation is no longer valid. Ask the garage for a new one.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  });
});
