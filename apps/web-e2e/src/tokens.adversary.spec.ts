import { expect } from '@playwright/test';

import { test } from './fixtures.js';
import { rgb, token } from './tokens.js';

const NAMES = [
  '--mf-bg',
  '--mf-text',
  '--mf-panel',
  '--mf-panel-raised',
  '--mf-line',
  '--mf-amber',
];

test.describe('token and rgb helpers', () => {
  test('rgb reads upper and lower case the same', () => {
    expect(rgb('#AbCdEf')).toBe('rgb(171, 205, 239)');
    expect(rgb('#abcdef')).toBe(rgb('#ABCDEF'));
  });

  test('rgb handles the channel extremes', () => {
    expect(rgb('#000000')).toBe('rgb(0, 0, 0)');
    expect(rgb('#ffffff')).toBe('rgb(255, 255, 255)');
    expect(rgb('#0a0b0c')).toBe('rgb(10, 11, 12)');
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`token matches the painted colour of its own swatch in ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/cockpit');
      for (const name of NAMES) {
        const value = await token(page, name);
        expect(value, name).toBe(value.trim());
        expect(value, name).toMatch(/^#[0-9a-fA-F]{6}$/);
        const painted = await page.evaluate((n) => {
          const el = document.createElement('div');
          el.style.backgroundColor = `var(${n})`;
          document.body.append(el);
          const c = getComputedStyle(el).backgroundColor;
          el.remove();
          return c;
        }, name);
        expect(painted, name).toBe(rgb(value));
      }
    });
  }

  test('token follows a scheme switch', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/cockpit');
    const dark = await token(page, '--mf-bg');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => token(page, '--mf-bg')).not.toBe(dark);
  });

  test('token of an undefined property is an empty string', async ({
    page,
  }) => {
    await page.goto('/cockpit');
    expect(await token(page, '--mf-no-such-token')).toBe('');
  });

  test('token trims whitespace around a custom value', async ({ page }) => {
    await page.goto('/cockpit');
    await page.evaluate(() =>
      document.documentElement.style.setProperty('--mf-adv', '   #123456  \n'),
    );
    expect(await token(page, '--mf-adv')).toBe('#123456');
  });
});
