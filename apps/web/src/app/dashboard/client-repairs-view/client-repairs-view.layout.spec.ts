import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'client-repairs-view.css'), 'utf8');

// Every rule as [selectors, body], media blocks flattened.
const rules = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, sel, body]) => ({
  body,
  selectors: sel.split(',').map((s) => s.trim()),
}));

describe('client repairs row layout (FR-002)', () => {
  // Angular scopes every compound selector, so `.row > *` weighs two classes plus two attributes and
  // outranks a lone `.correct`: a rule that places a row's child must name `.row >` to win.
  it.each(['.correct', '.corrected'])(
    'places %s with a selector that beats .row > *',
    (name) => {
      const placing = rules.filter(
        (r) =>
          /grid-(column|row)\s*:/.test(r.body) &&
          r.selectors.some((s) => s.endsWith(name)),
      );
      expect(placing.length).toBeGreaterThan(0);
      for (const r of placing) {
        for (const s of r.selectors.filter((x) => x.endsWith(name)))
          expect(s).toBe(`.row > ${name}`);
      }
    },
  );

  it('places .corrected under the row from a tablet up', () => {
    const placing = rules.find(
      (r) =>
        r.selectors.includes('.row > .corrected') &&
        /grid-row:\s*2/.test(r.body),
    );
    expect(placing?.body).toMatch(/grid-column:\s*1 \/ -1/);
  });
});
