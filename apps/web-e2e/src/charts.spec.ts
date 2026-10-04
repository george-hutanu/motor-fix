import { expect, type Locator, type Page, test } from '@playwright/test';

const bar = 'mf-bar-chart canvas';
const line = 'mf-line-chart canvas';

async function open(
  page: Page,
  colorScheme: 'dark' | 'light',
  width: number,
  reducedMotion: 'reduce' | 'no-preference' = 'reduce',
) {
  await page.setViewportSize({ height: 900, width });
  await page.emulateMedia({ colorScheme, reducedMotion });
  await page.goto('/cockpit');
  await expect(page.locator(bar).first()).toBeVisible();
  await expect(page.locator(line).first()).toBeVisible();
  // The server sends the canvas undrawn; Chart.js sets its size on the first draw.
  for (const canvas of [bar, line])
    await expect(page.locator(canvas).first()).toHaveAttribute('width', /\d/);
}

const shot = (page: Page) => page.locator(bar).first().screenshot();

for (const scheme of ['dark', 'light'] as const) {
  for (const width of [320, 1280]) {
    test(`fits the charts at ${width} px in the ${scheme} theme, with no text under 12 px`, async ({
      page,
    }) => {
      await open(page, scheme, width);

      // Other sample sections are wider than a phone on their own, so the
      // charts are measured with the page around them taken away.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll<HTMLElement>(
          'main > :not(mf-cockpit-charts-sample)',
        ))
          el.style.display = 'none';
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        )
        .toBeLessThanOrEqual(0);

      const overflowing = await page.evaluate(() =>
        [...document.querySelectorAll('mf-bar-chart, mf-line-chart')]
          .flatMap((chart) => [chart, ...chart.querySelectorAll('*')])
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.tagName),
      );
      expect(overflowing).toEqual([]);

      const small = await page.evaluate(() =>
        [...document.querySelectorAll('mf-bar-chart, mf-line-chart')]
          .flatMap((chart) => [...chart.querySelectorAll('*')])
          .filter(
            (el) =>
              el.childNodes.length > 0 &&
              [...el.childNodes].some(
                (n) => n.nodeType === 3 && n.textContent?.trim(),
              ) &&
              Number.parseFloat(getComputedStyle(el).fontSize) < 12,
          )
          .map((el) => el.textContent?.trim()),
      );
      expect(small).toEqual([]);

      for (const canvas of await page.locator(`${bar}, ${line}`).all()) {
        const box = await canvas.boundingBox();
        expect(box?.width).toBeGreaterThan(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
    });
  }
}

test('redraws in the light tokens and back when the device switches theme', async ({
  page,
}) => {
  await open(page, 'dark', 1280);
  const darkShot = await shot(page);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => shot(page)).not.toEqual(darkShot);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => shot(page)).toEqual(darkShot);
});

test('draws the charts complete at once with reduced motion', async ({
  page,
}) => {
  await open(page, 'dark', 1280, 'reduce');
  const first = await shot(page);

  await page.waitForTimeout(1500);

  expect(await shot(page)).toEqual(first);
});

test('grows the bars in without reduced motion', async ({ page }) => {
  // The panels' own rise would make the screenshot wait for the panel to
  // settle, by which time the bars have grown; this test is about the bars.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const still = document.createElement('style');
      still.textContent = 'section.mf-panel { animation: none !important; }';
      document.head.append(still);
    });
  });
  await open(page, 'dark', 1280, 'no-preference');
  const early = await shot(page);

  await page.waitForTimeout(1500);

  expect(await shot(page)).not.toEqual(early);
});

test('follows reduced motion switched while the charts are on screen', async ({
  page,
}) => {
  // The canvas pixels, not a screenshot: the panel's own rise must not hold
  // the reading up while the bars grow.
  const pixels = (chart: Locator) =>
    chart.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const nextFrame = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
  await open(page, 'dark', 1280, 'reduce');
  const failed = page.locator('mf-bar-chart').nth(2);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await failed.getByRole('button', { name: 'Reîncearcă' }).click();
  await expect(failed.locator('canvas')).toHaveAttribute('width', /\d/);
  const growing = await pixels(failed);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nextFrame();
  const still = await pixels(failed);
  await page.waitForTimeout(1200);

  expect(await pixels(failed)).toEqual(still);
  expect(still).not.toEqual(growing);
});

test('renders the chart panels and their summaries on the server', async ({
  request,
}) => {
  const html = await (await request.get('/cockpit')).text();

  expect(html).toMatch(/<mf-bar-chart[^>]*>/);
  expect(html).toMatch(/<canvas[^>]*role="img"[^>]*aria-label="[^"]+lei/);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true });

  test('shows the tooltip when a bar is tapped, and hides it on a tap elsewhere', async ({
    page,
  }) => {
    await open(page, 'dark', 375);
    const canvas = page.locator(bar).first();
    await canvas.scrollIntoViewIfNeeded();
    const before = await shot(page);

    await canvas.tap();
    await expect.poll(() => shot(page)).not.toEqual(before);

    await page.locator('h1').tap();
    await expect.poll(() => shot(page)).toEqual(before);
  });
});
