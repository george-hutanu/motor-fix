import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHEETS = [
  'garage-requests-view',
  'garage-requests-panel',
  'quotes-sent-panel',
  'quote-sent-row',
  'garage-request-row',
] as const;

const css = (name: string) =>
  readFileSync(join(__dirname, name, `${name}.css`), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

// The lamp centres itself on the first line of its status.
const ALLOWED = new Set(['0', 'auto', 'calc((1lh - 8px) / 2)']);

// @traces 346-FR-006
describe('the stylesheets of the garage requests view', () => {
  it.each(SHEETS)(
    'spaces %s only with the spacing tokens, 0 or auto',
    (name) => {
      for (const [, , value] of css(name).matchAll(
        /(?:^|[\s;{])(margin|padding|gap)(?:-[a-z-]+)?:\s*([^;]+);/g,
      ))
        for (const part of value.trim().split(/\s+(?![^(]*\))/))
          expect(
            ALLOWED.has(part) || /^var\(--mf-space-\d+\)$/.test(part)
              ? 'ok'
              : part,
          ).toBe('ok');
    },
  );

  it.each(SHEETS)('sizes the text of %s only with the type tokens', (name) => {
    for (const [, value] of css(name).matchAll(/font-size:\s*([^;]+);/g))
      expect(value.trim()).toMatch(/^var\(--mf-size-[a-z]+\)$/);
  });
});
