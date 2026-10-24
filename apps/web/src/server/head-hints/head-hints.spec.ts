/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { headHints, withHeadHints } from './head-hints';

const page = '<html><head><title>MotorFix</title></head><body></body></html>';
const html = (body = page, init: ResponseInit = {}) =>
  new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status: 200,
    ...init,
  });

const SITE = 'https://motorfix.ro';
const IMAGES = 'https://images.motorfix.ro/garages';
const TILES =
  '<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>';
const IMAGE_HINT = '<link rel="preconnect" href="https://images.motorfix.ro">';

let dist: string;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'head-hints-'));
});
afterEach(() => rmSync(dist, { force: true, recursive: true }));

function built(...files: string[]) {
  mkdirSync(join(dist, 'media'));
  for (const file of files) writeFileSync(join(dist, 'media', file), '');
}

const head = async (
  path: string,
  hints = headHints({ distFolder: dist, imageBase: IMAGES, siteOrigin: SITE }),
) => {
  const text = await (await withHeadHints(path, html(), hints)).text();
  return text.slice(0, text.indexOf('</head>'));
};
const links = (text: string) => text.match(/<link [^>]*>/g) ?? [];

// @traces 1193-FR-006
describe('the connections opened ahead of time', () => {
  it('opens the image server and the map tiles on the results page', async () => {
    const text = await head('/ro/garages?brand=dacia');

    expect(text).toContain(IMAGE_HINT);
    expect(text).toContain(TILES);
  });

  it('opens the map tiles on the results page in English too, and with no query', async () => {
    expect(await head('/en/garages')).toContain(TILES);
  });

  it('opens only the image server on a garage profile, which draws no map tiles', async () => {
    const text = await head('/en/garages/service-auto-militari');

    expect(text).toContain(IMAGE_HINT);
    expect(text).not.toContain('tiles.openfreemap.org');
  });

  it('opens no connection to an image server on the page own origin', async () => {
    for (const imageBase of ['/api/v1/images', `${SITE}/api/v1/images`]) {
      const text = await head(
        '/ro/garages',
        headHints({ distFolder: dist, imageBase, siteOrigin: SITE }),
      );

      const preconnects = links(text).filter((l) => l.includes('preconnect'));
      expect(preconnects).toEqual([TILES]);
    }
  });

  it('never writes a hint with an empty or bare-slash address', async () => {
    const text = await head(
      '/ro',
      headHints({ distFolder: dist, imageBase: '/', siteOrigin: SITE }),
    );

    expect(text).not.toMatch(/href="\/?"/);
  });

  it('writes at most four hints on any page', async () => {
    for (const path of [
      '/ro',
      '/ro/garages?brand=bmw',
      '/en/garages/x',
      '/ro/cont',
    ]) {
      expect(links(await head(path)).length).toBeLessThanOrEqual(4);
    }
  });

  it('leaves a response that is not a page untouched', async () => {
    const json = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    });
    const hints = headHints({
      distFolder: dist,
      imageBase: IMAGES,
      siteOrigin: SITE,
    });

    expect(await withHeadHints('/ro/garages', json, hints)).toBe(json);
  });

  it('keeps the status and headers, dropping a length that no longer holds', async () => {
    const res = await withHeadHints(
      '/ro/garages',
      html(page, {
        headers: {
          'content-length': String(page.length),
          'content-type': 'text/html',
        },
        status: 404,
      }),
      headHints({ distFolder: dist, imageBase: IMAGES, siteOrigin: SITE }),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-type')).toBe('text/html');
  });
});

// @traces 1193-FR-010
describe('the heading font loaded ahead of time', () => {
  const preload = (file: string) =>
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="/media/${file}">`;

  it('loads the Latin Extended file for a Romanian page, which holds ș and ț', async () => {
    built(
      'michroma-latin-ext-400-normal-AB12CD34.woff2',
      'michroma-latin-400-normal-EF56GH78.woff2',
    );

    const fonts = links(await head('/ro/garages/x')).filter((l) =>
      l.includes('preload'),
    );

    expect(fonts).toEqual([
      preload('michroma-latin-ext-400-normal-AB12CD34.woff2'),
    ]);
  });

  it('loads the Latin file for an English page', async () => {
    built(
      'michroma-latin-ext-400-normal-AB12CD34.woff2',
      'michroma-latin-400-normal-EF56GH78.woff2',
    );

    const fonts = links(await head('/en')).filter((l) => l.includes('preload'));

    expect(fonts).toEqual([
      preload('michroma-latin-400-normal-EF56GH78.woff2'),
    ]);
  });

  it('treats a page outside both languages as Romanian, the default', async () => {
    built(
      'michroma-latin-ext-400-normal-AB12CD34.woff2',
      'michroma-latin-400-normal-EF56GH78.woff2',
    );

    expect(await head('/')).toContain(
      preload('michroma-latin-ext-400-normal-AB12CD34.woff2'),
    );
  });

  it('ignores the older woff files beside the woff2 ones', async () => {
    built(
      'michroma-latin-ext-400-normal-ZZZZZZZZ.woff',
      'michroma-latin-ext-400-normal-AB12CD34.woff2',
      'michroma-latin-400-normal-EF56GH78.woff2',
    );

    expect(await head('/ro')).toContain(
      preload('michroma-latin-ext-400-normal-AB12CD34.woff2'),
    );
  });

  it('falls back to the unhashed names when the build has no media folder', async () => {
    expect(await head('/ro')).toContain(
      preload('michroma-latin-ext-400-normal.woff2'),
    );
    expect(await head('/en')).toContain(
      preload('michroma-latin-400-normal.woff2'),
    );
  });
});
