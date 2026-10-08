import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// At 320 px the heading's longest word ("MAINTENANCE", 249 px in the wide
// label face at 20 px, "MENTENANȚĂ" 238 px) broke mid-word inside a card with
// a 24 px inset. The heading stays on the type scale (20 px); the card's inset
// is 16 px on a narrow phone, which leaves a 254 px text column, and 24 px from
// 390 px up.
const css = readFileSync(join(__dirname, 'maintenance-page.css'), 'utf8');
const rule = (selector: string, from = css) =>
  from.match(new RegExp(`(?:^|\\n)\\s*${selector} \\{([^}]*)\\}`))?.[1] ?? '';
const wide = css.match(/@media \(min-width: 390px\) \{([\s\S]*?)\n\}/)?.[1];

describe('maintenance page stylesheet', () => {
  it('keeps the heading on the type scale at every width', () => {
    expect(rule('h1')).toMatch(/font-size:\s*var\(--mf-size-subheading\);/);
    expect(css).not.toMatch(/vw/);
  });

  it('insets the card by 16 px on a narrow phone', () => {
    expect(rule('main')).toMatch(/padding:\s*var\(--mf-space-4\);/);
  });

  it('insets the card by 24 px from a 390 px phone up', () => {
    expect(wide).toBeDefined();
    expect(rule('main', wide)).toMatch(/padding:\s*var\(--mf-space-6\);/);
  });
});
