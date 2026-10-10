import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Jest transform drops component styles, so they are read from the source.
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

const STEPS = ['brands-step/brands-step', 'documents-step/documents-step'];

describe('the 20 px checkbox inside a 44 px tap target', () => {
  it('is drawn once, by the global mf-check rule', () => {
    const global = read('../../styles.css');
    expect(global).toMatch(
      /input\[type="checkbox"\]\.mf-check \{[^}]*width: var\(--mf-tap\)/,
    );
    expect(global).toMatch(
      /input\[type="checkbox"\]\.mf-check:checked::after \{/,
    );
  });

  it.each(STEPS)(
    '%s ticks its boxes with mf-check, without a copy of the rule',
    (step) => {
      expect(read(`${step}.html`)).toMatch(
        /<input[^>]*class="mf-check"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*class="mf-check"/,
      );
      expect(read(`${step}.css`)).not.toMatch(/appearance: none/);
    },
  );
});
