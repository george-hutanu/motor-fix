import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BREAKPOINTS } from '../lib/layout';

const css = readFileSync(join(__dirname, 'cockpit.css'), 'utf8');

function blockAfter(source: string, opener: RegExp): string {
  const match = opener.exec(source);
  if (!match) throw new Error(`no block for ${opener}`);
  let depth = 0;
  const start = source.indexOf('{', match.index);
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start + 1, i);
  }
  throw new Error(`unclosed block for ${opener}`);
}

function tokens(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of block.matchAll(
    /(--mf-[\w-]+)\s*:\s*([^;]+);/g,
  )) {
    found.set(name, value.trim().replace(/"/g, "'"));
  }
  return found;
}

const topLevel = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const dark = tokens(blockAfter(topLevel, /:root\s*\{/));
const light = tokens(
  blockAfter(
    blockAfter(css, /@media\s*\(prefers-color-scheme:\s*light\)[^{]*/),
    /:root/,
  ),
);
const print = tokens(
  blockAfter(blockAfter(css, /@media[^{]*\bprint\b[^{]*/), /:root/),
);

const colourNames = [
  '--mf-bg',
  '--mf-panel',
  '--mf-panel-raised',
  '--mf-line',
  '--mf-line-strong',
  '--mf-text',
  '--mf-text-secondary',
  '--mf-amber',
  '--mf-amber-hover',
  '--mf-on-amber',
  '--mf-amber-ink',
  '--mf-amber-tint',
  '--mf-green',
  '--mf-red',
  '--mf-focus',
  '--mf-mask',
];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function px(value: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
  if (!match) throw new Error(`not a px value: ${value}`);
  return Number(match[1]);
}

describe('cockpit.css tokens', () => {
  it('sets the dark values on the root', () => {
    expect(Object.fromEntries(dark)).toMatchObject({
      '--mf-amber': '#ffb000',
      '--mf-bg': '#0b0c0e',
      '--mf-green': '#32d74b',
      '--mf-line': '#2a2d31',
      '--mf-panel': '#101215',
      '--mf-panel-raised': '#15171a',
      '--mf-red': '#ff5a4f',
      '--mf-text': '#f2f2f0',
      '--mf-text-secondary': '#b5b8be',
    });
  });

  it('sets the light values when the device prefers light', () => {
    expect(Object.fromEntries(light)).toMatchObject({
      '--mf-amber': '#ffb000',
      '--mf-amber-ink': '#8a5e00',
      '--mf-bg': '#f4f4f1',
      '--mf-green': '#1e8e34',
      '--mf-line': '#d3d5d8',
      '--mf-on-amber': '#15171a',
      '--mf-panel': '#ffffff',
      '--mf-panel-raised': '#ecece8',
      '--mf-red': '#d93a30',
      '--mf-text': '#15171a',
      '--mf-text-secondary': '#50545b',
    });
  });

  it('prints with the light values', () => {
    expect(print).toEqual(light);
  });

  it('defines every colour token in both themes', () => {
    for (const name of colourNames) {
      expect(dark.has(name)).toBe(true);
      expect(light.has(name)).toBe(true);
    }
    expect([...light.keys()].sort()).toEqual([...colourNames].sort());
  });

  it('names every token --mf-*', () => {
    const declared = [...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, n]) => n);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((n) => !n.startsWith('--mf-'))).toEqual([]);
  });

  it('switches theme only through media queries', () => {
    expect(css).not.toMatch(/\[data-theme|\.theme-|\.dark\b|\.light\b/);
  });

  it('defines type, spacing, radius, focus and target tokens', () => {
    expect(dark.get('--mf-font-label')).toMatch(/^'Michroma'/);
    expect(dark.get('--mf-font-body')).toMatch(/^'Hanken Grotesk Variable'/);
    expect(dark.get('--mf-label-tracking')).toBe('0.14em');
    expect(dark.get('--mf-radius-panel')).toBe('20px');
    expect(dark.get('--mf-radius-control')).toBe('12px');
    expect(dark.get('--mf-radius-chip')).toBe('10px');
    expect(dark.get('--mf-focus-width')).toBe('3px');
    expect(dark.get('--mf-focus-offset')).toBe('3px');
    expect(dark.get('--mf-tap')).toBe('44px');
    const spaces = [...dark].filter(([n]) => n.startsWith('--mf-space-'));
    expect(spaces.length).toBeGreaterThanOrEqual(6);
    for (const [, value] of spaces) expect(px(value) % 4).toBe(0);
  });

  it('keeps every text size at 12 px or more, body at 13, fields at 16', () => {
    const sizes = [...dark].filter(([n]) => n.startsWith('--mf-size-'));
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    for (const [, value] of sizes) expect(px(value)).toBeGreaterThanOrEqual(12);
    expect(px(dark.get('--mf-size-label'))).toBe(12);
    expect(px(dark.get('--mf-size-body'))).toBeGreaterThanOrEqual(13);
    expect(px(dark.get('--mf-size-field'))).toBe(16);
  });
});

describe('cockpit.css contrast', () => {
  const surfaces = ['--mf-bg', '--mf-panel', '--mf-panel-raised'];

  for (const [theme, set] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    it(`keeps text at 4.5:1 on every surface in the ${theme} theme`, () => {
      for (const text of [
        '--mf-text',
        '--mf-text-secondary',
        '--mf-amber-ink',
      ]) {
        for (const surface of surfaces) {
          expect(
            contrast(set.get(text)!, set.get(surface)!),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(set.get('--mf-on-amber')!, set.get('--mf-amber')!),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps status colours and the focus ring at 3:1 in the ${theme} theme`, () => {
      for (const mark of ['--mf-green', '--mf-red', '--mf-focus']) {
        for (const surface of surfaces) {
          expect(
            contrast(set.get(mark)!, set.get(surface)!),
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }
});

describe('cockpit.css typefaces', () => {
  const faces = ['@fontsource/michroma', '@fontsource-variable/hanken-grotesk'];

  it('self-hosts both families with swap and a Latin Extended subset', () => {
    for (const pkg of faces) {
      expect(css).toContain(`@import "${pkg}/index.css";`);
      const face = readFileSync(
        join(__dirname, '../../../../node_modules', pkg, 'index.css'),
        'utf8',
      );
      expect(face).toContain('font-display: swap');
      const ranges = [...face.matchAll(/unicode-range:\s*([^;]+);/g)].map(
        ([, r]) => r,
      );
      for (const glyph of ['ă', 'â', 'î', 'ș', 'ț']) {
        const code = glyph.codePointAt(0)!;
        const covered = ranges.some((r) =>
          r.split(',').some((part) => {
            const [from, to = from] = part
              .trim()
              .replace(/U\+/g, '')
              .split('-');
            return (
              code >= Number.parseInt(from, 16) &&
              code <= Number.parseInt(to, 16)
            );
          }),
        );
        expect(covered).toBe(true);
      }
    }
  });

  it('falls back from Michroma to Hanken Grotesk, then the system sans-serif', () => {
    expect(dark.get('--mf-font-label')).toBe(
      "'Michroma', 'Hanken Grotesk Variable', system-ui, sans-serif",
    );
    expect(dark.get('--mf-font-body')).toBe(
      "'Hanken Grotesk Variable', system-ui, sans-serif",
    );
  });
});

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruleIn = (source: string, selector: string) =>
  blockAfter(
    source,
    new RegExp(`(^|[{},])\\s*${escapeRegExp(selector)}\\s*\\{`, 'm'),
  );
const rule = (selector: string) => ruleIn(css, selector);

const componentRules = [
  ...topLevel.matchAll(/(?<=^|\})\s*([^{}@]*\.spartan-[^{}]*)\{([^{}]*)\}/g),
].map(([, selector, body]) => ({ body, selector: selector.trim() }));

describe('cockpit.css component rules', () => {
  it('paints every component colour from the tokens', () => {
    const colours = componentRules.flatMap(({ body, selector }) =>
      [
        ...body.matchAll(
          /(?:^|;)\s*((?:background|border|outline)(?:-[\w-]+)?|color|fill|box-shadow)\s*:\s*([^;]+)/g,
        ),
      ].map(
        ([, property, value]) => `${selector} { ${property}: ${value.trim()} }`,
      ),
    );
    const literal =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(|\b(?:white|black)\b/i;

    expect(componentRules.length).toBeGreaterThan(15);
    expect(colours.filter((c) => literal.test(c))).toEqual([]);
  });

  it('fills the main action with amber and dark text', () => {
    const main = rule('.spartan-button-variant-default');
    expect(main).toMatch(/background(-color)?:\s*var\(--mf-amber\)/);
    expect(main).toMatch(/(^|;)\s*color:\s*var\(--mf-on-amber\)/);
  });

  it('keeps the secondary and ghost buttons out of amber', () => {
    for (const variant of ['secondary', 'ghost']) {
      const body = componentRules
        .filter(({ selector }) =>
          selector.includes(`spartan-button-variant-${variant}`),
        )
        .map(({ body }) => body)
        .join(';');
      expect(body).not.toBe('');
      expect(body).not.toContain('amber');
    }
    expect(rule('.spartan-button-variant-secondary')).toMatch(
      /border-color:\s*var\(--mf-line-strong\)/,
    );
  });

  it('marks the active tab and a selected row with amber ink on the amber tint', () => {
    for (const selector of [
      '.spartan-tabs-trigger[data-state="active"]',
      '.spartan-table-row[data-state="selected"]',
    ]) {
      const body = rule(selector);
      expect(body).toMatch(/background(-color)?:\s*var\(--mf-amber-tint\)/);
      expect(body).toMatch(/(^|;)\s*color:\s*var\(--mf-amber-ink\)/);
    }
    expect(rule('.spartan-tabs-trigger[data-state="active"]')).toMatch(
      /border-color:\s*var\(--mf-amber-ink\)/,
    );
  });

  it('turns a switch that is on amber', () => {
    expect(rule('button.spartan-switch[data-state="checked"]::before')).toMatch(
      /background(-color)?:\s*var\(--mf-amber\)/,
    );
  });

  it('sets field text at the field size on the page background', () => {
    const input = rule('.spartan-input');
    expect(input).toMatch(/font-size:\s*var\(--mf-size-field\)/);
    expect(input).toMatch(/background(-color)?:\s*var\(--mf-bg\)/);
    expect(input).toMatch(/border-radius:\s*var\(--mf-radius-control\)/);
  });

  it('puts dialogs, drawers, popovers and toasts on the raised surface with a hairline', () => {
    for (const selector of [
      '.spartan-dialog-content',
      '.spartan-sheet-content',
      '.spartan-popover-content',
    ]) {
      const body = componentRules
        .filter((r) =>
          r.selector
            .split(',')
            .map((s) => s.trim())
            .includes(selector),
        )
        .map((r) => r.body)
        .join(';');
      expect(body).toMatch(/background(-color)?:\s*var\(--mf-panel-raised\)/);
      expect(body).toMatch(/var\(--mf-line\)/);
    }
    const toast = componentRules
      .filter((r) => r.selector.includes('.spartan-toast'))
      .map((r) => r.body)
      .join(';');
    expect(toast).toMatch(/background(-color)?:\s*var\(--mf-panel-raised\)/);
    expect(toast).toMatch(/border-color:\s*var\(--mf-line\)/);
    expect(rule('.spartan-dialog-content')).toMatch(
      /border-radius:\s*var\(--mf-radius-panel\)/,
    );
  });

  it('dims the page behind dialogs and drawers with the mask token', () => {
    const body = componentRules
      .filter((r) => r.selector.includes('.spartan-dialog-overlay'))
      .map((r) => r.body)
      .join(';');
    expect(body).toMatch(/background(-color)?:\s*var\(--mf-mask\)/);
    expect(
      componentRules.some((r) => r.selector.includes('.spartan-sheet-overlay')),
    ).toBe(true);
  });

  it('keeps a focus ring on toasts, which turn the outline off themselves', () => {
    expect(rule('.spartan-toast:focus-visible')).toMatch(
      /outline:\s*var\(--mf-focus-width\) solid var\(--mf-focus\)/,
    );
  });
});

describe('cockpit.css rules', () => {
  it('draws the focus ring from the focus tokens', () => {
    const rule = blockAfter(css, /:focus-visible\s*\{/);
    expect(rule).toMatch(
      /outline:\s*var\(--mf-focus-width\) solid var\(--mf-focus\)/,
    );
    expect(rule).toMatch(/outline-offset:\s*var\(--mf-focus-offset\)/);
  });

  it('gives buttons, inputs, tabs and the switch the 44 px minimum', () => {
    for (const selector of [
      '.spartan-button',
      '.spartan-input',
      '.spartan-tabs-trigger',
      'button.spartan-switch',
    ]) {
      expect(rule(selector)).toMatch(/min-height:\s*var\(--mf-tap\)/);
    }
  });

  it('defines the capital label style', () => {
    const rule = blockAfter(css, /\.mf-label\s*\{/);
    expect(rule).toMatch(/font-family:\s*var\(--mf-font-label\)/);
    expect(rule).toMatch(/font-size:\s*var\(--mf-size-label\)/);
    expect(rule).toMatch(/letter-spacing:\s*var\(--mf-label-tracking\)/);
    expect(rule).toMatch(/text-transform:\s*uppercase/);
  });
});

describe('cockpit.css phone rules', () => {
  // The formatter breaks long selectors over lines; compare them flat.
  const flatten = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')');
  const flat = flatten(css);
  const phone = blockAfter(
    flat,
    new RegExp(
      `@media not all and \\(min-width:\\s*${BREAKPOINTS.tablet}px\\)\\s*`,
    ),
  );
  const phoneRule = (selector: string) => ruleIn(phone, selector);
  const flatRule = (selector: string) => ruleIn(flat, selector);
  const collapsing = '.spartan-table:has([data-column="main"])';

  it('gives every button, field, tab, switch and standalone link the 44 px minimum', () => {
    expect(
      flatRule(
        ':where(button, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], input:not([type="checkbox"], [type="radio"], [type="hidden"], [type="range"]))',
      ),
    ).toMatch(/min-height:\s*var\(--mf-tap\)/);
    const link = rule(':where(a:not(:where(p, li) a))');
    expect(link).toMatch(/min-height:\s*var\(--mf-tap\)/);
    expect(link).toMatch(/display:\s*inline-flex/);
  });

  it('sets every field at 16 px so a phone does not zoom on tap', () => {
    expect(rule(':where(input, select, textarea)')).toMatch(
      /font-size:\s*var\(--mf-size-field\)/,
    );
  });

  it('wraps long words and keeps the page clear of the side insets', () => {
    const body = rule('body');
    expect(body).toMatch(/overflow-wrap:\s*break-word/);
    expect(body).toMatch(
      /padding-inline:\s*var\(--mf-safe-left\) var\(--mf-safe-right\)/,
    );
  });

  it('offers the four safe-area insets as tokens', () => {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(dark.get(`--mf-safe-${edge}`)).toBe(
        `env(safe-area-inset-${edge}, 0px)`,
      );
    }
  });

  it('keeps the sheet clear of the notch and the home indicator', () => {
    expect(rule('.spartan-sheet-content')).toMatch(
      /padding-block:\s*calc\(var\(--mf-space-6\) \+ var\(--mf-safe-top\)\)\s+calc\(var\(--mf-space-6\) \+ var\(--mf-safe-bottom\)\)/,
    );
  });

  it('wraps button labels on a phone', () => {
    expect(phoneRule('.spartan-button')).toMatch(/white-space:\s*normal/);
  });

  it('turns a table that names a main column into list rows on a phone', () => {
    expect(phoneRule(`${collapsing} .spartan-table-header`)).toMatch(
      /display:\s*none/,
    );
    expect(
      phoneRule(
        `${collapsing} .spartan-table-cell:not([data-column="main"], [data-column="key"]), ${collapsing} .spartan-table-head:not([data-column="main"], [data-column="key"])`,
      ),
    ).toMatch(/display:\s*none/);
    const row = phoneRule(`${collapsing} .spartan-table-row`);
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/justify-content:\s*space-between/);
    expect(phoneRule(`${collapsing} [data-column="main"]`)).toMatch(
      /order:\s*0/,
    );
    expect(phoneRule(`${collapsing} [data-column="key"]`)).toMatch(
      /order:\s*1/,
    );
  });

  it('collapses only below the tablet breakpoint', () => {
    expect(topLevel).not.toContain('data-column');
  });
});
