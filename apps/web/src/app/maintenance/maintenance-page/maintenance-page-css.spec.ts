import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// At 320 px the heading's longest word ("MAINTENANCE", "MENTENANȚĂ") in the
// wide label face at 20 px is wider than the card's text column, so it broke
// mid-word. The type and the card's inset scale down with the viewport.
const css = readFileSync(join(__dirname, 'maintenance-page.css'), 'utf8');
const rule = (selector: string) =>
  css.match(new RegExp(`(?:^|\\n)${selector} \\{([^}]*)\\}`))?.[1] ?? '';

describe('maintenance page stylesheet', () => {
  it('scales the heading down with the viewport, up to the subheading size', () => {
    expect(rule('h1')).toMatch(
      /font-size:\s*clamp\(var\(--mf-size-body\),\s*[\d.]+vw,\s*var\(--mf-size-subheading\)\)/,
    );
  });

  it('narrows the card inset on a narrow phone', () => {
    expect(rule('main')).toMatch(
      /padding:\s*clamp\(var\(--mf-space-4\),\s*[\d.]+vw,\s*var\(--mf-space-6\)\)/,
    );
  });
});
