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
describe('running text on a phone is at body size', () => {
  it.each([
    ['list-your-garage/list-your-garage.css', '.label'],
    ['list-your-garage/list-your-garage.css', '.hint'],
    ['list-your-garage/list-your-garage.css', '.note'],
    ['list-your-garage/list-your-garage.css', '.error'],
    ['list-your-garage/list-your-garage.css', '.bar'],
    ['details-step/details-step.css', '.hint'],
    ['details-step/details-step.css', '.error'],
    ['place-step/place-step.css', '.hint'],
    ['place-step/place-step.css', '.error'],
    ['brands-step/brands-step.css', '.left'],
    ['brand-verdict/brand-verdict.css', '.note'],
    ['mechanics-step/mechanics-step.css', '.error'],
    ['hours-step/hours-step.css', '.holidays ul'],
    ['prices-step/prices-step.css', '.warning'],
  ])('%s %s', (file, selector) => {
    expect(bodyOnPhone(file, selector)).toBe(true);
  });
});

describe('the hours step', () => {
  it('gives the closed-day checkbox a full tap target', () => {
    expect(css('hours-step/hours-step.css')).toMatch(
      /\.tick input \{[^}]*width: var\(--mf-tap\);[^}]*height: var\(--mf-tap\);/,
    );
  });
});
