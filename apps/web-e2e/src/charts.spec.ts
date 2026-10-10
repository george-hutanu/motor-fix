import { expect, type Locator, type Page } from '@playwright/test';

import { test } from './fixtures.js';

const bar = 'mf-bar-chart canvas';
const line = 'mf-line-chart canvas';

async function open(
  page: Page,
  colorScheme: 'dark' | 'light',
  width: number,
  reducedMotion: 'reduce' | 'no-preference' = 'reduce',
  paused = false,
) {
  await page.setViewportSize({ height: 900, width });
  await page.emulateMedia({ colorScheme, reducedMotion });
  await page.goto('/cockpit');
  await expect(page.locator(bar).first()).toBeVisible();
  await expect(page.locator(line).first()).toBeVisible();
  for (const canvas of [bar, line])
    await drawn(page, page.locator(canvas).first(), paused);
}

// Chart.js grows a chart in over 1000 ms of the page's clock (chart-config.ts).
// The tests that watch the growth pause that clock before the page's first
// script, so time moves only when the test moves it: each reading lands at a
// known point of the growth, however slow the machine.
const GROWTH = 1000;
const FRAME = 16;

async function pauseClock(page: Page) {
  const start = new Date('2027-01-01T08:00:00');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
}

// The server sends the canvas undrawn; Chart.js sets its size on the first
// draw. A paused clock holds the page's own timers too, Angular's rendering
// among them, so it moves one frame at a time until that draw: a chart is
// read within a frame or two of its start.
async function drawn(page: Page, canvas: Locator, paused: boolean) {
  if (!paused) return expect(canvas).toHaveAttribute('width', /\d/);
  await expect
    .poll(async () => {
      await page.clock.runFor(FRAME);
      return (await canvas.getAttribute('width')) ?? '';
    })
    .toMatch(/\d/);
}

// The page hears a reduced-motion switch at its next rendering, not when
// emulateMedia returns: wait for the change event, then move the paused clock
// a frame so Angular renders it.
async function switchMotion(
  page: Page,
  reducedMotion: 'reduce' | 'no-preference',
) {
  const change = await page.evaluateHandle(() => ({
    heard: new Promise<void>((done) =>
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
        'change',
        () => done(),
        { once: true },
      ),
    ),
  }));
  await page.emulateMedia({ reducedMotion });
  await change.evaluate((c) => c.heard);
  await page.clock.runFor(FRAME);
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
  await pauseClock(page);
  await open(page, 'dark', 1280, 'no-preference', true);
  const early = await shot(page);

  await page.clock.runFor(GROWTH);

  expect(await shot(page)).not.toEqual(early);
});

test('follows reduced motion switched while the charts are on screen', async ({
  page,
}) => {
  // The canvas pixels, not a screenshot: the panel's own rise must not hold
  // the reading up while the bars grow.
  const pixels = (chart: Locator) =>
    chart.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await pauseClock(page);
  await open(page, 'dark', 1280, 'reduce', true);
  const failed = page.locator('mf-bar-chart').nth(2);

  await switchMotion(page, 'no-preference');
  await failed.getByRole('button', { name: 'Reîncearcă' }).click();
  await drawn(page, failed.locator('canvas'), true);
  await page.clock.runFor(GROWTH / 2);
  const growing = await pixels(failed);

  await switchMotion(page, 'reduce');
  const still = await pixels(failed);
  await page.clock.runFor(GROWTH);

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
