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
    // The page's own clock: a loaded runner delays real timers past any
    // margin, so the test moves time itself rather than sleep through it.
    await page.clock.install();
    await ready(page, '/ro');
    const second = picker(page).getByRole('radio').nth(1);

    // The cycle starts at hydration, before ready() returns: 5.5 s of the
    // page's time from here holds the first move; the short wait after is
    // only the render.
    await page.clock.runFor(5500);
    await expect(second).toHaveAttribute('aria-checked', 'true', {
      timeout: 2000,
    });

    await tile(page, 'Dacia').click();
    await page.clock.runFor(12_000);
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
    const count = page.locator('mf-home .count');
    await expect(
      count.getByText('Nu am putut încărca service‑urile'),
    ).toBeVisible();
    // @traces 227-FR-006
    await expect(page.locator('mf-home-cards [role="alert"]')).toHaveText(
      /Nu am putut încărca service‑urile/,
    );
    await expect(
      page.getByRole('link', { name: 'Caută service‑uri' }),
    ).toHaveAttribute('href', '/ro/garages?brand=dacia');

    fail = false;
    await count.getByRole('button', { name: 'Reîncearcă' }).click();

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
// Picks Dacia and waits for Dacia's own rows: the rows already on screen for
// the dial's first brand also count three, and the list swaps to skeletons
// while Dacia's answer loads, so a count alone can read the outgoing rows.
const pickDacia = async (page: Page) => {
  await page.getByRole('radio', { exact: true, name: 'Dacia' }).click();
  await expect(previewRows(page)).toHaveCount(3);
  for (const row of await previewRows(page).all()) {
    await expect(row).toHaveAttribute('href', /[?&]brand=dacia(&|$)/);
  }
  await expect(previewRows(page).locator('mf-lamp')).toHaveCount(3);
};
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
    // The tile's own read lands after the click returns: wait for it, so
    // `reads` holds only the read the new place makes.
    const brandRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/v1/home' &&
        url.searchParams.get('brand') === 'dacia'
      );
    });
    await tile(page, 'Dacia').click();
    await brandRead;
    const reads = homeReads(page);

    await useLocation(page);

    await expect(dialValue(page)).toHaveText('4,9');
    await expect(dialArea(page)).toContainText('NOTĂ');
    await expect(dialArea(page).locator('.gauge .name')).toHaveText(
      'Service Auto Militari',
    );
    await expect(dialArea(page).locator('.gauge .line')).toHaveText(
      /București · \d+(,\d)? km/,
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
  // @traces 227-FR-011
  test('rests at "—" when nobody near takes the brand, with only refusing rows', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await useLocation(page);

    await chooseTesla(page);

    await expect(dialValue(page)).toHaveText('—');
    await expect(dialArea(page).locator('.gauge .name')).toHaveText(
      'Niciun service din zonă nu primește Tesla',
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
    await expect(dialArea(page).locator('.gauge .name')).toHaveText(
      'Mecanic Mobil Cluj',
    );
    await expect(dialArea(page).locator('.gauge .line')).toHaveText(
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

    await expect(dialArea(page).locator('.gauge .name')).toHaveText(
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
    // "—" is also the dial while the answer loads: wait for Tesla's rows.
    await expect(previewRows(page).first().locator('mf-lamp')).toHaveAttribute(
      'data-state',
      'red',
    );
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
      await pickDacia(page);

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

// @traces 226-FR-008
for (const path of ['/ro', '/en']) {
  test(`sets the preview rows' lamp, rating and rate at 16 px on a 390 px phone on ${path} @seeded`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await ready(page, path);
    await pickDacia(page);

    const sizes = await previewRows(page)
      .locator('mf-lamp, .rating, .rate')
      .evaluateAll((parts) =>
        parts.map((p) => Number.parseFloat(getComputedStyle(p).fontSize)),
      );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(16);
    }
  });
}

// @traces 226-FR-003
for (const width of [320, 834]) {
  test(`keeps the NOTĂ caption right under the dial's value at ${width} px @seeded`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 1000, width });
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();
    await expect(dialArea(page).locator('.gauge .name')).not.toBeEmpty();

    const value = await dialValue(page).evaluate(
      (v) => v.getBoundingClientRect().bottom,
    );
    const caption = await dialArea(page)
      .locator('.gauge .reading')
      .evaluate((r) => r.getBoundingClientRect().top);
    expect(caption - value).toBeGreaterThanOrEqual(0);
    expect(caption - value).toBeLessThanOrEqual(40);
  });
}

// @traces 227-FR-001
// @traces 227-FR-002
// @traces 227-FR-003
// @traces 227-FR-004
// @traces 227-FR-005
const cards = (page: Page) => page.locator('mf-home-cards a.card');
const cardsLink = (page: Page) =>
  page
    .locator('mf-home-cards')
    .getByRole('link', { name: 'Vezi toate pe hartă' });

test.describe('the garage cards near Bucharest @seeded', () => {
  test.use({
    geolocation: { latitude: 44.4268, longitude: 26.1025 },
    permissions: ['geolocation'],
  });

  test('shows the preview garages as cards, from the one read, and opens them', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await useLocation(page);
    const reads = homeReads(page);
    await pickDacia(page);

    await expect(
      page.getByRole('heading', { name: 'Cine primește Dacia' }),
    ).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).locator('.name')).toHaveText(
      await previewRows(page).locator('.name').allTextContents(),
    );
    await expect(cards(page).locator('mf-lamp')).toHaveText([
      'Lucrează pe Dacia',
      'Lucrează pe Dacia',
      'Nu primește Dacia',
    ]);
    expect(reads).toEqual(['dacia']);

    const militari = cards(page).first();
    await expect(militari.locator('.where')).toHaveText(
      /București · \d+(,\d)? km/,
    );
    await expect(militari.locator('.list').first()).toContainText('+2');
    await expect(cards(page).nth(1).locator('.list').nth(1)).toHaveText(
      /Nu primește\s*—/,
    );

    await militari.click();
    await expect(page).toHaveURL(
      '/ro/garages/service-auto-militari?brand=dacia',
    );
    await page.goBack();
    await cardsLink(page).click();
    await expect(page).toHaveURL('/ro/garages?brand=dacia');
  });

  test('keeps the heading and the link when nobody near takes the brand', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await useLocation(page);

    await chooseTesla(page);

    await expect(
      page.getByRole('heading', { name: 'Cine primește Tesla' }),
    ).toBeVisible();
    await expect(cardsLink(page)).toHaveAttribute(
      'href',
      '/ro/garages?brand=tesla',
    );
    await expect(cards(page)).toHaveCount(3);
    for (const lamp of await cards(page).locator('mf-lamp').all()) {
      await expect(lamp).toHaveText('Nu primește Tesla');
    }
  });
});

test.describe('the garage cards in Cluj-Napoca @seeded', () => {
  test.use({
    geolocation: { latitude: 46.7712, longitude: 23.6236 },
    permissions: ['geolocation'],
  });

  test('shows the mobile mechanic by its area, never an address', async ({
    page,
  }) => {
    await ready(page, '/ro');
    await tile(page, 'Dacia').click();
    await useLocation(page);

    const mobile = cards(page).filter({ hasText: 'Mecanic Mobil Cluj' });
    await expect(mobile.locator('.where')).toHaveText(
      'Mecanic mobil · vine la tine · zonă de 20 km',
    );
  });
});

// @traces 227-FR-008
for (const scheme of ['light', 'dark'] as const) {
  for (const path of ['/ro', '/en']) {
    test(`fits the garage cards on a 320 px phone on ${path}, ${scheme} @seeded`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ height: 640, width: 320 });
      await ready(page, path);
      await pickDacia(page);
      await expect(cards(page)).toHaveCount(3);

      const boxes = await cards(page).evaluateAll((all) =>
        all.map((card) => {
          const box = card.getBoundingClientRect();
          return { height: box.height, left: Math.round(box.left) };
        }),
      );
      expect(new Set(boxes.map((box) => box.left)).size).toBe(1);
      for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
      const sizes = await page
        .locator('mf-home-cards')
        .locator('h2, a, span, mf-lamp')
        .evaluateAll((parts) =>
          parts
            .filter((part) => part.textContent?.trim())
            .map((part) => Number.parseFloat(getComputedStyle(part).fontSize)),
        );
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320);
    });
  }
}

// @traces 227-FR-003
// @traces 227-FR-008
for (const path of ['/ro', '/en']) {
  test(`sets the garage cards' text and dial value at 16 px on a 390 px phone on ${path} @seeded`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await ready(page, path);
    await pickDacia(page);
    await expect(cards(page)).toHaveCount(3);

    const sizes = await cards(page)
      .locator('.mf-dial-value, .name, .where, .list, .facts, mf-lamp')
      .evaluateAll((parts) =>
        parts.map((p) => Number.parseFloat(getComputedStyle(p).fontSize)),
      );
    expect(sizes.length).toBeGreaterThan(3);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
    for (const dial of await cards(page).locator('mf-rating-dial').all()) {
      const outer = await dial.boundingBox();
      const value = await dial.locator('.mf-dial-value').evaluate((v) => {
        const range = document.createRange();
        range.selectNodeContents(v);
        return range.getBoundingClientRect().width;
      });
      expect(value).toBeLessThan(outer?.width ?? 0);
    }
  });
}

// @traces 227-FR-003
for (const width of [390, 1280]) {
  test(`sets each card's dial beside its name, the status under both, at ${width} px @seeded`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width });
    await ready(page, '/ro');
    await pickDacia(page);
    await expect(cards(page)).toHaveCount(3);

    for (const card of await cards(page).all()) {
      const dial = await card.locator('mf-rating-dial').boundingBox();
      const name = await card.locator('.name').boundingBox();
      const lamp = await card.locator('mf-lamp').boundingBox();
      if (!dial || !name || !lamp) throw new Error('card parts missing');
      // Beside: the name starts right of the dial, within the dial's height.
      expect(name.x).toBeGreaterThanOrEqual(dial.x + dial.width - 1);
      expect(name.y).toBeGreaterThanOrEqual(dial.y - 1);
      expect(name.y).toBeLessThan(dial.y + dial.height);
      // Under both: the status starts below the dial, at the card's left edge.
      expect(lamp.y).toBeGreaterThanOrEqual(dial.y + dial.height - 1);
      expect(Math.abs(lamp.x - dial.x)).toBeLessThanOrEqual(1);
    }
  });
}

// @traces 227-FR-010
for (const path of ['/ro', '/en']) {
  test(`never leaves a word alone on the last line of a preview row's status at 320 px on ${path} @seeded`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await ready(page, path);
    await pickDacia(page);

    const lines = await previewRows(page)
      .locator('mf-lamp')
      .evaluateAll((lamps) =>
        lamps.map((lamp) => {
          const text = [...lamp.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          );
          if (!text?.textContent) return [];
          const rows = new Map<number, string[]>();
          for (const match of text.textContent.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(text, match.index ?? 0);
            range.setEnd(text, (match.index ?? 0) + match[0].length);
            const top = Math.round(range.getBoundingClientRect().top);
            rows.set(top, [...(rows.get(top) ?? []), match[0]]);
          }
          return [...rows.values()];
        }),
      );
    expect(lines.length).toBe(3);
    for (const rows of lines) {
      if (rows.length > 1) expect(rows.at(-1)?.length).toBeGreaterThan(1);
    }
  });
}

// @traces 227-FR-010
test('sets the preview as one panel of 64 px rows, the rating over the rate on the right @seeded', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await ready(page, '/ro');
  await pickDacia(page);

  for (const row of await previewRows(page).all()) {
    const box = await row.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(64);
    const rating = await row.locator('.rating').boundingBox();
    const rate = await row.locator('.rate').boundingBox();
    const name = await row.locator('.name').boundingBox();
    if (!rating || !rate || !name || !box) throw new Error('row parts missing');
    expect(rating.y + rating.height).toBeLessThanOrEqual(rate.y + 1);
    expect(rating.x).toBeGreaterThan(name.x + name.width - 1);
  }
  const panel = page.locator('mf-home-preview ul');
  const radius = () =>
    panel.evaluate((list) => getComputedStyle(list).borderTopLeftRadius);
  expect(await radius()).toBe('20px');
  // The radius is the theme's panel token, not a number of its own.
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--mf-radius-panel', '7px'),
  );
  expect(await radius()).toBe('7px');
});
