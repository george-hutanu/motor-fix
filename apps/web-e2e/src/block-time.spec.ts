import { expect, type Page } from '@playwright/test';

import { headers, ready, signIn } from './accounts.js';
import { bucharestDay } from './bucharest-day.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

async function signedIn(page: Page, email: string, landing: string) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, email);
  await expect(page).toHaveURL(landing);
}

interface Block {
  id: string;
  lift?: number | null;
  mechanic: { id: string; name: string } | null;
  note: string | null;
  startsAt: string;
  endsAt: string;
}

// @seeded: the seeded receptionist blocks a mechanic and a lift of her garage.
// Service Auto Militari is the seeded garage with lifts (at least two) and
// mechanic cards; the plain receptionist's Atelier Test has no lift.
const RECEPTIONIST = 'receptie-militari@example.test';

test.describe('blocking time from the dashboard @seeded', () => {
  // @traces 1403-FR-011
  test('the receptionist blocks the first mechanic and the last lift a month ahead, and the block reads back', async ({
    page,
    request,
  }) => {
    const auth = await headers(request, RECEPTIONIST);
    const me = await request.get('/api/v1/me', { headers: auth });
    expect(me.ok()).toBe(true);
    const { garageId } = (await me.json()) as { garageId: string };
    // A month out: the quote and booking specs take tomorrow at the same garage.
    const day = bucharestDay(30);
    const note = 'Client la telefon: Ford Focus, plăcuțe';

    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page, RECEPTIONIST, '/app/garage');
    await page
      .getByRole('button', { exact: true, name: 'Blochează timp' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Blochează timp' });
    const mechanic = dialog.getByLabel('Mecanic');
    // The choices arrive after the dialog opens.
    await expect(mechanic).toBeEnabled();
    const [, first] = await mechanic.locator('option').allTextContents();
    await mechanic.selectOption({ label: first });
    const lifts = await dialog
      .getByLabel('Elevator')
      .locator('option')
      .allTextContents();
    const last = lifts[lifts.length - 1];
    await dialog.getByLabel('Elevator').selectOption({ label: last });
    await dialog.locator('#mf-block-from-day').fill(day);
    await dialog.locator('#mf-block-from-time').fill('10:00');
    await dialog.locator('#mf-block-until-day').fill(day);
    await dialog.locator('#mf-block-until-time').fill('11:30');
    await dialog.getByLabel('Notă').fill(note);
    await dialog
      .getByRole('button', { exact: true, name: 'Blochează' })
      .click();

    await expect(page.getByText('Interval blocat')).toBeVisible();
    await expect(dialog).toBeHidden();

    const list = await request.get(
      `/api/v1/garages/${garageId}/time-blocks?from=${day}`,
      { headers: auth },
    );
    expect(list.ok(), await list.text()).toBe(true);
    const { blocks } = (await list.json()) as { blocks: Block[] };
    const made = blocks.find((block) => block.note === note);
    expect(made).toBeDefined();
    try {
      expect(made?.mechanic?.name).toBe(first.trim());
      expect(made?.lift).toBe(Number(last.replace(/\D/g, '')));
      expect(
        Date.parse(made?.endsAt ?? '') - Date.parse(made?.startsAt ?? ''),
      ).toBe(90 * 60_000);
    } finally {
      const gone = await request.delete(
        `/api/v1/garages/${garageId}/time-blocks/${made?.id}`,
        { headers: auth },
      );
      expect(gone.status()).toBe(204);
    }
  });
});
