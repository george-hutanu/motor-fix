import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Jest transform drops stylesheets, so the rules are read from the source.
const css = readFileSync(join(__dirname, 'garage-home.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

// The phone block's body for one selector, or '' when there is none.
function phone(selector: string): string {
  const media = /@media \(max-width: 767\.98px\) \{([\s\S]*?)\n\}/.exec(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^{}]*)\\}`).exec(
    media?.[1] ?? '',
  );
  return rule?.[1] ?? '';
}

// @traces 011-FR-004
describe('the count and the customise button on phones (PR #617 QA lap 3)', () => {
  it('keeps them on one full-width line instead of wrapping the button under the count', () => {
    expect(phone('.layout')).toMatch(/flex-wrap:\s*nowrap;/);
    expect(phone('.layout')).toMatch(/inline-size:\s*100%;/);
  });

  it('lets the count shrink and keeps the button whole', () => {
    expect(phone('.layout .muted')).toMatch(/flex:\s*1 1 auto;/);
    expect(phone('.layout .muted')).toMatch(/min-width:\s*0;/);
    expect(phone('.layout button')).toMatch(/flex:\s*none;/);
  });
});
