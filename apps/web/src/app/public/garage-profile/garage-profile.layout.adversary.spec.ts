import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'garage-profile.css'), 'utf8');
const html = readFileSync(join(__dirname, 'garage-profile.html'), 'utf8');

const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
const desktopBlock = desktop.slice(0, desktop.indexOf('\n}\n') + 3);

// @traces 311-FR-009
describe('the profile’s two columns', () => {
  it('opens the two-column layout at exactly 1024 px and not before', () => {
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).not.toMatch(
      /@media \(min-width: (1023|767|768)px\)\s*\{\s*\.sections/,
    );
  });

  it('dissolves both columns below 1024 px', () => {
    expect(css).toMatch(/\.main,\s*\.side\s*\{\s*display:\s*contents;?\s*\}/);
  });

  it('keeps the side column sticky under the site bar from 1024 px', () => {
    expect(desktopBlock).toMatch(/\.side\s*\{[^}]*position:\s*sticky/);
    expect(desktopBlock).toMatch(/top:\s*calc\(var\(--public-site-bar, 0px\)/);
  });

  it('lets a tall side column scroll inside itself', () => {
    expect(desktopBlock).toMatch(/\.side\s*\{[^}]*max-height:[^;]*100dvh/);
    expect(desktopBlock).toMatch(/\.side\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('hides a side column whose sections are all empty', () => {
    expect(css).toMatch(
      /\.side:not\(:has\(section:not\(:empty\)\)\)\s*\{\s*display:\s*none;?\s*\}/,
    );
  });

  it('keeps the hiding rule from being outweighed by the desktop display rule', () => {
    const hide = /\.side:not\(:has\(section:not\(:empty\)\)\)/;
    expect(css.search(hide)).toBeGreaterThanOrEqual(0);
    expect(desktopBlock).not.toMatch(/display:\s*grid\s*!important/);
  });

  it('keeps the main column in today’s order and the side column after it', () => {
    const order = [
      'data-slot="photos"',
      'data-slot="brands"',
      'data-slot="mechanics"',
      'data-slot="prices"',
      'data-slot="reviews"',
      'mf-estimate-section',
      'data-slot="where"',
    ].map((needle) => html.indexOf(needle));

    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('puts the estimate box in the side column, not the main one', () => {
    const main = html.slice(
      html.indexOf('class="main"'),
      html.indexOf('class="side"'),
    );

    expect(main).not.toContain('mf-estimate-section');
  });

  it('shows the box only when the garage lists a price', () => {
    expect(html).toMatch(
      /@if \(garage\.prices\.length\)\s*\{\s*<section mf-estimate-section/,
    );
  });

  it('lets the single column put the estimate right after the prices and the reviews after it', () => {
    expect(css).toMatch(/\[data-slot="reviews"\]\s*\{\s*order:\s*1/);
    expect(css).toMatch(/\[data-slot="where"\]\s*\{\s*order:\s*2/);
  });
});

// @traces 311-FR-007
describe('the room the bar needs', () => {
  it('pads the page’s end by the bar’s measured height with 0 as the fallback', () => {
    expect(css).toMatch(
      /padding-bottom:\s*calc\(var\(--mf-space-8\) \+ var\(--estimate-bar, 0px\)\)/,
    );
  });

  it('renders the bar inside the loaded profile only', () => {
    const at = html.indexOf('<mf-estimate-bar');
    const loaded = html.indexOf('@else if (garage(); as garage)');
    const failed = html.indexOf('@else if (profile.error())');

    expect(at).toBeGreaterThan(loaded);
    expect(at).toBeLessThan(failed);
  });
});
