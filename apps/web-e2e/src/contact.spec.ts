import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';
import { signInAs } from './sign-in.js';

// @traces 280-FR-001 280-FR-002 280-FR-003 280-FR-004 280-FR-008 280-FR-009 280-FR-018 280-FR-022

const MESSAGE = 'Nu găsesc cererea pe care am trimis-o ieri seară.';
const REFERENCE = /MF-\d{4}-\d{6}/;

const TEXT = {
  en: {
    send: 'Send the message',
    sent: 'We have your message. We will answer by e‑mail.',
  },
  ro: {
    send: 'Trimite mesajul',
    sent: 'Am primit mesajul tău. Îți răspundem pe e‑mail.',
  },
} as const;

// Each send its own address, so parallel workers never share the hourly limit.
const address = (tag: string) =>
  `contact-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function fill(page: Page, email: string) {
  await page.locator('#mf-contact-name').fill('Ana Pop');
  await page.locator('#mf-contact-email').fill(email);
  await page.locator('#mf-contact-topic').selectOption('account');
  await page.locator('#mf-contact-message').fill(MESSAGE);
}

for (const language of ['ro', 'en'] as const) {
  test(`a visitor sends a message from /${language}/contact and sees its number`, async ({
    page,
  }) => {
    await page.goto(`/${language}/contact`);
    await settled(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contact');
    await fill(page, address(language));
    await page.getByRole('button', { name: TEXT[language].send }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText(TEXT[language].sent);
    await expect(status).toContainText(REFERENCE);
    await expect(page.locator('form')).toHaveCount(0);
  });
}

test('the footer links to the contact page', async ({ page }) => {
  await page.goto('/ro/');
  await settled(page);

  await page.locator('footer').getByRole('link', { name: 'Contact' }).click();

  await expect(page).toHaveURL('/ro/contact');
  await expect(page.locator('mf-contact-form')).toBeVisible();
});

test('an empty form sends nothing and names each missing field', async ({
  page,
}) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/support/messages')) {
      sent.push(request.url());
    }
  });
  await page.goto('/ro/contact');
  await settled(page);

  await page.getByRole('button', { name: TEXT.ro.send }).click();

  for (const id of ['name', 'email', 'topic', 'message']) {
    await expect(page.locator(`#mf-contact-${id}`)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  }
  await expect(page.locator('#mf-contact-name')).toBeFocused();
  expect(sent).toEqual([]);
});

// The limit's answer is routed: six real sends would share a real limit
// between parallel workers.
test('says there were too many messages and keeps the text', async ({
  page,
}) => {
  await page.route('**/api/v1/support/messages', (route) =>
    route.fulfill({
      json: { code: 'too_many_messages', retryAfterSeconds: 3000 },
      status: 429,
    }),
  );
  await page.goto('/ro/contact');
  await settled(page);
  await fill(page, address('limit'));

  await page.getByRole('button', { name: TEXT.ro.send }).click();

  await expect(
    page.getByText('Prea multe mesaje. Încearcă din nou peste o oră.'),
  ).toBeVisible();
  await expect(page.locator('#mf-contact-message')).toHaveValue(MESSAGE);
});

test('a signed-in driver opens "Ajutor și contact" from the menu, filled in, and sends', async ({
  page,
}) => {
  await signInAs(page, 'driver', '/app/driver', ['driver.settings']);
  const bodies: unknown[] = [];
  await page.route('**/api/v1/support/messages', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: { reference: 'MF-2026-000042' },
      status: 201,
    });
  });
  await page.goto('/app/driver/settings');
  await settled(page);

  await page.getByRole('button', { name: 'Ajutor și contact' }).click();
  const drawer = page.getByRole('dialog', { name: 'Ajutor și contact' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('#mf-contact-name')).toHaveValue('Test driver');
  await expect(drawer.locator('#mf-contact-email')).toHaveValue(
    'driver@example.ro',
  );
  await drawer.locator('#mf-contact-topic').selectOption('other');
  await drawer.locator('#mf-contact-message').fill(MESSAGE);
  await drawer.getByRole('button', { name: TEXT.ro.send }).click();

  await expect(drawer.getByRole('status')).toContainText('MF-2026-000042');
  expect(bodies[0]).toMatchObject({
    email: 'driver@example.ro',
    name: 'Test driver',
    topic: 'other',
  });
  await drawer.getByRole('button', { name: 'Închide' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL('/app/driver/settings');
});
