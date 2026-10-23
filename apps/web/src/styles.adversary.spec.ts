import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

interface Flat {
  media: string[];
  selector: string;
  body: string;
}

function blockEnd(text: string, open: number): number {
  let depth = 1;
  let j = open + 1;
  while (j < text.length && depth > 0) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') depth--;
    j++;
  }
  return j;
}

function flatten(text: string, media: string[] = []): Flat[] {
  const out: Flat[] = [];
  let i = 0;
  for (
    let open = text.indexOf('{', i);
    open >= 0;
    open = text.indexOf('{', i)
  ) {
    const j = blockEnd(text, open);
    const head = text.slice(i, open).trim().replace(/\s+/g, ' ');
    const inner = text.slice(open + 1, j - 1);
    if (head.startsWith('@media'))
      out.push(...flatten(inner, [...media, head]));
    else if (!head.startsWith('@'))
      out.push({ body: inner, media, selector: head });
    i = j;
  }
  return out;
}

const rules = flatten(css);
const legendRules = rules.filter((r) => /\.legend\b/.test(r.selector));

// @traces 1351-FR-001
describe('the map legend hiding rule in the global stylesheet', () => {
  it('has exactly one rule that targets the legend', () => {
    expect(legendRules).toHaveLength(1);
  });

  it('applies only below 768 px', () => {
    for (const r of legendRules) {
      expect(r.media).toEqual(['@media (max-width: 767px)']);
    }
  });

  it('hides the legend only while the sheet carries over-zoom', () => {
    const [r] = legendRules;

    expect(r.selector).toMatch(/mf-results-sheet\.over-zoom/);
    expect(r.selector).not.toMatch(/:not\(\.over-zoom\)/);
    expect(r.selector).not.toContain(',');
  });

  it('hides it with visibility alone, keeping its box', () => {
    const [r] = legendRules;

    expect(r.body.replace(/\s+/g, '')).toBe('visibility:hidden;');
  });

  it('never shows the legend again with an override', () => {
    expect(css).not.toMatch(/\.legend[^{}]*\{[^{}]*visibility:\s*visible/);
  });

  it('never hides the legend from 768 px up', () => {
    const wide = legendRules.filter(
      (r) => r.media.length === 0 || r.media.some((m) => /min-width/.test(m)),
    );

    expect(wide).toEqual([]);
  });

  it('pairs the legend rule with the zoom buttons rule on the same trigger', () => {
    const zoom = rules.find(
      (r) =>
        /over-zoom/.test(r.selector) &&
        /maplibregl-ctrl-top-right/.test(r.selector),
    );
    const [legend] = legendRules;

    expect(zoom?.media).toEqual(legend.media);
    expect(
      zoom?.selector.replace(/\.maplibregl-ctrl-top-right/, '.legend'),
    ).toBe(legend.selector);
  });
});
