import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'cockpit.css'), 'utf8');
const part = (file: string) =>
  readFileSync(join(__dirname, '..', 'lib', file), 'utf8');

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

const declarations = (source: string, property: string) =>
  [...source.matchAll(new RegExp(`\\b${property}\\s*:\\s*([^;]+);`, 'g'))].map(
    ([, value]) => value.trim(),
  );

const motionTokens = new Map(
  [...css.matchAll(/(--mf-motion-[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, name, value]) => [name, value.trim()],
  ),
);

const reduced = blockAfter(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
);

describe('Cockpit motion', () => {
  it('holds the Build brief values as shared tokens', () => {
    expect(Object.fromEntries(motionTokens)).toEqual({
      '--mf-motion-blink': '1s',
      '--mf-motion-dial': '1100ms',
      '--mf-motion-ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
      '--mf-motion-flash': '1s',
      '--mf-motion-pop': '420ms',
      '--mf-motion-pulse': '1.6s',
      '--mf-motion-rise': '700ms',
      '--mf-motion-roll': '900ms',
      '--mf-motion-stagger': '60ms',
    });
  });

  it('draws the rise, the pop, the pulse and the blink as in the Build brief', () => {
    const keyframes = (name: string) =>
      blockAfter(css, new RegExp(`@keyframes\\s+${name}\\b`)).replace(
        /\s+/g,
        ' ',
      );

    expect(keyframes('mf-rise')).toMatch(
      /from \{ opacity: 0; transform: translateY\(14px\); \}/,
    );
    expect(keyframes('mf-pop')).toMatch(
      /from \{ opacity: 0; transform: scale\(0\.94\); \}/,
    );
    expect(keyframes('mf-pulse')).toMatch(/50% \{ opacity: 0\.45; \}/);
    expect(keyframes('mf-blink')).toMatch(/50% \{ opacity: 0\.35; \}/);
    expect(
      declarations(blockAfter(css, /\.mf-blink\s*\{/), 'animation'),
    ).toEqual(['mf-blink var(--mf-motion-blink) steps(1, end) infinite']);
  });

  it('pops dialogs and sheets in when they open', () => {
    const rule = blockAfter(
      css,
      /\.spartan-dialog-content,\s*\.spartan-sheet-content\s*\{\s*animation/,
    );

    expect(declarations(rule, 'animation')).toEqual([
      'mf-pop var(--mf-motion-pop) var(--mf-motion-ease) backwards',
    ]);
    for (const side of ['right', 'left']) {
      const sheet = blockAfter(
        css,
        new RegExp(
          `\\.spartan-sheet-content\\[data-side="${side}"\\]\\s*\\{\\s*transform-origin`,
        ),
      );
      expect(declarations(sheet, 'transform-origin')).toEqual([
        `${side} center`,
      ]);
    }
  });

  it('stops every animation and transition when the device asks for reduced motion', () => {
    const rule = blockAfter(reduced, /\*,\s*\*::before,\s*\*::after/);

    expect(declarations(rule, 'animation')).toEqual(['none !important']);
    expect(declarations(rule, 'transition')).toEqual(['none !important']);
  });

  it('times every motion it adds with the shared tokens', () => {
    const outsideReduced = css.replace(reduced, '');
    const added = [
      ...declarations(outsideReduced, 'animation'),
      ...['panel.ts', 'lamp.ts', 'rating-dial.ts', 'odometer.ts'].flatMap(
        (file) => [
          ...declarations(part(file), 'animation'),
          ...declarations(part(file), 'transition'),
        ],
      ),
    ];

    expect(added.length).toBeGreaterThanOrEqual(7);
    for (const value of added) {
      expect([value, /var\(--mf-motion-(?!ease)[\w-]+\)/.test(value)]).toEqual([
        value,
        true,
      ]);
    }
  });

  it('builds panels up one after another, the twelfth and later together', () => {
    const panel = part('panel.ts');

    expect(declarations(panel, 'animation')).toEqual([
      'mf-rise var(--mf-motion-rise) var(--mf-motion-ease) calc(var(--mf-panel-step, 0) * var(--mf-motion-stagger)) backwards',
    ]);
    const steps = [
      ...panel.matchAll(
        /:host\(:nth-child\((\d+) of mf-panel\)\)\s*\{\s*--mf-panel-step:\s*(\d+);/g,
      ),
    ].map(([, child, step]) => [Number(child), Number(step)]);
    expect(steps).toEqual(Array.from({ length: 10 }, (_, i) => [i + 2, i + 1]));
    // Only panels count, so the first panel starts at once; the twelfth and
    // every later one share the last step, never step 0.
    expect(panel).not.toMatch(/:nth-child\((?![^)]*of mf-panel)/);
    expect(panel).toMatch(
      /:host\(:nth-child\(n \+ 12 of mf-panel\)\)\s*\{\s*--mf-panel-step:\s*11;\s*\}/,
    );
  });
});
