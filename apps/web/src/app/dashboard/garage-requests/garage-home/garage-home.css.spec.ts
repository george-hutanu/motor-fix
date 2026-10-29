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

// @traces 011-FR-011
describe('the count and the customise button on phones (PR #617 QA laps 3 and 5)', () => {
  it('stacks them on the full width instead of squeezing the count beside the button', () => {
    expect(phone('.layout')).toMatch(/flex-direction:\s*column;/);
    expect(phone('.layout')).toMatch(/align-items:\s*flex-start;/);
    expect(phone('.layout')).toMatch(/inline-size:\s*100%;/);
    expect(phone('.layout')).toMatch(/margin-inline-start:\s*0;/);
  });

  it("lines the button's label up with the count's left edge", () => {
    expect(phone('.layout button')).toMatch(/padding-inline:\s*0;/);
  });
});
