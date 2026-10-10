import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(__dirname, '..');
const read = (path: string) => readFileSync(join(publicDir, path), 'utf8');

/** The CSS with every `@media (min-width: 768px)` block taken out: what a phone reads. */
function phoneOnly(css: string): string {
  let out = '';
  let i = 0;
  const opener = /@media \(min-width: 768px\) \{/g;
  for (let m = opener.exec(css); m; m = opener.exec(css)) {
    out += css.slice(i, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    while (depth > 0 && j < css.length) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    i = j;
    opener.lastIndex = j;
  }
  return out + css.slice(i);
}

describe('the list-your-garage page on a phone', () => {
  const steps = [
    'list-your-garage/list-your-garage.css',
    'details-step/details-step.css',
    'place-step/place-step.css',
    'hours-step/hours-step.css',
    'brands-step/brands-step.css',
  ];

  it.each(steps)(
    '%s reads at the body size on a phone: the small and label sizes start at a tablet',
    (path) => {
      const css = read(path);
      expect(phoneOnly(css)).not.toMatch(/--mf-size-(small|label)/);
    },
  );

  it('gives the closed-day ticks a 44 px tap target', () => {
    expect(read('hours-step/hours-step.css')).toMatch(
      /\.tick input \{[^}]*width: var\(--mf-tap\);[^}]*height: var\(--mf-tap\);/,
    );
  });

  it('gives the short choice buttons of the details step a 44 px width', () => {
    expect(read('details-step/details-step.css')).toMatch(
      /fieldset button \{[^}]*min-width: var\(--mf-tap\);/,
    );
  });

  // The open step list is laid over the page: over the pinned Save, and ending
  // above the tab bar and the consent bar, so no step sits under either.
  it('lays the open step list over Save and ends it above the bars at the bottom', () => {
    const phone = read('list-your-garage/list-your-garage.css')
      .split('@media not all and (min-width: 768px)')[1]
      ?.replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')');
    expect(phone).toMatch(/\bnav \{[^}]*z-index: 2;/);
    expect(phone).toMatch(
      /\bol \{[^}]*max-height: calc\(100dvh - var\(--public-site-bar, 0px\) - var\(--mf-tap\) - var\(--tab-bar, 0px\) - var\(--consent-bar, 0px\)\);/,
    );
  });

  it("sizes the map's zoom buttons over maplibre's own 29 px rule", () => {
    const styles = readFileSync(join(publicDir, '../../styles.css'), 'utf8');
    expect(styles).toMatch(
      /\.maplibregl-ctrl\.maplibregl-ctrl-group button \{[^}]*width: var\(--mf-tap\);[^}]*height: var\(--mf-tap\);/,
    );
  });
});

describe('the public tab bar', () => {
  const css = read('tab-bar/tab-bar.css');

  it('keeps its padding and gap on the 4 px grid', () => {
    expect(css).toMatch(
      /nav \{[^}]*padding: 8px 8px max\(16px, var\(--mf-safe-bottom\)\);/,
    );
    expect(css).toMatch(/\ba \{[^}]*gap: 4px;/);
  });

  it('labels its tabs at the body size', () => {
    expect(css).toMatch(/\ba \{[^}]*font-size: var\(--mf-size-body\);/);
  });

  it('is the height the page actions sit above', () => {
    expect(read('frame/frame.css')).toMatch(
      /--tab-bar: calc\(1px \+ 8px \+ 52px \+ max\(16px, var\(--mf-safe-bottom\)\)\);/,
    );
    expect(read('list-your-garage/list-your-garage.css')).toMatch(
      /bottom: calc\(var\(--tab-bar, 0px\) \+ var\(--consent-bar, 0px\)\);/,
    );
  });
});
