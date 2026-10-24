import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Jest transform drops stylesheets, so the rules are read from the source.
const css = readFileSync(join(__dirname, 'team-view.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

// The narrow-phone block for the add button, or '' when there is none.
function narrowAdd(): string {
  const media = /@media \(max-width: 359px\) \{\s*\.add \{([^{}]*)\}\s*\}/.exec(
    css,
  );
  return media?.[1] ?? '';
}

describe('the add-mechanic button on the narrowest phones (PR #531 QA lap 2)', () => {
  it('keeps the 16 px phone body size: no smaller font-size', () => {
    expect(narrowAdd()).not.toMatch(/font-size/);
  });

  it('fits one line by dropping the label tracking and taking the 8 px padding step', () => {
    expect(narrowAdd()).toMatch(/letter-spacing:\s*0;/);
    expect(narrowAdd()).toMatch(/padding-inline:\s*var\(--mf-space-2\);/);
  });
});
