import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A var(--mf-…) the Cockpit theme never defines falls back silently: the
// text keeps the body colour, the corner its fallback. Every screen's
// stylesheet reads only tokens the theme defines, and type sizes come from
// the theme's scale.
const app = join(__dirname, 'app');
const theme = readFileSync(
  join(__dirname, '../../../libs/ui-cockpit/src/styles/cockpit.css'),
  'utf8',
);
const defined = new Set(
  [...theme.matchAll(/(--mf-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

const sheets = stylesheets(app).map((path) => ({
  css: readFileSync(path, 'utf8'),
  path: path.slice(app.length + 1),
}));

describe('screen stylesheets', () => {
  it('read only the tokens the Cockpit theme defines', () => {
    const unknown = sheets.flatMap(({ css, path }) =>
      [...css.matchAll(/var\((--mf-[a-z0-9-]+)/g)]
        .map((m) => m[1])
        .filter((token) => !defined.has(token))
        .map((token) => `${path}: ${token}`),
    );

    expect(unknown).toEqual([]);
  });

  it('take small and label type sizes from the theme scale', () => {
    const literal = sheets.flatMap(({ css, path }) =>
      [...css.matchAll(/font-size:\s*(0\.875rem|0\.75rem|13px|12px)/g)].map(
        (m) => `${path}: ${m[1]}`,
      ),
    );

    expect(literal).toEqual([]);
  });
});
