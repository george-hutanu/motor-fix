import { expect, type Locator, type Page } from '@playwright/test';

import { ready } from './accounts.js';
import { test } from './fixtures.js';

// The WhatsApp messages as the api sent them, read from the test mailbox the
// local run starts (mailbox.mjs); a deployed address has none.
const MAILBOX = 'http://127.0.0.1:3025';
// The verified number of the seeded owner of Service Dobre, who used the
// garage last (libs/domain/src/seed.ts).
const GARAGE_PHONE = '+40700000101';

async function lastCode(page: Page, phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/whatsapp?to=${encodeURIComponent(phone.slice(1))}`,
        );
        const sent: { params: string[] }[] = await res.json();
        code = sent.at(-1)?.params[0];
        return code;
      },
      { message: 'no WhatsApp message sent', timeout: 20_000 },
    )
    .toMatch(/^\d{6}$/);
  return String(code);
}

// A number no account holds, under the allow-listed +4070000 prefix and
// outside the seeded ones and the refused +40700009999, new on every run.
const freshPhone = () =>
  `+4070000${String(1000 + Math.floor(Math.random() * 8999))}`;

test.describe('signing in with a phone number @seeded @mailbox', () => {
  test('a garage owner asks for a code, types it and lands on the garage', async ({
    page,
  }) => {
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Autentificare' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();

    await dialog.getByRole('button', { name: 'Continuă cu telefonul' }).click();
    await dialog.getByLabel('Număr de telefon').fill('0700 000 101');
    await dialog.getByRole('button', { name: 'Trimite codul' }).click();

    await expect(dialog.getByLabel('Cod')).toBeFocused();
    await dialog.getByLabel('Cod').fill(await lastCode(page, GARAGE_PHONE));
    await dialog.getByRole('button', { name: 'Intră în cont' }).click();

    await expect(page).toHaveURL('/app/garage');
  });

  test('a new number gets a code, a name and the tick, and lands on the driver dashboard', async ({
    page,
  }) => {
    const phone = freshPhone();
    await ready(page, '/ro/garages');
    await page
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Autentificare' });
    await expect(dialog.locator('mf-overlay-panel')).toBeVisible();

    await dialog.getByRole('button', { name: 'Continuă cu telefonul' }).click();
    await dialog.getByLabel('Număr de telefon').fill(phone);
    await dialog.getByRole('button', { name: 'Trimite codul' }).click();
    await dialog.getByLabel('Cod').fill(await lastCode(page, phone));
    await dialog.getByRole('button', { name: 'Intră în cont' }).click();

    await expect(dialog.getByLabel('Nume')).toBeFocused();
    await dialog.getByLabel('Nume').fill('Ion Popescu');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Creează contul' }).click();

    await expect(page).toHaveURL('/app/driver');
  });
});

// The number the test mailbox answers 400, as Brevo answers one it cannot reach.
const REFUSED_PHONE = '+40700009999';

const TEXTS = {
  en: {
    account: 'Account',
    again: 'Send again',
    code: 'Code',
    create: 'Create the account',
    name: 'Name',
    number: 'Phone number',
    send: 'Send the code',
    submit: 'Sign in',
    title: 'Sign in',
    withPhone: 'Continue with phone',
  },
  ro: {
    account: 'Cont',
    again: 'Trimite din nou',
    code: 'Cod',
    create: 'Creează contul',
    name: 'Nume',
    number: 'Număr de telefon',
    send: 'Trimite codul',
    submit: 'Intră în cont',
    title: 'Autentificare',
    withPhone: 'Continuă cu telefonul',
  },
} as const;

// Wider screens put the focus on the step's field; phones only show it, so
// no on-screen keyboard pops up (libs/overlays/src/panel.ts).
async function atField(page: Page, field: Locator) {
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(field).toBeVisible();
  } else {
    await expect(field).toBeFocused();
  }
}

async function phoneStep(page: Page, lang: keyof typeof TEXTS) {
  const t = TEXTS[lang];
  await ready(page, `/${lang}/garages`);
  // Phones open it from the tab bar, wider screens from the top bar.
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole('link', { name: t.account }).click();
  } else {
    await page.getByRole('button', { exact: true, name: t.title }).click();
  }
  const dialog = page.getByRole('dialog', { name: t.title });
  await expect(dialog.locator('mf-overlay-panel')).toBeVisible();
  await dialog.getByRole('button', { name: t.withPhone }).click();
  await atField(page, dialog.getByLabel(t.number));
  return dialog;
}

test.describe('when WhatsApp does not take the code @mailbox', () => {
  test('a number the stub refuses shows the fallback message and the e-mail link', async ({
    page,
  }) => {
    const dialog = await phoneStep(page, 'ro');
    await dialog.getByLabel('Număr de telefon').fill(REFUSED_PHONE);
    await dialog.getByRole('button', { name: 'Trimite codul' }).click();

    const fallback = dialog.getByRole('alert');
    await expect(fallback).toContainText(
      'Nu am putut trimite codul pe WhatsApp.',
    );
    await fallback
      .getByRole('button', { name: 'Intră cu e‑mail și parolă' })
      .click();
    await expect(dialog.getByLabel('E‑mail')).toBeVisible();
  });
});

// Each step at each size, in light and dark, scrolls nothing sideways.
const SIZES = [
  { height: 640, width: 320 },
  { height: 844, width: 390 },
  { height: 1024, width: 768 },
  { height: 900, width: 1440 },
];

async function holds(page: Page, step: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const viewport = page.viewportSize()?.width ?? 0;
    expect(width, `${step} in ${colorScheme}`).toBeLessThanOrEqual(viewport);
  }
}

test.describe('the three steps on every screen @mailbox', () => {
  for (const size of SIZES) {
    for (const lang of ['ro', 'en'] as const) {
      test(`at ${size.width} px in ${lang}, the number, code and profile steps scroll nothing sideways`, async ({
        page,
      }) => {
        const t = TEXTS[lang];
        const phone = freshPhone();
        await page.setViewportSize(size);
        const dialog = await phoneStep(page, lang);
        await holds(page, 'number');

        await dialog.getByLabel(t.number).fill(phone);
        await dialog.getByRole('button', { name: t.send }).click();
        await atField(page, dialog.getByLabel(t.code));
        await holds(page, 'code');

        await dialog.getByLabel(t.code).fill(await lastCode(page, phone));
        await dialog
          .getByRole('button', { exact: true, name: t.submit })
          .click();
        await atField(page, dialog.getByLabel(t.name));
        await holds(page, 'profile');
        await expect(
          dialog.getByRole('button', { name: t.create }),
        ).toBeVisible();
      });
    }
  }
});
