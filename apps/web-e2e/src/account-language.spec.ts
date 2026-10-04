import { expect, type Page, test } from '@playwright/test';

const driver = {
  capabilities: [],
  email: 'andrei@example.ro',
  garageId: null,
  id: 'driver-1',
  landing: '/app/driver',
  name: 'Andrei',
  role: 'driver',
  roles: ['driver'],
};

// The renewal, "who am I" and the language change are stubbed; each change is
// recorded and answered with the account it saved.
async function signedIn(page: Page, language: 'ro' | 'en' = 'ro') {
  const saved: unknown[] = [];
  let current = language;
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ json: { accessToken: 'stubbed' } }),
  );
  await page.route('**/api/v1/me', async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { language: 'ro' | 'en' };
      saved.push(body);
      current = body.language;
    }
    await route.fulfill({ json: { ...driver, language: current } });
  });
  return saved;
}

const languageSwitch = (page: Page, name: 'Limba' | 'Language') =>
  page.getByRole('group', { name });

// Both buttons are on screen and at least 44 px tall.
async function fits(page: Page, group: 'Limba' | 'Language', width: number) {
  for (const name of ['RO', 'EN']) {
    const box = await languageSwitch(page, group)
      .getByRole('button', { name })
      .boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  }
}

for (const [width, height] of [
  [320, 640],
  [390, 844],
  [1280, 800],
] as const) {
  test(`at ${width} px a signed-in switch saves the language on the account`, async ({
    page,
  }) => {
    await page.setViewportSize({ height, width });
    const saved = await signedIn(page);
    await page.goto('/app/driver');
    await expect(
      page.getByRole('button', { name: 'Ieși din cont' }),
    ).toBeVisible();

    await fits(page, 'Limba', width);
    await languageSwitch(page, 'Limba')
      .getByRole('button', { name: 'EN' })
      .click();

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect.poll(() => saved).toEqual([{ language: 'en' }]);
    await fits(page, 'Language', width);
    const english = languageSwitch(page, 'Language');

    await english.getByRole('button', { name: 'RO' }).click();

    await expect(
      page.getByRole('button', { name: 'Ieși din cont' }),
    ).toBeVisible();
    await expect
      .poll(() => saved)
      .toEqual([{ language: 'en' }, { language: 'ro' }]);
  });
}

test('the account language opens the dashboard, and nothing is saved for it', async ({
  page,
}) => {
  const saved = await signedIn(page, 'en');

  await page.goto('/app/driver');

  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(saved).toEqual([]);
});

test('a signed-out switch stays on the device and sends nothing', async ({
  page,
}) => {
  const changes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') changes.push(request.url());
  });
  await page.goto('/ro');
  await expect(languageSwitch(page, 'Limba')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await languageSwitch(page, 'Limba')
    .getByRole('button', { name: 'EN' })
    .click();

  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(languageSwitch(page, 'Language')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(changes).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('mf.lang'))).toBe('en');
});
