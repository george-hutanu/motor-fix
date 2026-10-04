import { expect, type Page, test } from '@playwright/test';

// The href of the first <link> carrying the attribute, in any attribute order.
const href = (html: string, attribute: string) =>
  html.match(
    new RegExp(`<link(?=[^>]*${attribute})[^>]*\\shref="([^"]+)"`),
  )?.[1];
const canonical = (html: string) => href(html, 'rel="canonical"');
const alternate = (html: string, hreflang: string) =>
  href(html, `hreflang="${hreflang}"`);

const switchGroup = (page: Page, name: 'Limba' | 'Language') =>
  page.getByRole('group', { name });

test('each language address arrives from the server in its language, with its search engine links', async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  for (const [address, language, heading] of [
    ['/ro/', 'ro', 'versiune necunoscută|PostgreSQL'],
    ['/en/', 'en', 'version unknown|PostgreSQL'],
  ]) {
    const html = await (await request.get(address)).text();

    expect(html).toContain(`<html lang="${language}"`);
    expect(html).toMatch(new RegExp(heading));
    expect(canonical(html)).toBe(`${origin}/${language}/`);
    expect(alternate(html, 'ro')).toBe(`${origin}/ro/`);
    expect(alternate(html, 'en')).toBe(`${origin}/en/`);
    expect(alternate(html, 'x-default')).toBe(`${origin}/ro/`);
    expect(html).not.toContain('name="robots"');
  }
});

test('/en/ arrives in English with every text filled in', async ({
  request,
}) => {
  const html = await (await request.get('/en/')).text();

  expect(html).toContain('aria-label="Language"');
  expect(html).not.toMatch(/shell\.[a-z]/);
});

test('the sitemap lists both language addresses, and robots.txt names it', async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const sitemap = await request.get('/sitemap.xml');
  const xml = await sitemap.text();

  expect(sitemap.headers()['content-type']).toContain('xml');
  expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])).toEqual([
    `${origin}/ro/`,
    `${origin}/en/`,
  ]);
  expect(await (await request.get('/robots.txt')).text()).toContain(
    `Sitemap: ${origin}/sitemap.xml`,
  );
});

test('pages that are not public tell search engines not to index them', async ({
  request,
}) => {
  const dashboard = await request.get('/app/driver');
  expect(dashboard.headers()['x-robots-tag']).toBe('noindex');

  const unknown = await request.get('/de/');
  const html = await unknown.text();
  expect(unknown.status()).toBe(404);
  expect(html).toContain('<html lang="ro"');
  expect(html).toContain('Pagina nu există');
  expect(html).toMatch(/<meta(?=[^>]*name="robots")[^>]*content="noindex"/);
  expect(canonical(html)).toBeUndefined();
});

test('EN on /ro moves the address to /en with no reload and no new history entry', async ({
  page,
}) => {
  await page.goto('/ro/');
  await expect(switchGroup(page, 'Limba')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const entries = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  await switchGroup(page, 'Limba').getByRole('button', { name: 'EN' }).click();

  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
  expect(await page.evaluate(() => history.length)).toBe(entries);
});

test('an /en/ address opened with Romanian remembered stays English', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('mf.lang', 'ro');
      sessionStorage.setItem('seeded', '1');
    }
  });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/en/');
  await expect(switchGroup(page, 'Language')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveURL(/\/en\/?$/);
  expect(await page.evaluate(() => localStorage.getItem('mf.lang'))).toBe('en');
  expect(errors.filter((e) => /NG0\d+/.test(e))).toEqual([]);
});

test('/ with English remembered goes to /en', async ({ page }) => {
  await page.goto('/ro/');
  await page.evaluate(() => localStorage.setItem('mf.lang', 'en'));
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');

  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(switchGroup(page, 'Language')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors.filter((e) => /NG0\d+/.test(e))).toEqual([]);
});
