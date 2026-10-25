import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(__dirname, '../../..');

const skippedOutside = [
  'libs/ui-cockpit',
  'libs/data-access/src/lib',
  'libs/domain/src/generated',
  // The API draws the static map in the tile provider's own colours, into an
  // image; no theme token reaches a picture made on the server.
  'libs/domain/src/maps/static-map/static-map.palette.ts',
];

const colourLiteral =
  /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?!\w)|\b(?:rgba?|hsla?)\(/gi;

function sources(dir: string, skipped = skippedOutside): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (skipped.some((s) => rel === s || rel.startsWith(`${s}/`))) return [];
    if (entry.isDirectory()) return sources(path, skipped);
    if (/\.spec\.ts$/.test(entry.name)) return [];
    return /\.(ts|html|css|scss)$/.test(entry.name) ? [path] : [];
  });
}

function frontEndSources(): string[] {
  const libs = readdirSync(join(root, 'libs'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, 'libs', d.name, 'src'));
  return [join(root, 'apps/web/src'), ...libs].flatMap((dir) => {
    try {
      return sources(dir);
    } catch {
      return [];
    }
  });
}

// The token blocks are the dark :root and the light one inside its media query.
const outsideTokenBlocks = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('cockpit.css')
    ? text.replace(/:root\s*\{[^}]*\}/g, '')
    : text;
};

describe('colour literals', () => {
  it('recognises hex and functional colours but not ids or entities', () => {
    const found = (text: string) => text.match(colourLiteral) ?? [];

    expect(found('color: #fff;')).toEqual(['#fff']);
    expect(found("background: '#FFB000'")).toEqual(['#FFB000']);
    expect(found('rgba(0, 0, 0, 0.4)')).toEqual(['rgba(']);
    expect(found('hsl(10 20% 30%)')).toEqual(['hsl(']);
    expect(found('href="#tab-1" &#123; #section-header')).toEqual([]);
  });

  it('appear nowhere in front-end source outside the theme library', () => {
    const offenders = frontEndSources().flatMap((file) =>
      (readFileSync(file, 'utf8').match(colourLiteral) ?? []).map(
        (hit) => `${relative(root, file)}: ${hit}`,
      ),
    );

    expect(frontEndSources().length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  // @traces 517-FR-004
  it('appear in the theme library only in the token blocks and the generated colours', () => {
    const files = sources(join(root, 'libs/ui-cockpit/src'), [
      'libs/ui-cockpit/src/generated',
    ]);
    const offenders = files.flatMap((file) =>
      (outsideTokenBlocks(file).match(colourLiteral) ?? []).map(
        (hit) => `${relative(root, file)}: ${hit}`,
      ),
    );

    expect(files.some((file) => file.endsWith('cockpit.css'))).toBe(true);
    expect(offenders).toEqual([]);
  });
});
