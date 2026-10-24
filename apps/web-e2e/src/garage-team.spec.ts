import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, ready, signIn } from './accounts.js';
import { MAILBOX, test } from './fixtures.js';

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

async function openTeam(page: Page) {
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, ACCOUNTS.garage);
  await expect(page).toHaveURL('/app/garage');
  await page.goto('/app/garage/team');
  return page.getByRole('region', { name: 'Echipa' });
}

// @traces 055-FR-014
test.describe('the garage team @seeded', () => {
  test("the owner reads the seeded team, each card's state and the count on the profile", async ({
    page,
  }) => {
    const panel = await openTeam(page);

    for (const name of ['Costel Radu', 'Radu Oferte', 'Vlad Stan']) {
      await expect(
        panel.getByRole('listitem').filter({ hasText: name }),
      ).toBeVisible();
    }
    await expect(
      panel.getByRole('listitem').filter({ hasText: 'Costel Radu' }),
    ).toContainText('pe profil');
    await expect(page.getByText(/\d+ (de )?mecanici? pe profil/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});

test.describe('the garage team, kept current @seeded @mailbox', () => {
  test('a mechanic who accepts an invite appears in the open list within 5 seconds', async ({
    browser,
    page,
  }) => {
    const email = `echipa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const name = `Mecanic ${Math.random().toString(36).slice(2, 8)}`;
    const panel = await openTeam(page);
    await expect(panel.getByRole('listitem').first()).toBeVisible();

    await panel.getByRole('button', { name: 'Adaugă un mecanic' }).click();
    const invite = page.getByRole('dialog', { name: 'Invită în echipă' });
    await invite.getByLabel('Nume').fill(name);
    await invite.getByLabel('E‑mail').fill(email);
    await invite.getByRole('button', { name: 'Trimite invitația' }).click();
    await expect(invite.getByText('Invitația a fost trimisă.')).toBeVisible();
    await page.keyboard.press('Escape');

    const fresh = await browser.newContext();
    const invitee = await fresh.newPage();
    await ready(invitee, await lastInviteLink(page, email));
    await invitee.getByRole('button', { exact: true, name: 'Acceptă' }).click();
    const form = invitee.getByRole('dialog', { name: 'Cont nou' });
    await form.getByLabel('Parolă', { exact: true }).fill(NEW_PASSWORD);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Creează contul' }).click();
    await expect(invitee).toHaveURL('/app/garage');

    await expect(
      panel.getByRole('listitem').filter({ hasText: name }),
    ).toContainText('nu apare pe profil', { timeout: 5_000 });
    await fresh.close();
  });
});
