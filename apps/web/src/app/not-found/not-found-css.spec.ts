import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The not-found page sat flush on the screen's left edge with a browser-blue
// link (PR #565 QA, lap 1). It takes the maintenance page's frame: an inset
// that respects the safe area, a card on the type scale and a themed link.
const css = readFileSync(join(__dirname, 'not-found.css'), 'utf8');
const rule = (selector: string, from = css) =>
  from.match(new RegExp(`(?:^|\\n)\\s*${selector} \\{([^}]*)\\}`))?.[1] ?? '';
const wide = css.match(/@media \(min-width: 390px\) \{([\s\S]*?)\n\}/)?.[1];

describe('not-found page stylesheet', () => {
  it('insets the page from every edge, safe area included', () => {
    const host = rule(':host');
    expect(host).toMatch(/padding:[^;]*var\(--mf-space-4\)/);
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(host).toContain(`var(--mf-safe-${side})`);
    expect(host).toMatch(/background:\s*var\(--mf-bg\);/);
  });

  it('insets the card by 16 px on a narrow phone and 24 px from 390 px up', () => {
    expect(rule('main')).toMatch(/padding:\s*var\(--mf-space-4\);/);
    expect(wide).toBeDefined();
    expect(rule('main', wide)).toMatch(/padding:\s*var\(--mf-space-6\);/);
  });

  it('keeps the heading on the type scale and the link in the theme', () => {
    expect(rule('h1')).toMatch(/font-size:\s*var\(--mf-size-subheading\);/);
    expect(rule('a')).toMatch(/color:\s*var\(--mf-[a-z-]+\);/);
    expect(rule('a')).toMatch(/min-height:\s*var\(--mf-tap\);/);
    expect(css).not.toMatch(/vw/);
  });
});
