import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page, test } from '@playwright/test';

import { signInAs } from './sign-in.js';

// The page opens in Romanian, the default language.
const COCKPIT = JSON.parse(
  readFileSync(
    new URL('../../../libs/i18n/src/cockpit/ro.json', import.meta.url),
    'utf8',
  ),
);
const GAUGES = COCKPIT.gauges as Record<string, string>;
const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

type Running = {
  delay: number;
  duration: number;
  iterations: number;
  name: string;
  pseudo: string | null;
  target: string;
};

// Every animation and transition running on the page, named by what it moves.
const running = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().map((a): Running => {
      const effect = a.effect as KeyframeEffect;
      const timing = effect.getTiming();
      const target = effect.target as Element | null;
      return {
        delay: Number(timing.delay),
        duration: Number(timing.duration),
        iterations: Number(timing.iterations),
        name:
          (a as CSSAnimation).animationName ??
          (a as CSSTransition).transitionProperty,
        pseudo: effect.pseudoElement,
        target: target
          ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}`
          : '',
      };
    }),
  );

const named = (all: Running[], name: string) =>
  all.filter((a) => a.name === name);

async function openCockpit(page: Page) {
  await page.goto('/cockpit');
  await expect(
    page.locator('mf-cockpit-gauges-sample mf-lamp').first(),
  ).toBeVisible();
}

// Returns once the range has changed, so a click made before hydration and
// replayed after it is waited for.
async function swap(page: Page) {
  const range = page.locator('mf-odometer').nth(1);
  const before = await range.textContent();
  await page.getByRole('button', { exact: true, name: GAUGES['swap'] }).click();
  await expect(range).not.toHaveText(before ?? '');
}

const openDialog = (page: Page) =>
  page.getByRole('button', { exact: true, name: COCKPIT.openDialog }).click();

// Slows every animation tenfold, so a build-up is still running when the
// test acts on it.
async function slowMotion(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Home, a dashboard and the catalogue have nothing moving', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('mf-home h1')).toBeVisible();
    expect(await running(page)).toEqual([]);

    await signInAs(page, 'driver', '/app/driver');
    await page.goto('/app/driver');
    await expect(page.getByRole('navigation', { name: 'Meniu' })).toBeVisible();
    expect(await running(page)).toEqual([]);

    await openCockpit(page);
    expect(await running(page)).toEqual([]);
    await expect(page.locator('[data-motion]')).toHaveText(
      GAUGES['motionReduced'],
    );
  });

  test('a value change and an opened dialog land at once, still', async ({
    page,
  }) => {
    await openCockpit(page);
    const needle = page.locator('mf-rating-dial .mf-dial-needle').first();
    const before = await needle.evaluate((n) => getComputedStyle(n).transform);

    await swap(page);
    expect(await running(page)).toEqual([]);
    expect(
      await needle.evaluate((n) => getComputedStyle(n).transform),
    ).not.toBe(before);
    await expect(page.locator('mf-odometer').nth(1)).toContainText('1.400');

    await openDialog(page);
    const dialog = page.locator('hlm-dialog-content');
    await expect(dialog).toBeVisible();
    expect(await running(page)).toEqual([]);
    expect(
      await dialog.evaluate((d) => {
        const style = getComputedStyle(d);
        return [style.opacity, style.transform];
      }),
    ).toEqual(['1', 'none']);
  });
});

test.describe('with full motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('panels build up one after another and finish within 1.5 seconds', async ({
    page,
  }) => {
    await slowMotion(page);
    await openCockpit(page);
    await expect(page.locator('[data-motion]')).toHaveText(
      GAUGES['motionFull'],
    );
    const rises = named(await running(page), 'mf-rise');
    expect(rises.length).toBeGreaterThanOrEqual(2);
    for (const rise of rises) {
      expect(rise.target).toBe('section.mf-panel');
      expect(rise.duration).toBe(700);
      expect(rise.delay + rise.duration).toBeLessThanOrEqual(1500);
    }
    // The table panel and the gauges panel sit side by side in the page.
    const [table, gauges] = await page
      .locator('main > mf-panel > section.mf-panel')
      .evaluateAll((sections) =>
        sections.map((s) =>
          Number(s.getAnimations()[0]?.effect?.getTiming().delay),
        ),
      );
    // Only panels count: the first starts at once, the next 60 ms later.
    expect([table, gauges]).toEqual([0, 60]);
  });

  test('a control works while the screen builds up, and a change does not replay it', async ({
    page,
  }) => {
    await slowMotion(page);
    await openCockpit(page);
    expect(named(await running(page), 'mf-rise').length).toBeGreaterThan(0);

    await swap(page);
    await expect(page.locator('mf-odometer').nth(1)).toContainText('1.400');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await expect
      .poll(async () => named(await running(page), 'mf-rise').length)
      .toBe(0);
    await swap(page);
    expect(named(await running(page), 'mf-rise')).toEqual([]);
  });

  test('the dial swings, the lamp pulses and the badge blinks', async ({
    page,
  }) => {
    await openCockpit(page);
    const idle = await running(page);
    const pulse = named(idle, 'mf-pulse');
    expect(pulse).toHaveLength(1);
    expect(pulse[0]).toMatchObject({
      duration: 1600,
      iterations: Number.POSITIVE_INFINITY,
      target: 'span.mf-lamp-dot',
    });
    expect(named(idle, 'mf-blink')).toMatchObject([
      { duration: 1000, iterations: Number.POSITIVE_INFINITY },
    ]);

    await swap(page);
    const moving = await running(page);
    // The large and the small dial change; only the large one has a needle.
    const swing = { duration: 1100 };
    expect(
      named(moving, 'stroke-dasharray').filter(
        (m) => m.target === 'circle.mf-dial-arc',
      ),
    ).toMatchObject([swing, swing]);
    expect(
      named(moving, 'transform').filter(
        (m) => m.target === 'line.mf-dial-needle',
      ),
    ).toMatchObject([swing]);
  });

  test('the odometer digits roll to a new price', async ({ page }) => {
    await openCockpit(page);
    await swap(page);
    const rolls = named(await running(page), 'translate');

    // 1.250–1.600 → 1.400–1.800: three of the eight digits change.
    expect(rolls).toHaveLength(3);
    for (const roll of rolls) {
      expect(roll).toMatchObject({
        duration: 900,
        pseudo: '::before',
        target: 'span.mf-odometer-digit',
      });
    }
    await expect
      .poll(async () => named(await running(page), 'translate').length)
      .toBe(0);
    // At rest each column shows the cell's own digit in the cell's window.
    const shown = await page
      .locator('mf-odometer')
      .nth(1)
      .locator('.mf-odometer-digit')
      .evaluateAll((cells) =>
        cells.map((cell) => {
          const offset = Number.parseFloat(
            getComputedStyle(cell, '::before').translate.split(' ')[1] ?? '0',
          );
          const line = Number.parseFloat(
            getComputedStyle(cell, '::before').lineHeight,
          );
          return String(Math.round(-offset / line));
        }),
      );
    expect(shown).toEqual(['1', '4', '0', '0', '1', '8', '0', '0']);
  });

  test('a dialog pops in, and switching to reduced motion stops everything at once', async ({
    page,
  }) => {
    await openCockpit(page);
    await openDialog(page);
    expect(named(await running(page), 'mf-pop')).toMatchObject([
      { duration: 420, target: 'hlm-dialog-content.spartan-dialog-content' },
    ]);
    await page.keyboard.press('Escape');

    await slowMotion(page);
    await page.reload();
    await expect(
      page.locator('mf-cockpit-gauges-sample mf-lamp').first(),
    ).toBeVisible();
    expect(named(await running(page), 'mf-rise').length).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await running(page)).toEqual([]);
    expect(
      await page
        .locator('section.mf-panel')
        .first()
        .evaluate((s) => getComputedStyle(s).opacity),
    ).toBe('1');
    await expect(page.locator('[data-motion]')).toHaveText(
      GAUGES['motionReduced'],
    );
  });
});

test('the live label keeps its contrast through the whole blink', async ({
  page,
}) => {
  await openCockpit(page);
  // A panel still fading in would lower every contrast inside it.
  await expect
    .poll(async () => named(await running(page), 'mf-rise').length)
    .toBe(0);
  await page.evaluate(AXE);
  const violations: string[] = [];
  // Five looks across one blink period catch both halves of it.
  for (let look = 0; look < 5; look++) {
    const found = await page.evaluate(async () => {
      const axe = (globalThis as unknown as { axe: { run: Function } }).axe;
      const result = await axe.run(
        { include: [['.mf-live']] },
        { runOnly: ['color-contrast'] },
      );
      return result.violations.map((v: { id: string }) => v.id);
    });
    violations.push(...found);
    await page.waitForTimeout(220);
  }

  expect(violations).toEqual([]);
});
