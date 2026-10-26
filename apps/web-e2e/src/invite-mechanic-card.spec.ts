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

// @traces 1255-invite-mechanic-FR-018
test.describe('inviting a mechanic from their card @seeded @mailbox', () => {
  test("the owner invites Elena from her card; she creates her account from the link and her row turns 'pe profil' live", async ({
    browser,
    page,
  }) => {
    // Unique per run: the seeded database keeps what an earlier run wrote.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `Elena Stan ${suffix}`;
    const email = `mecanic-card-${suffix}@example.test`;

    await ready(page, '/ro');
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    await signIn(page, ACCOUNTS.garage);
    await expect(page).toHaveURL('/app/garage');
    await page.goto('/app/garage/team');
    const panel = page.getByRole('region', { name: 'Echipa' });
    const row = panel.getByRole('listitem').filter({ hasText: name });

    await panel
      .getByRole('button', { exact: true, name: 'Adaugă un mecanic' })
      .click();
    const add = page.getByRole('dialog', { name: 'Adaugă un mecanic' });
    await add.getByLabel('Nume').fill(name);
    await add.getByRole('button', { name: 'Salvează' }).click();
    await expect(add).toBeHidden();
    await expect(row).toContainText('nu apare pe profil · fără cont', {
      timeout: 5_000,
    });

    await row.getByRole('button').click();
    const cardDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByLabel('Nume') });
    await cardDialog
      .getByRole('button', { exact: true, name: 'Invită' })
      .click();
    const invite = page.getByRole('dialog', { name: `Invită pe ${name}` });
    await invite.getByLabel('E‑mail sau telefon').fill(email);
    await invite.getByRole('button', { name: 'Trimite invitația' }).click();
    await expect(invite.getByText('Invitația a fost trimisă.')).toBeVisible();
    await invite.getByRole('button', { name: 'Gata' }).click();
    await expect(
      cardDialog.getByText(`Invitație trimisă pe ${email}`),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText('nu apare pe profil · invitație trimisă');

    const link = await lastInviteLink(page, email);
    const fresh = await browser.newContext();
    const invitee = await fresh.newPage();
    await ready(invitee, link);
    await invitee.getByRole('button', { exact: true, name: 'Acceptă' }).click();
    const form = invitee.getByRole('dialog', { name: 'Cont nou' });
    await expect(form.getByLabel('Nume')).toHaveValue(name);
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
    await fresh.close();

    // The owner's open view, never reloaded, hears the link within 5 s.
    await expect(row).toContainText('pe profil', { timeout: 5_000 });
    await expect(row).not.toContainText('nu apare pe profil');
  });
});
