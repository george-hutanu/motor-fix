import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import { settled } from './accounts.js';
import { test } from './fixtures.js';

// The page opens in Romanian, the default language.
const SAMPLE_TEXT: Record<
  'openDialog' | 'openDrawer' | 'openPopover' | 'showToast',
  string
> = JSON.parse(
  readFileSync(
    new URL('../../../libs/i18n/src/cockpit/ro.json', import.meta.url),
    'utf8',
  ),
);

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
  await expect(page.locator('input.spartan-input')).toHaveCSS(
    'font-size',
    '16px',
  );
}

const primaryButton = 'button.spartan-button-variant-default';

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
      // The button eases into its colour; read it once the transition ends.
      await expect
        .poll(() => style(page, primaryButton, 'background-color'))
        .toBe(rgb(t.amber));
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
      const tabStops = await page
        .locator(
          'main :is(button, input, [tabindex="0"]):not([tabindex="-1"]):visible',
        )
        .count();
      expect(tabStops).toBeGreaterThan(0);
      expect(seen.length).toBeGreaterThanOrEqual(tabStops);
    });

    test('opens the dialog, drawer, toast and popover on themed surfaces', async ({
      page,
    }) => {
      await open(page, scheme);
      const raised = rgb(themes[scheme].raised);

      for (const [name, surface] of [
        [SAMPLE_TEXT.openDialog, 'hlm-dialog-content'],
        [SAMPLE_TEXT.openDrawer, 'hlm-sheet-content'],
        [SAMPLE_TEXT.openPopover, 'hlm-popover-content'],
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
      await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
      expect(await style(page, '[data-sonner-toast]', 'background-color')).toBe(
        raised,
      );
      expect(await style(page, '[data-sonner-toast]', 'border-top-color')).toBe(
        rgb(themes[scheme].line),
      );
    });
  });
}

test('changes theme with the device at once, keeping what was typed', async ({
  page,
}) => {
  await open(page, 'dark');
  // Typed before hydration, the value is wiped when the client takes over the server's input.
  await settled(page);
  const input = page.locator('input.spartan-input').first();
  await input.fill('Dacia Logan 2015');
  await expect(input).toHaveValue('Dacia Logan 2015');
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
  expect(await style(page, 'input.spartan-input', 'font-size')).toBe('16px');
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
    'button.spartan-button',
    'input.spartan-input',
    '[role="tab"]',
    'button[role="switch"]',
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

test('draws no control over the content around it', async ({ page }) => {
  await open(page, 'dark');

  for (const target of [
    page.locator(primaryButton),
    page.locator('td').first(),
    page.locator('label[for="open-now"]'),
  ]) {
    const covered = await target.evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return !(top && (el === top || el.contains(top)));
    });
    expect(covered).toBe(false);
  }
});

// The server sends the page with its texts in; the browser used to hydrate
// it before its own copy of them had loaded, so the keys showed until they
// had, and the layout shifted under the chart screenshots on staging.
test('never shows a text key while the page wakes up, however slow the scripts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { keysSeen: string[] }).keysSeen = seen;
    const check = (text: string | null) => {
      const key = text?.match(/\bcockpit\.[A-Za-z]+/)?.[0];
      if (key) seen.push(key);
    };
    // A record's target holds what changed: the text itself, or the
    // element whose children did.
    new MutationObserver((records) => {
      for (const record of records) check(record.target.textContent);
    }).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
  await page.route('**/*.js', async (route) => {
    await new Promise((done) => setTimeout(done, 300));
    await route.continue();
  });
  await page.goto('/cockpit');
  await expect(
    page.getByRole('button', { exact: true, name: SAMPLE_TEXT.openDialog }),
  ).toBeVisible();
  await settled(page);

  expect(
    await page.evaluate(
      () => (window as unknown as { keysSeen: string[] }).keysSeen,
    ),
  ).toEqual([]);
});
