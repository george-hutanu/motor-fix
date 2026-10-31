import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Texts = Record<string, unknown>;

const labels = (language: 'ro' | 'en'): [string, string][] => {
  const nav = (
    JSON.parse(
      readFileSync(join(__dirname, 'shell', `${language}.json`), 'utf8'),
    ) as Texts
  )['frame'] as Texts;
  const out: [string, string][] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') out.push([path, node]);
    else if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(nav['nav'], 'nav');
  return out;
};

// The side navigation fits "Profilul service‑ului" (21 characters) on one line from a tablet up;
// a longer entry wraps and crowds the one below it.
// @traces 1400-FR-001 1400-FR-011
describe('the navigation labels', () => {
  it.each(['ro', 'en'] as const)('fit on one line in %s', (language) => {
    expect(labels(language).filter(([, text]) => text.length > 21)).toEqual([]);
  });
});
