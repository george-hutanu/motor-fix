/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { headHints, withHeadHints } from './head-hints';

const SITE = 'https://motorfix.ro';
const page = '<html><head><title>MotorFix</title></head><body>x</body></html>';
const htmlResponse = (body: BodyInit | null = page, init: ResponseInit = {}) =>
  new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status: 200,
    ...init,
  });

let dist: string;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'head-hints-adv-'));
});
afterEach(() => rmSync(dist, { force: true, recursive: true }));

const hintsFor = (imageBase: string, siteOrigin: string | undefined = SITE) =>
  headHints({ distFolder: dist, imageBase, siteOrigin });
const links = (text: string) => text.match(/<link [^>]*>/g) ?? [];
const headOf = async (
  path: string,
  hints = hintsFor('https://img.example.com/g'),
) => {
  const text = await (await withHeadHints(path, htmlResponse(), hints)).text();
  return text.slice(0, text.indexOf('</head>'));
};

// @traces 1193-FR-006
describe('the connection hints under hostile configuration', () => {
  it('opens no connection to the page own origin written with a trailing slash', async () => {
    const hints = hintsFor('https://motorfix.ro/api/v1/images', `${SITE}/`);

    expect(
      links(await headOf('/ro', hints)).filter((l) => l.includes('preconnect')),
    ).toEqual([]);
  });

  it('opens no connection to the page own origin spelled with a default port or upper-case host', async () => {
    for (const imageBase of [
      'https://MOTORFIX.ro:443/img',
      'HTTPS://motorfix.ro/img',
    ]) {
      const text = await headOf('/ro', hintsFor(imageBase));
      expect(text).not.toContain('preconnect');
    }
  });

  it('writes the origin only, never the path of the image base', async () => {
    const text = await headOf(
      '/ro',
      hintsFor('https://img.example.com:8443/a/b?c=d#e'),
    );

    expect(links(text)).toContain(
      '<link rel="preconnect" href="https://img.example.com:8443">',
    );
  });

  it('writes no hint for an image base that has no origin', async () => {
    for (const imageBase of [
      'data:image/png;base64,AAAA',
      'file:///var/img',
      'javascript:alert(1)',
      '',
    ]) {
      const text = await headOf('/ro', hintsFor(imageBase));
      expect(text).not.toContain('href="null"');
      expect(text).not.toContain('preconnect');
    }
  });

  it('writes no hint for a relative image base even when the site origin is unknown', async () => {
    const text = await headOf('/ro', hintsFor('/api/v1/images', undefined));

    expect(text).not.toContain('preconnect');
  });

  it('keeps the tiles hint, with crossorigin, when the image base is same-origin', async () => {
    const text = await headOf('/en/garages?city=cluj', hintsFor('/img'));

    expect(links(text).filter((l) => l.includes('preconnect'))).toEqual([
      '<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>',
    ]);
  });

  it('writes at most two connection hints on any page', async () => {
    for (const path of [
      '/',
      '/ro',
      '/en/garages',
      '/ro/garages?x=1',
      '/en/garages/a-b',
      '/ro/garages/',
    ]) {
      const text = await headOf(path);
      expect(
        links(text).filter((l) => l.includes('preconnect')).length,
      ).toBeLessThanOrEqual(2);
    }
  });

  it('draws no map hint on a path that only starts like the results', async () => {
    for (const path of [
      '/ro/garages-near-me',
      '/ro/garagesX?x=1',
      '/xx/garages',
      '/ro/garages/map',
      '/ro/account/garages',
    ]) {
      expect(await headOf(path)).not.toContain('tiles.openfreemap.org');
    }
  });

  it('draws the map hint on the results with an empty or odd query', async () => {
    for (const path of ['/ro/garages?', '/en/garages?q=%00&a[]=1']) {
      expect(await headOf(path)).toContain('tiles.openfreemap.org');
    }
  });
});

// @traces 1193-FR-010
describe('the font preload under hostile input', () => {
  it('preloads exactly one font on every path, whatever its shape', async () => {
    for (const path of [
      '/',
      '',
      '/en',
      '/ro',
      '/en/',
      '/english',
      '/en?x=1',
      '/en#f',
      '/EN/garages',
      '/engine',
      '/fr/x',
    ]) {
      const preloads = links(await headOf(path)).filter((l) =>
        l.includes('rel="preload"'),
      );
      expect(preloads).toHaveLength(1);
    }
  });

  it('gives the Latin file to English and the Latin Extended file to Romanian, and to a path that only starts with en', async () => {
    const ro = hintsFor('https://img.example.com');
    expect(await headOf('/en', ro)).toContain(
      'michroma-latin-400-normal.woff2',
    );
    expect(await headOf('/en/garages', ro)).toContain(
      'michroma-latin-400-normal.woff2',
    );
    expect(await headOf('/english', ro)).toContain(
      'michroma-latin-ext-400-normal.woff2',
    );
    expect(await headOf('/engine/x', ro)).toContain(
      'michroma-latin-ext-400-normal.woff2',
    );
  });

  it('finds the built file of each language even when the other language is listed first', async () => {
    mkdirSync(join(dist, 'media'));
    for (const f of [
      'michroma-latin-ext-400-normal-ABC123.woff2',
      'michroma-latin-400-normal-XYZ789.woff2',
      'michroma-latin-400-normal-XYZ789.woff',
      'michroma-latin-400-normal-XYZ789.woff2.map',
    ])
      writeFileSync(join(dist, 'media', f), '');
    const hints = hintsFor('https://img.example.com');

    expect(hints.fonts).toEqual({
      en: '/media/michroma-latin-400-normal-XYZ789.woff2',
      ro: '/media/michroma-latin-ext-400-normal-ABC123.woff2',
    });
  });

  it('falls back to the unbuilt names when the dist folder does not exist', () => {
    const hints = headHints({
      distFolder: join(dist, 'nope'),
      imageBase: '/i',
      siteOrigin: SITE,
    });

    expect(hints.fonts).toEqual({
      en: '/media/michroma-latin-400-normal.woff2',
      ro: '/media/michroma-latin-ext-400-normal.woff2',
    });
  });

  it('carries as, type and crossorigin on the one preload', async () => {
    const [preload] = links(await headOf('/ro')).filter((l) =>
      l.includes('preload'),
    );

    expect(preload).toMatch(/as="font"/);
    expect(preload).toMatch(/type="font\/woff2"/);
    expect(preload).toMatch(/crossorigin/);
  });
});

// @traces 1193-FR-006
describe('the response handed back', () => {
  it('returns a response that is not html untouched', async () => {
    const json = new Response('{"a":1}', {
      headers: { 'content-type': 'application/json' },
    });

    const out = await withHeadHints(
      '/ro',
      json,
      hintsFor('https://img.example.com'),
    );

    expect(out).toBe(json);
  });

  it('returns a response with no content type untouched', async () => {
    const bare = new Response('<head></head>');
    bare.headers.delete('content-type');

    expect(await withHeadHints('/ro', bare, hintsFor('/i'))).toBe(bare);
  });

  it('returns an html answer with no body untouched', async () => {
    const empty = new Response(null, {
      headers: { 'content-type': 'text/html' },
      status: 304,
    });

    expect(await withHeadHints('/ro', empty, hintsFor('/i'))).toBe(empty);
  });

  it('keeps status, status text and headers, and drops the length that no longer holds', async () => {
    const original = htmlResponse(page, {
      headers: {
        'content-length': String(page.length),
        'content-type': 'text/html',
        etag: 'W/"1"',
        'x-a': 'b',
      },
      status: 404,
      statusText: 'Not Found',
    });

    const out = await withHeadHints(
      '/ro',
      original,
      hintsFor('https://img.example.com'),
    );

    expect(out.status).toBe(404);
    expect(out.statusText).toBe('Not Found');
    expect(out.headers.get('etag')).toBe('W/"1"');
    expect(out.headers.get('x-a')).toBe('b');
    expect(out.headers.get('content-length')).toBeNull();
  });

  it('keeps the page text byte for byte apart from the hints, multi-byte text included', async () => {
    const body =
      '<html><head><title>Găsește ținta 🚗</title></head><body>ș ț Ș Ț</body></html>';

    const out = await (
      await withHeadHints('/ro', htmlResponse(body), hintsFor('/i'))
    ).text();

    expect(out.replace(/<link [^>]*>/g, '')).toBe(body);
  });

  it('puts the hints before </head> when the closing tag is split across chunks', async () => {
    const enc = new TextEncoder();
    const chunks = [
      '<html><head><title>t</title></he',
      'ad><body>b</body></html>',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });

    const out = await (
      await withHeadHints(
        '/ro',
        htmlResponse(stream),
        hintsFor('https://img.example.com'),
      )
    ).text();

    expect(out.indexOf('rel="preload"')).toBeGreaterThan(-1);
    expect(out.indexOf('rel="preload"')).toBeLessThan(out.indexOf('</head>'));
    expect(out.match(/rel="preload"/g)).toHaveLength(1);
  });

  it('splits a multi-byte character across chunks without corrupting it', async () => {
    const bytes = new TextEncoder().encode(
      '<html><head></head><body>ș</body></html>',
    );
    const cut = bytes.indexOf(0xc8) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });

    const out = await (
      await withHeadHints('/ro', htmlResponse(stream), hintsFor('/i'))
    ).text();

    expect(out).toContain('<body>ș</body>');
  });

  it('hints once when a page holds the text </head> again later', async () => {
    const body =
      '<html><head></head><body><script>"</head>"</script></body></html>';

    const out = await (
      await withHeadHints('/ro', htmlResponse(body), hintsFor('/i'))
    ).text();

    expect(out.match(/rel="preload"/g)).toHaveLength(1);
  });

  it('hints once for an html page of ten thousand chunks', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('<html><head></head><body>'));
        for (let i = 0; i < 10_000; i++)
          controller.enqueue(enc.encode('<p>x</p>'));
        controller.enqueue(enc.encode('</body></html>'));
        controller.close();
      },
    });

    const out = await (
      await withHeadHints('/ro', htmlResponse(stream), hintsFor('/i'))
    ).text();

    expect(out.match(/rel="preload"/g)).toHaveLength(1);
    expect(out.match(/<p>x<\/p>/g)).toHaveLength(10_000);
  });
});
