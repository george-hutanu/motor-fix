import { expect, type Page } from '@playwright/test';

import { ACCOUNTS, headers, ready, signIn } from './accounts.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

const MECHANIC_MENU = [
  'Panou',
  'Programări',
  'Lucrări',
  'Setări',
  'Istoric modificări',
];

async function signedIn(page: Page, email: string) {
  await keepSeededLanguage(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL('/app/garage');
  // Romanian whatever an earlier run left saved on the shared account.
  await page
    .getByRole('group', { name: /^(Limba|Language)$/ })
    .getByRole('button', { exact: true, name: 'RO' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Panou service',
  );
}

// @seeded: signs in as the seeded accounts against the real API; the seed is
// never changed, and the one invite it needs is sent and revoked here.
test.describe('garage members @seeded', () => {
  // @traces 102-FR-020
  test('a mechanic who may do nothing more sees only her own views in the menu', async ({
    page,
  }) => {
    await signedIn(page, ACCOUNTS.mechanic);
    const menu = page.getByRole('navigation', { name: 'Meniu' });

    await expect(menu.getByRole('link')).toHaveText(MECHANIC_MENU);
    await page.goto('/app/garage/team');
    await expect(page).toHaveURL('/app/garage');
  });

  // @traces 102-FR-020
  test('the owner sees who has access in Setări, with a pending invite until it is revoked', async ({
    page,
    request,
  }) => {
    const owner = await headers(request, ACCOUNTS.garage);
    const me = await request.get('/api/v1/me', { headers: owner });
    const { garageId } = (await me.json()) as { garageId: string };
    const email = `acces-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

    await signedIn(page, ACCOUNTS.garage);
    await page
      .getByRole('navigation', { name: 'Meniu' })
      .getByRole('link', { exact: true, name: 'Setări' })
      .click();
    await expect(page).toHaveURL('/app/garage/settings');
    const panel = page.getByRole('region', { name: 'Persoane cu acces' });
    const members = panel.locator('[data-member]');

    await expect(
      members.filter({ hasText: 'Mihai Ionescu' }).first(),
    ).toContainText('proprietar');
    await expect(
      members.filter({ hasText: 'Ioana Marin' }).first(),
    ).toContainText('recepție');
    await expect(
      members.filter({ hasText: 'Vlad Stan' }).first(),
    ).toContainText('mecanic');

    const sent = await request.post(`/api/v1/garages/${garageId}/invites`, {
      data: { email, kind: 'receptionist', name: 'Ana Acces' },
      headers: owner,
    });
    expect(sent.status(), await sent.text()).toBe(201);
    const { id } = (await sent.json()) as { id: string };
    const invite = panel.locator('[data-invite]').filter({ hasText: email });

    try {
      await expect(invite).toContainText('recepție', { timeout: 5_000 });
      await expect(invite).toContainText('trimisă azi');
    } finally {
      const revoked = await request.post(
        `/api/v1/garages/${garageId}/invites/${id}/revoke`,
        { headers: owner },
      );
      expect(revoked.status()).toBe(204);
    }
    await expect(invite).toHaveCount(0, { timeout: 5_000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
