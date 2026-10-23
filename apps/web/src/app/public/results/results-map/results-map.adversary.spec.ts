import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'results-map.css'), 'utf8').replace(
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
const NARROW = '@media (max-width: 359.98px)';
const narrow = rules.filter((r) => r.media.includes(NARROW));
const narrowLegend = narrow.filter((r) => /\.legend\b/.test(r.selector));
const declared = (body: string) =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => d.split(':')[0].trim());

// @traces 1351-FR-001
describe('the legend rules for a phone under 360 px', () => {
  it('has the narrow block and nothing in it but legend rules', () => {
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.map((r) => r.selector)).toEqual(narrow.map(() => '.legend'));
  });

  it('sets no font size, so the legend keeps the 16 px body size', () => {
    for (const r of narrow) {
      expect(declared(r.body)).not.toContain('font-size');
      expect(declared(r.body)).not.toContain('font');
      expect(declared(r.body)).not.toContain('zoom');
      expect(declared(r.body)).not.toContain('transform');
    }
  });

  it('leaves the zoom room, the width and the side inset alone', () => {
    const props = narrow.flatMap((r) => declared(r.body));

    expect(props.filter((p) => p.startsWith('--'))).toEqual([]);
    for (const p of ['max-width', 'width', 'left', 'right', 'min-width']) {
      expect(props).not.toContain(p);
    }
  });

  it('never hides or collapses the legend', () => {
    const body = narrow.map((r) => r.body).join(';');

    expect(body).not.toMatch(/visibility\s*:/);
    expect(body).not.toMatch(/display\s*:/);
    expect(body).not.toMatch(/opacity\s*:/);
    expect(body).not.toMatch(/overflow\s*:/);
    expect(body).not.toMatch(/(?<![-\w])height\s*:/);
  });

  it('keeps the line height at or above 1.2 so rows do not overlap', () => {
    const heights = narrowLegend
      .map((r) => r.body.match(/line-height:\s*([\d.]+)\s*(;|$)/)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number);

    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(1.2);
  });

  it('does not touch the legend entries or the hint', () => {
    expect(
      rules.filter((r) => r.media.includes(NARROW) && r.selector !== '.legend'),
    ).toEqual([]);
  });
});

// @traces 1351-FR-001
describe('the phone legend rules in the map stylesheet', () => {
  const phone = '@media (max-width: 767.98px)';

  it('keeps the 16 px body size under 768 px and the zoom room at the tap size plus 20 px', () => {
    const font = rules.find(
      (r) => r.media.join() === phone && r.selector === '.legend, .hint',
    );
    const map = rules.find(
      (r) => r.media.join() === phone && r.selector === '.map',
    );

    expect(font?.body.replace(/\s+/g, '')).toBe(
      'font-size:var(--mf-size-body);',
    );
    expect(map?.body.replace(/\s+/g, '')).toBe(
      '--zoom-room:calc(var(--mf-tap)+20px);',
    );
  });

  it('hides the legend behind the zoom hint, only under 768 px', () => {
    const hidden = rules.filter(
      (r) => /\.hint/.test(r.selector) && /~\s*\.legend/.test(r.selector),
    );

    expect(hidden).toHaveLength(1);
    expect(hidden[0].media).toEqual([phone]);
    expect(hidden[0].selector).toBe('.hint:not(:empty) ~ .legend');
    expect(hidden[0].body.replace(/\s+/g, '')).toBe('visibility:hidden;');
  });

  it('has no other rule that hides the legend', () => {
    const hiding = rules.filter(
      (r) =>
        /(^|[\s,>~+])\.legend$/.test(r.selector) &&
        /visibility\s*:\s*hidden|display\s*:\s*none|opacity\s*:\s*0\b/.test(
          r.body,
        ),
    );

    expect(hiding.map((r) => r.selector)).toEqual([
      '.hint:not(:empty) ~ .legend',
    ]);
  });

  it('shows the legend with no visibility override from the narrow block', () => {
    expect(css).not.toMatch(/visibility:\s*visible/);
  });
});
