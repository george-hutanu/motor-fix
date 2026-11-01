import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StaticMapView } from '@motor-fix/contracts/map-view';
import sharp from 'sharp';

import { MapTilesUnavailable, StaticMapRenderer } from './static-map.renderer';

// A tile with data, so the view is not blank and its address is kept.
const FIXTURE = new Uint8Array(
  readFileSync(join(__dirname, 'fixture-tile.pbf')),
);
const TILEJSON = 'https://tiles.test/planet';
const TILE_URL = 'https://tiles.test/planet/{z}/{x}/{y}.pbf';
const VIEW: StaticMapView = {
  h: 320,
  lat: 44.4268,
  lng: 26.1025,
  theme: 'light',
  w: 390,
  z: 13,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const bytes = (data: Uint8Array | string, status = 200) =>
  new Response(data as BodyInit, { status });

function fetcher(
  tile: () => Response | Promise<Response>,
  tilejson = () => json({ tiles: [TILE_URL] }),
) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return url === TILEJSON ? tilejson() : tile();
  });
  return { calls, fn: fn as unknown as typeof fetch };
}

// No check here times the whole image (static-map.renderer.spec does), so
// every render gets a generous cap: drawing a 1280 x 1024 image alone can pass
// 400 ms on a slow CI runner. The tile timeout stays short.
const renderer = (fn: typeof fetch, url = TILEJSON) =>
  new StaticMapRenderer(url, {
    fetch: fn,
    renderTimeoutMs: 60_000,
    tileTimeoutMs: 200,
  });

// @traces 1196-FR-006 1196-FR-007
describe('StaticMapRenderer, dependencies failing', () => {
  it('draws the background colour at the asked size and calls nothing when the source is off', async () => {
    const fn = vi.fn();
    const image = await renderer(fn as unknown as typeof fetch, 'off').render({
      ...VIEW,
      h: 1024,
      w: 1280,
    });
    const meta = await sharp(image).metadata();

    expect(meta).toMatchObject({ format: 'webp', height: 1024, width: 1280 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('draws a different background for the dark theme than for the light one', async () => {
    const r = renderer(vi.fn() as unknown as typeof fetch, 'off');
    const pixel = async (theme: 'light' | 'dark') =>
      Array.from(
        (
          await sharp(await r.render({ ...VIEW, theme }))
            .raw()
            .toBuffer()
        ).subarray(0, 3),
      );

    expect(await pixel('dark')).not.toEqual(await pixel('light'));
  });

  it('refuses with map_tiles_unavailable when a tile answers 500', async () => {
    const { fn } = fetcher(() => bytes('', 500));
    await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('refuses when a tile answers 403 or 429', async () => {
    for (const status of [403, 429]) {
      const { fn } = fetcher(() => bytes('', status));
      await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
        MapTilesUnavailable,
      );
    }
  });

  it('draws an empty image of the right size when every tile answers 404', async () => {
    const { fn } = fetcher(() => bytes('', 404));
    const image = await renderer(fn).render(VIEW);

    expect(await sharp(image).metadata()).toMatchObject({
      format: 'webp',
      height: 320,
      width: 390,
    });
  });

  it('refuses when a tile body is not a vector tile', async () => {
    const { fn } = fetcher(() =>
      bytes(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f, 0x80])),
    );
    await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('refuses when a tile body is an HTML page', async () => {
    const { fn } = fetcher(() =>
      bytes('<html><body>Bad gateway</body></html>'),
    );
    await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('refuses when the fetch itself rejects', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('refuses when the TileJSON answers an error', async () => {
    const { fn } = fetcher(
      () => bytes('', 404),
      () => bytes('', 503),
    );
    await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('refuses when the TileJSON is not JSON', async () => {
    const { fn } = fetcher(
      () => bytes('', 404),
      () => bytes('<html>'),
    );
    await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('refuses when the TileJSON lists no tiles, or tiles that is no list', async () => {
    for (const body of [{}, { tiles: [] }, { tiles: 'x' }, null, []]) {
      const { fn } = fetcher(
        () => bytes('', 404),
        () => json(body),
      );
      await expect(renderer(fn).render(VIEW)).rejects.toBeInstanceOf(
        MapTilesUnavailable,
      );
    }
  });

  it('refuses a tile that never answers once the tile timeout passes', async () => {
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === TILEJSON
        ? json({ tiles: [TILE_URL] })
        : hang(null, init),
    ) as unknown as typeof fetch;
    // The whole-image limit is set far off, so only the tile limit can end it.
    const r = new StaticMapRenderer(TILEJSON, {
      fetch: fn,
      renderTimeoutMs: 60_000,
      tileTimeoutMs: 200,
    });

    await expect(r.render(VIEW)).rejects.toBeInstanceOf(MapTilesUnavailable);
  });

  it('refuses one failing tile among good ones instead of painting a partial image', async () => {
    let n = 0;
    const { fn } = fetcher(() => (n++ === 0 ? bytes('', 500) : bytes('', 404)));
    await expect(
      renderer(fn).render({ ...VIEW, h: 1024, w: 1280 }),
    ).rejects.toBeInstanceOf(MapTilesUnavailable);
  });
});

// @traces 1196-FR-004
describe('StaticMapRenderer, tiles asked for', () => {
  it('asks for tiles of zoom 14 at most, even at zoom 16', async () => {
    const { calls, fn } = fetcher(() => bytes('', 404));
    await renderer(fn).render({ ...VIEW, z: 16 });

    const zooms = calls
      .filter((c) => c !== TILEJSON)
      .map((c) => Number(c.split('/').slice(-3)[0]));
    expect(zooms.length).toBeGreaterThan(0);
    expect(Math.max(...zooms)).toBe(14);
  });

  it('asks for no tile twice and for no more than a few at the largest size', async () => {
    const { calls, fn } = fetcher(() => bytes('', 404));
    await renderer(fn).render({ ...VIEW, h: 1024, w: 1280, z: 14 });

    const tiles = calls.filter((c) => c !== TILEJSON);
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(tiles.length).toBeLessThanOrEqual(12);
  });

  it('reads the TileJSON once for two renders in a row', async () => {
    const { calls, fn } = fetcher(() => bytes(FIXTURE));
    const r = renderer(fn);
    await r.render(VIEW);
    await r.render(VIEW);

    expect(calls.filter((c) => c === TILEJSON)).toHaveLength(1);
  });

  it('draws the same image for the same view twice', async () => {
    const { fn } = fetcher(() => bytes('', 404));
    const r = renderer(fn);
    const a = await r.render(VIEW);
    const b = await r.render(VIEW);

    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('draws at the smallest and the lowest view without failing', async () => {
    const { fn } = fetcher(() => bytes('', 404));
    const image = await renderer(fn).render({ ...VIEW, h: 320, w: 320, z: 5 });

    expect(await sharp(image).metadata()).toMatchObject({
      height: 320,
      width: 320,
    });
  });
});
