import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Jest transform drops component styles, so they are read from the source.
const css = (file: string) =>
  readFileSync(join(__dirname, file), 'utf8').replace(/\s+/g, ' ');

const PHONE =
  /@media (?:\(max-width: 767\.98px\)|not all and \(min-width: 768px\)) \{/g;

/** The body of the block whose opening brace ends just before `from`. */
function block(text: string, from: number): string {
  let depth = 1;
  let i = from;
  while (i < text.length && depth > 0) {
    depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
    i++;
  }
  return text.slice(from, i - 1);
}

/** Every rule inside the stylesheet's phone-only media blocks. */
const phoneRules = (file: string): string => {
  const text = css(file);
  return [...text.matchAll(PHONE)]
    .map((m) => block(text, (m.index ?? 0) + m[0].length))
    .join(' ');
};

const bodyOnPhone = (file: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(^|[},])\\s*[^{}]*${escaped}(?![\\w-])[^{}]*\\{[^}]*font-size: var\\(--mf-size-body\\)`,
  ).test(phoneRules(file));
};

// ST-953 FR-001: on a phone, running text (p, li, button, a) is at least the 16 px body size.
// The listing page and steps 1-4 are checked by list-your-garage/phone-sizes.spec.ts.
describe('running text on a phone is at body size', () => {
  it.each([
    ['brand-verdict/brand-verdict.css', '.note'],
    ['mechanics-step/mechanics-step.css', '.error'],
    ['prices-step/prices-step.css', '.warning'],
  ])('%s %s', (file, selector) => {
    expect(bodyOnPhone(file, selector)).toBe(true);
  });
});
