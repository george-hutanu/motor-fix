// @traces 140-FR-001 140-FR-006 140-FR-007 140-FR-009 140-FR-015 140-FR-017
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { ready, signIn } from './accounts.js';
import { violations } from './axe.js';
import { MAILBOX, test } from './fixtures.js';

// Each flow asks for the export of an account of its own: the once-a-day rule
// would refuse a second request from a seeded one.
const PASSWORD = 'export-de-date-2026';

const TEXT = {
  en: {
    button: 'Download my data',
    download: 'Download (ZIP)',
    expires: /^Available until \d{1,2} \w{3} \d{4}\.$/,
    panel: 'Your account',
    queued: 'We are preparing the file. We will e‑mail you when it is ready.',
    subject: 'Your data file is ready',
  },
  ro: {
    button: 'Descarcă datele mele',
    download: 'Descarcă (ZIP)',
    expires: /^Disponibil până pe \d{1,2} \S+ \d{4}\.$/,
    panel: 'Contul tău',
    queued: 'Pregătim fișierul. Îți trimitem un e‑mail când e gata.',
    subject: 'Fișierul tău cu date e gata',
  },
} as const;

const FILES = [
  'README.txt',
  'account.json',
  'audit.json',
  'bookings-and-jobs.json',
  'cars.json',
  'consents.json',
  'messages.json',
  'notifications-and-preferences.json',
  'requests-and-quotes.json',
  'reviews.json',
];

const SETTINGS_LINK = /https?:\/\/[^\s"<>]+\/app\/driver\/settings/;

async function newAccount(request: APIRequestContext, language: 'ro' | 'en') {
  const email = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const res = await request.post('/api/v1/auth/sign-up', {
    data: {
      consent: CURRENT_CONSENT,
      email,
      language,
      name: 'Andrei Export',
      password: PASSWORD,
    },
  });
  expect(res.status()).toBe(201);
  return email;
}

async function signedIn(page: Page, email: string) {
  await ready(page, '/ro');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { exact: true, name: 'Cont' })
      .click();
  } else {
    await page
      .getByRole('banner')
      .getByRole('button', { exact: true, name: 'Autentificare' })
      .click();
  }
  await signIn(page, email, { password: PASSWORD });
  await expect(page).toHaveURL(/\/app\//);
}

// The ready e-mail's link to Setări, as the worker sent it to the test mailbox.
async function readyLink(page: Page, email: string, subject: string) {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${MAILBOX}/messages?to=${encodeURIComponent(email)}`,
        );
        const sent: { subject: string; textContent: string }[] =
          await res.json();
        link = sent
          .filter((m) => m.subject === subject)
          .map((m) => SETTINGS_LINK.exec(m.textContent)?.[0])
          .find(Boolean);
        return link;
      },
      { message: 'no ready e-mail sent', timeout: 60_000 },
    )
    .toBeDefined();
  return new URL(String(link)).pathname;
}

// The ZIP's entries by name, read from its central directory; deflated
// entries are inflated, stored ones kept as they are.
function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + size);
    entries.set(
      name,
      (method === 8 ? inflateRawSync(body) : body).toString('utf8'),
    );
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const [label, viewport, language] of [
  ['the narrowest phone', { height: 640, width: 320 }, 'ro'],
  ['a desktop', { height: 900, width: 1440 }, 'en'],
] as const) {
  // @seeded: the real API, the worker and the store; @mailbox: the ready
  // e-mail is read from the local test mailbox.
  test.describe(`downloading my data on ${label} @seeded @mailbox`, () => {
    test.use({ viewport });

    test(`a driver asks for the file in ${language}, follows the e-mail to Setări and downloads the ZIP`, async ({
      page,
      request,
    }) => {
      const text = TEXT[language];
      const email = await newAccount(request, language);
      await signedIn(page, email);
      await page.goto('/app/driver/settings');

      const panel = page.locator('mf-account-panel');
      await expect(
        panel.getByRole('heading', { exact: true, level: 2, name: text.panel }),
      ).toBeVisible();
      const button = panel.getByRole('button', {
        exact: true,
        name: text.button,
      });
      await expect(button).toBeEnabled();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(
        await violations(page, {}, { include: [['mf-account-panel']] }),
      ).toEqual([]);

      await button.click();
      await expect(panel.getByRole('status')).toHaveText(text.queued);
      await expect(button).toBeHidden();

      await page.goto(await readyLink(page, email, text.subject));
      const download = panel.getByRole('button', {
        exact: true,
        name: text.download,
      });
      await expect(download).toBeVisible();
      await expect(panel.getByRole('status')).toHaveText(text.expires);
      await expect(
        panel.getByRole('button', { exact: true, name: text.button }),
      ).toBeHidden();
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      const [file] = await Promise.all([
        page.waitForEvent('download'),
        download.click(),
      ]);
      expect(file.suggestedFilename()).toMatch(
        /^motorfix-date-\d{4}-\d{2}-\d{2}\.zip$/,
      );
      const entries = unzip(await readFile(await file.path()));
      expect([...entries.keys()].sort()).toEqual(FILES);
      expect(JSON.parse(String(entries.get('account.json')))).toEqual(
        expect.objectContaining({ email }),
      );
      expect(JSON.parse(String(entries.get('reviews.json')))).toEqual([]);
    });
  });
}

// @seeded
test.describe('the data export for someone else @seeded', () => {
  test('is never served without a session', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const res = await anonymous.get('/api/v1/me/data-export/download');
    expect(res.status()).toBe(401);
    await anonymous.dispose();
  });
});
