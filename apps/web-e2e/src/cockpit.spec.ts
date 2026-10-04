import { expect, type Page, test } from '@playwright/test';

import { SAMPLE_TEXT } from '../../../libs/ui-cockpit/src/lib/sample-text.js';

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};

const themes = {
  dark: {
    amber: '#FFB000',
    bg: '#0B0C0E',
    line: '#2A2D31',
    panel: '#101215',
    raised: '#15171A',
    text: '#F2F2F0',
  },
  light: {
    amber: '#FFB000',
    bg: '#F4F4F1',
    line: '#D3D5D8',
    panel: '#FFFFFF',
    raised: '#ECECE8',
    text: '#15171A',
  },
} as const;

const style = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

async function open(page: Page, colorScheme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme });
  await page.goto('/cockpit');
  await expect(page.locator('section.mf-panel').first()).toBeVisible();
  await expect(page.locator('input.p-inputtext')).toHaveCSS(
    'font-size',
    '16px',
  );
}

const primaryButton =
  'button.p-button:not(.p-button-secondary):not(.p-button-text):not(.p-button-outlined)';

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`the ${scheme} theme`, () => {
    test('paints the page, panels, hairlines, text and the main action from its tokens', async ({
      page,
    }) => {
      await open(page, scheme);
      const t = themes[scheme];

      expect(await style(page, 'body', 'background-color')).toBe(rgb(t.bg));
      expect(await style(page, 'body', 'color')).toBe(rgb(t.text));
      expect(await style(page, 'section.mf-panel', 'background-color')).toBe(
        rgb(t.panel),
      );
      expect(await style(page, 'section.mf-panel', 'border-top-color')).toBe(
        rgb(t.line),
      );
      expect(await style(page, primaryButton, 'background-color')).toBe(
        rgb(t.amber),
      );
      await expect(page.locator(primaryButton)).toHaveCount(1);
    });

    test('shows a visible focus ring on every element reached with Tab', async ({
      page,
    }) => {
      await open(page, scheme);
      const seen: string[] = [];

      for (let step = 0; step < 40; step++) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el.dataset['tabbed']) return null;
          el.dataset['tabbed'] = 'yes';
          const marked = [el, el.nextElementSibling, el.parentElement].some(
            (c) => {
              if (!c) return false;
              const s = getComputedStyle(c);
              const outline =
                s.outlineStyle !== 'none' &&
                Number.parseFloat(s.outlineWidth) > 0;
              return outline || (s.boxShadow !== 'none' && s.boxShadow !== '');
            },
          );
          return { key: el.outerHTML.slice(0, 160), marked };
        });
        if (!ring) break;
        seen.push(ring.key);
        expect(ring, ring.key).toMatchObject({ marked: true });
      }
      expect(seen.length).toBeGreaterThanOrEqual(9);
    });

    test('opens the dialog, drawer, toast and popover on themed surfaces', async ({
      page,
    }) => {
      await open(page, scheme);
      const raised = rgb(themes[scheme].raised);

      for (const [name, surface] of [
        [SAMPLE_TEXT.openDialog, '.p-dialog'],
        [SAMPLE_TEXT.openDrawer, '.p-drawer'],
        [SAMPLE_TEXT.openPopover, '.p-popover'],
      ] as const) {
        await page.getByRole('button', { exact: true, name }).click();
        await expect(page.locator(surface)).toBeVisible();
        expect(await style(page, surface, 'background-color')).toBe(raised);
        await page.keyboard.press('Escape');
        await expect(page.locator(surface)).toBeHidden();
      }

      await page
        .getByRole('button', { exact: true, name: SAMPLE_TEXT.showToast })
        .click();
      await expect(page.locator('.p-toast-message').first()).toBeVisible();
      expect(await style(page, '.p-toast-message', 'border-top-color')).toBe(
        rgb(themes[scheme].line),
      );
    });
  });
}

test('changes theme with the device at once, keeping what was typed', async ({
  page,
}) => {
  await open(page, 'dark');
  const input = page.locator('input.p-inputtext').first();
  await input.fill('Dacia Logan 2015');
  const url = page.url();

  await page.emulateMedia({ colorScheme: 'light' });

  await expect(input).toHaveValue('Dacia Logan 2015');
  expect(page.url()).toBe(url);
  expect(await style(page, 'body', 'background-color')).toBe(
    rgb(themes.light.bg),
  );
});

test('shows no text under 12 px on a phone, and 16 px in form fields', async ({
  page,
}) => {
  await page.setViewportSize({ height: 812, width: 375 });
  await open(page, 'dark');

  const tooSmall = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const hits: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !node.textContent?.trim() || el.getClientRects().length === 0)
        continue;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) hits.push(`${size}px: ${node.textContent.trim()}`);
    }
    return hits;
  });

  expect(tooSmall).toEqual([]);
  expect(await style(page, 'input.p-inputtext', 'font-size')).toBe('16px');
});

test('sets labels in Michroma capitals and reading text in Hanken Grotesk', async ({
  page,
}) => {
  await open(page, 'dark');

  expect(await style(page, '.mf-label', 'font-family')).toMatch(/^Michroma/);
  expect(await style(page, '.mf-label', 'text-transform')).toBe('uppercase');
  expect(await style(page, 'body', 'font-family')).toMatch(
    /^"Hanken Grotesk Variable"/,
  );
});

test('makes every button, input, tab and toggle at least 44 px tall', async ({
  page,
}) => {
  await open(page, 'dark');

  for (const selector of [
    'button.p-button',
    'input.p-inputtext',
    '[role="tab"]',
    '.p-toggleswitch-input',
  ]) {
    const boxes = await page
      .locator(selector)
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(boxes.length, selector).toBeGreaterThan(0);
    for (const height of boxes)
      expect(height, selector).toBeGreaterThanOrEqual(44);
  }
});

test('draws a panel as a 20 px rounded card that keeps its border with forced colours', async ({
  page,
}) => {
  await open(page, 'dark');
  expect(await style(page, 'section.mf-panel', 'border-top-left-radius')).toBe(
    '20px',
  );

  await page.emulateMedia({ forcedColors: 'active' });

  expect(await style(page, 'section.mf-panel', 'border-top-style')).toBe(
    'solid',
  );
  expect(
    Number.parseFloat(
      await style(page, 'section.mf-panel', 'border-top-width'),
    ),
  ).toBeGreaterThanOrEqual(1);
});
