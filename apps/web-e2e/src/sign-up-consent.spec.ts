import { expect, type Page, test } from '@playwright/test';

import { ready } from './accounts.js';

const fresh = () =>
  `acord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const TEXT = {
  en: {
    create: 'Create account',
    draft: 'Draft text, pending legal review.',
    newAccount: 'Create an account',
    password: 'Password',
    privacy: 'Privacy notice',
    signIn: 'Sign in',
    signUp: 'New account',
    terms: 'Terms of use',
    tick: 'Tick to continue.',
  },
  ro: {
    create: 'Creează contul',
    draft: 'Text provizoriu, în curs de revizuire juridică.',
    newAccount: 'Creează un cont',
    password: 'Parolă',
    privacy: 'Nota de informare privind datele personale',
    signIn: 'Autentificare',
    signUp: 'Cont nou',
    terms: 'Termenii de utilizare',
    tick: 'Bifează pentru a continua.',
  },
} as const;

async function openSignUp(page: Page, language: 'ro' | 'en') {
  const t = TEXT[language];
  await ready(page, `/${language}`);
  await page.getByRole('button', { exact: true, name: t.signIn }).click();
  await page
    .getByRole('dialog', { name: t.signIn })
    .getByRole('button', { name: t.newAccount })
    .click();
  const form = page.getByRole('dialog', { name: t.signUp });
  await expect(form.locator('mf-overlay-panel')).toBeVisible();
  return form;
}

test.describe('consent to the terms and the privacy notice @seeded', () => {
  test('sign-up stays blocked until the tick is set', async ({ page }) => {
    await page.route('**/api/v1/auth/sign-up', (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          'x-forwarded-for': `203.0.113.${Date.now() % 250}`,
        },
      }),
    );
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/auth/sign-up')) sent.push(r.url());
    });
    const form = await openSignUp(page, 'ro');
    await form.getByLabel('Nume').fill('Andrei Marin');
    await form.getByLabel('E‑mail').fill(fresh());
    await form
      .getByLabel('Parolă', { exact: true })
      .fill('parola-noua-de-test');

    const tick = form.getByRole('checkbox');
    await expect(tick).not.toBeChecked();
    await form.getByRole('button', { name: 'Creează contul' }).click();

    await expect(form.getByText(TEXT.ro.tick)).toBeVisible();
    await expect(tick).toBeFocused();
    expect(sent).toHaveLength(0);

    await tick.check();
    await form.getByRole('button', { name: 'Creează contul' }).click();
    await expect(page).toHaveURL('/app/driver');
    expect(sent).toHaveLength(1);
  });

  for (const language of ['ro', 'en'] as const) {
    test(`both links open their text in a new tab (${language})`, async ({
      context,
      page,
    }) => {
      const t = TEXT[language];
      const form = await openSignUp(page, language);

      for (const [name, path, title] of [
        [
          t.terms,
          'terms',
          language === 'ro' ? 'Termeni de utilizare' : t.terms,
        ],
        [t.privacy, 'privacy', t.privacy],
      ] as const) {
        const link = form.getByRole('link', { name });
        // A link inside the sentence keeps the line's height, so the
        // sentence wraps as text and the tick stays beside its first line.
        expect(await link.evaluate((a) => getComputedStyle(a).display)).toBe(
          'inline',
        );
        const opened = context.waitForEvent('page');
        await link.click();
        const tab = await opened;
        await tab.waitForLoadState();
        await expect(tab).toHaveURL(new RegExp(`/${language}/${path}$`));
        await expect(tab.getByRole('heading', { level: 1 })).toHaveText(title);
        await expect(tab.getByText(t.draft)).toBeVisible();
        await tab.close();
      }
      await expect(form.getByRole('checkbox')).not.toBeChecked();
    });
  }

  test('the texts are served to anyone, rendered on the server', async ({
    request,
  }) => {
    for (const path of [
      '/ro/terms',
      '/ro/privacy',
      '/en/terms',
      '/en/privacy',
    ]) {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
      expect(html).toContain(`rel="canonical"`);
    }
  });

  test('a text page does not scroll sideways on a 320 px phone', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    for (const path of ['/ro/terms', '/en/privacy']) {
      await ready(page, path);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(wide).toBe(false);
    }
  });
});
