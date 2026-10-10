import { expect, type Page } from '@playwright/test';

import { ready, settled } from './accounts.js';
import { test } from './fixtures.js';

const picker = (page: Page) =>
  page.getByRole('radiogroup', { name: 'Marca mașinii' });
const tile = (page: Page, name: string) =>
  picker(page).getByRole('radio', { exact: true, name });
const homeReads = (page: Page) => {
  const brands: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/home') {
      brands.push(url.searchParams.get('brand') ?? '');
    }
  });
  return brands;
};
const nearReads = (page: Page) => {
  const nears: (string | null)[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/home') {
      nears.push(url.searchParams.get('near'));
    }
  });
  return nears;
};
const placeReads = (page: Page) => {
  const texts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/places') {
      texts.push(url.searchParams.get('q') ?? '');
    }
  });
  return texts;
};
const line = (page: Page) => page.locator('mf-home .place');
const placeDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Alege locul' });
const field = (page: Page) => placeDialog(page).getByRole('combobox');

const CLUJ = {
  label: 'Strada Exemplu 2, Cluj-Napoca',
  lat: 46.7712,
  lng: 23.6236,
};
// The address look-up is answered here, not by the api: only the api's test
// boot has a stand-in with fixed answers, and a deployed api answers real
// addresses or none at all.
const answerPlaces = (page: Page) =>
  page.route('**/api/v1/places?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({
      body: JSON.stringify({ items: /cluj/i.test(q) ? [CLUJ] : [] }),
      contentType: 'application/json',
      status: 200,
    });
  });

test('the server sends eight brand tiles, the first one selected', async ({
  request,
}) => {
  const html = await (await request.get('/ro')).text();

  expect(html.match(/role="radio"/g)).toHaveLength(8);
  expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  expect(html).not.toMatch(/public\.[a-z]/);
});

test.describe('the brand picker @seeded', () => {
  test('counts the garages that take Dacia after one read, in both languages', async ({
    page,
  }) => {
    const reads = homeReads(page);
    await ready(page, '/ro');
    reads.length = 0;

    await tile(page, 'Dacia').click();

    await expect(
      page.getByText('5 din 8 service‑uri primesc Dacia'),
    ).toBeVisible();
    await expect(page.getByText('Service‑uri pentru Dacia')).toBeVisible();
    expect(reads).toEqual(['dacia']);

    await page.getByRole('button', { exact: true, name: 'EN' }).click();

    await expect(page.getByText('5 of 8 garages take Dacia')).toBeVisible();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Car brand' })
        .getByRole('radio', { checked: true }),
    ).toHaveText('Dacia');
  });

  test('opens the results for the chosen brand', async ({ page }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();

    await page.getByRole('link', { name: 'Caută service‑uri' }).click();

    await expect(page).toHaveURL('/ro/garages?brand=dacia');
  });

  test('moves to the next brand within 5.5 s, and stays put after a tap', async ({
    page,
  }) => {
    await ready(page, '/ro');
    const second = picker(page).getByRole('radio').nth(1);

    await expect(second).toHaveAttribute('aria-checked', 'true', {
      timeout: 5500,
    });

    await tile(page, 'Dacia').click();
    await page.waitForTimeout(12_000);
    await expect(tile(page, 'Dacia')).toHaveAttribute('aria-checked', 'true');
  });

  test('says when the count could not load, and tries again', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/v1/home?*', (route) =>
      fail ? route.fulfill({ status: 503 }) : route.continue(),
    );
    await ready(page, '/ro');

    await tile(page, 'Dacia').click();
    await expect(
      page.getByText('Nu am putut încărca service‑urile'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Caută service‑uri' }),
    ).toHaveAttribute('href', '/ro/garages?brand=dacia');

    fail = false;
    await page.getByRole('button', { name: 'Reîncearcă' }).click();

    await expect(
      page.getByText('5 din 8 service‑uri primesc Dacia'),
    ).toBeVisible();
  });
});

test.describe('the place on Home @seeded', () => {
  test('starts with all of Romania and no distance', async ({ page }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();

    await expect(line(page)).toHaveText(/În toată România\s*·\s*Alege locul/);
    await expect(
      page.getByText('5 din 8 service‑uri primesc Dacia'),
    ).toBeVisible();
    await expect(page.locator('mf-home')).not.toContainText('km');
  });

  test.describe('with the location shared', () => {
    test.use({
      geolocation: { latitude: 46.7712, longitude: 23.6236 },
      permissions: ['geolocation'],
    });

    test('counts the garages near the visitor after one more read', async ({
      page,
    }) => {
      const nears = nearReads(page);
      await ready(page, '/ro');
      await tile(page, 'Dacia').click();
      await expect(
        page.getByText('5 din 8 service‑uri primesc Dacia'),
      ).toBeVisible();
      nears.length = 0;

      await line(page).getByRole('button').click();
      await placeDialog(page)
        .getByRole('button', { name: 'Folosește locația mea' })
        .click();

      await expect(line(page)).toHaveText(/Lângă tine\s*·\s*Schimbă/);
      await expect(
        page.getByText('2 din 2 service‑uri primesc Dacia'),
      ).toBeVisible();
      expect(nears).toEqual(['46.771,23.624']);
    });
  });

  test('hints at the address when the location is refused, and finds the address typed', async ({
    page,
  }) => {
    const texts = placeReads(page);
    await answerPlaces(page);
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();

    await line(page).getByRole('button').click();
    await placeDialog(page)
      .getByRole('button', { name: 'Folosește locația mea' })
      .click();
    await expect(
      placeDialog(page).getByText('Nu am putut afla locația; scrie o adresă'),
    ).toBeVisible();
    await expect(field(page)).toBeFocused();

    await field(page).fill('Cluj');
    await placeDialog(page)
      .getByRole('option', { name: 'Strada Exemplu 2, Cluj-Napoca' })
      .click();

    await expect(line(page)).toHaveText(
      /Lângă Strada Exemplu 2, Cluj-Napoca\s*·\s*Schimbă/,
    );
    await expect(
      page.getByText('2 din 2 service‑uri primesc Dacia'),
    ).toBeVisible();
    expect(texts).toEqual(['Cluj']);
  });

  test('says when no address was found', async ({ page }) => {
    await answerPlaces(page);
    await ready(page, '/ro');
    await line(page).getByRole('button').click();

    await field(page).fill('nicaieri');

    await expect(
      placeDialog(page).getByText('Nu am găsit adresa'),
    ).toBeVisible();
  });

  test('says when addresses cannot be searched, and keeps the count', async ({
    page,
  }) => {
    await page.route('**/api/v1/places?*', (route) =>
      route.fulfill({ status: 503 }),
    );
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();
    await expect(
      page.getByText('5 din 8 service‑uri primesc Dacia'),
    ).toBeVisible();

    await line(page).getByRole('button').click();
    await field(page).fill('Cluj');

    await expect(
      placeDialog(page).getByText('Nu putem căuta adrese acum'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByText('5 din 8 service‑uri primesc Dacia'),
    ).toBeVisible();
  });

  test('keeps the place after a reload and in the other language', async ({
    page,
  }) => {
    await answerPlaces(page);
    await ready(page, '/ro');
    await line(page).getByRole('button').click();
    await field(page).fill('Cluj');
    await placeDialog(page)
      .getByRole('option', { name: 'Strada Exemplu 2, Cluj-Napoca' })
      .click();
    await expect(line(page)).toContainText('Strada Exemplu 2');

    const nears = nearReads(page);
    await page.reload();
    await settled(page);

    await expect(line(page)).toHaveText(
      /Lângă Strada Exemplu 2, Cluj-Napoca\s*·\s*Schimbă/,
    );
    expect(nears[0]).toBe('46.771,23.624');
    await expect(placeDialog(page)).toHaveCount(0);

    await page.getByRole('button', { exact: true, name: 'EN' }).click();

    await expect(line(page)).toHaveText(
      /Near Strada Exemplu 2, Cluj-Napoca\s*·\s*Change/,
    );
  });
});

test.describe('the brand picker with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('stays on the first brand', async ({ page }) => {
    await ready(page, '/ro');

    await page.waitForTimeout(11_000);

    await expect(picker(page).getByRole('radio').first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

for (const scheme of ['light', 'dark'] as const) {
  for (const path of ['/ro', '/en']) {
    test(`fits a 320 px phone in two columns on ${path}, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await ready(page, path);

      const boxes = await page
        .getByRole('radiogroup')
        .getByRole('radio')
        .evaluateAll((tiles) =>
          tiles.map((t) => {
            const box = t.getBoundingClientRect();
            return { height: box.height, left: Math.round(box.left) };
          }),
        );
      expect(new Set(boxes.map((b) => b.left)).size).toBe(2);
      for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
    });
  }
}

for (const scheme of ['light', 'dark'] as const) {
  for (const path of ['/ro', '/en']) {
    test(`fits the place line and its dialog on a 320 px phone on ${path}, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await ready(page, path);
      const width = () =>
        page.evaluate(() => document.documentElement.scrollWidth);

      await expect(line(page)).toBeVisible();
      const box = await line(page).getByRole('button').boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(await width()).toBeLessThanOrEqual(320);

      await line(page).getByRole('button').click();
      await expect(page.getByRole('combobox')).toBeVisible();
      expect(await width()).toBeLessThanOrEqual(320);
    });
  }
}

// @traces 226-FR-001
// @traces 226-FR-002
// @traces 226-FR-003
// @traces 226-FR-006
const dialArea = (page: Page) => page.locator('mf-home .dial');
const dialValue = (page: Page) =>
  dialArea(page).locator('mf-rating-dial .mf-dial-value');
const previewRows = (page: Page) => page.locator('mf-home-preview a.row');
const useLocation = async (page: Page) => {
  await line(page).getByRole('button').click();
  await placeDialog(page)
    .getByRole('button', { name: 'Folosește locația mea' })
    .click();
  await expect(line(page)).toHaveText(/Lângă tine\s*·\s*Schimbă/);
};
const chooseTesla = async (page: Page) => {
  await page.getByRole('combobox', { name: 'Caută marca' }).fill('tesla');
  await page.getByRole('option', { name: 'Tesla' }).click();
};

test.describe('the rating dial near Bucharest @seeded', () => {
  test.use({
    geolocation: { latitude: 44.4268, longitude: 26.1025 },
    permissions: ['geolocation'],
  });

  test('names the best garage for Dacia, then two takers and one refuser', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();
    const reads = homeReads(page);

    await useLocation(page);

    await expect(dialValue(page)).toHaveText('4,9');
    await expect(dialArea(page)).toContainText('NOTĂ');
    await expect(dialArea(page).locator('.name')).toHaveText(
      'Service Auto Militari',
    );
    await expect(dialArea(page).locator('.line')).toHaveText(
      /București · \d+,\d km/,
    );
    await expect(previewRows(page)).toHaveCount(3);
    await expect(previewRows(page).locator('.name')).toHaveText([
      'Service Auto Militari',
      'Atelier Berceni',
      'Service Colentina',
    ]);
    await expect(previewRows(page).locator('mf-lamp')).toHaveText([
      'Lucrează pe Dacia',
      'Lucrează pe Dacia',
      'Nu primește Dacia',
    ]);
    expect(reads).toEqual(['dacia']);

    await previewRows(page).first().click();
    await expect(page).toHaveURL(
      '/ro/garages/service-auto-militari?brand=dacia',
    );
  });

  // @traces 226-FR-004
  test('rests at "—" when nobody near takes the brand, with only refusing rows', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await useLocation(page);

    await chooseTesla(page);

    await expect(dialValue(page)).toHaveText('—');
    await expect(dialArea(page).locator('.name')).toHaveText(
      'Niciun service din zonă nu primește încă Tesla',
    );
    await expect(previewRows(page)).toHaveCount(3);
    for (const lamp of await previewRows(page).locator('mf-lamp').all()) {
      await expect(lamp).toHaveText('Nu primește Tesla');
    }
  });
});

test.describe('the rating dial in Cluj-Napoca @seeded', () => {
  test.use({
    geolocation: { latitude: 46.7712, longitude: 23.6236 },
    permissions: ['geolocation'],
  });

  test('names the mobile mechanic that comes to you', async ({ page }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();

    await useLocation(page);

    await expect(dialValue(page)).toHaveText('4,8');
    await expect(dialArea(page).locator('.name')).toHaveText(
      'Mecanic Mobil Cluj',
    );
    await expect(dialArea(page).locator('.line')).toHaveText(
      'Mecanic mobil · vine la tine',
    );
  });
});

// @traces 226-FR-004
test.describe('the rating dial far from every garage @seeded', () => {
  test.use({
    geolocation: { latitude: 44.1733, longitude: 28.6383 },
    permissions: ['geolocation'],
  });

  test('says no garage is within 25 km and offers to change the place', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();

    await useLocation(page);

    await expect(dialArea(page).locator('.name')).toHaveText(
      'Niciun service în 25 km',
    );
    await expect(previewRows(page)).toHaveCount(0);
    await dialArea(page).getByRole('button', { name: 'Schimbă locul' }).click();
    await expect(placeDialog(page)).toBeVisible();
  });
});

test.describe('the rating dial with reduced motion @seeded', () => {
  test.use({ reducedMotion: 'reduce' });

  test('moves the dial and the first row in one render, the needle with no transition', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();
    await expect(dialValue(page)).toHaveText('4,9');

    await chooseTesla(page);
    await expect(dialValue(page)).toHaveText('—');

    // Read in one task, so the dial and the row are seen in the same render.
    expect(
      await page.evaluate(() => [
        document
          .querySelector('mf-home .dial .mf-dial-value')
          ?.textContent?.trim(),
        document
          .querySelector('mf-home-preview a.row mf-lamp')
          ?.getAttribute('data-state'),
      ]),
    ).toEqual(['—', 'red']);
    expect(
      await dialArea(page)
        .locator('.mf-dial-needle')
        .evaluate((n) => getComputedStyle(n).transitionDuration),
    ).toBe('0s');
  });
});

// @traces 226-FR-008
for (const scheme of ['light', 'dark'] as const) {
  for (const path of ['/ro', '/en']) {
    test(`fits the dial and its three rows on a 320 px phone on ${path}, ${scheme} @seeded`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await ready(page, path);
      await page.getByRole('radio', { exact: true, name: 'Dacia' }).click();

      await expect(previewRows(page)).toHaveCount(3);
      for (const box of await previewRows(page).evaluateAll((rows) =>
        rows.map((r) => r.getBoundingClientRect().height),
      )) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
      const dialWidth = await dialArea(page)
        .locator('mf-rating-dial')
        .evaluate((d) => d.getBoundingClientRect().width);
      expect(dialWidth).toBeLessThanOrEqual(240);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
    });
  }
}
