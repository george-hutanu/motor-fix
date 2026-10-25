import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type StaticMapView, unproject } from '@motor-fix/contracts/map-view';
import sharp from 'sharp';

import { PALETTES } from './static-map.palette';
import {
  MapTilesUnavailable,
  RENDER_TIMEOUT_MS,
  StaticMapRenderer,
  TILE_TIMEOUT_MS,
} from './static-map.renderer';

// Written once with pbf's writer: one water square in the north-west
// quarter, one park in the north-east, a primary road across at 5/8 of the
// height and a minor road down the right from 0.7 of it.
const FIXTURE = readFileSync(join(__dirname, 'fixture-tile.pbf'));
const TILEJSON = 'https://tiles.test/planet';
const TILE_URL = 'https://tiles.test/planet/build/{z}/{x}/{y}.pbf';

// The middle of one zoom-14 tile in Bucharest: a 640-px image puts that tile
// at 64..576 on both axes, so a tile unit of 4096 is 512 image pixels.
const TILE = { x: 9380, y: 6022 };
const centre = unproject(
  { x: (TILE.x + 0.5) * 512, y: (TILE.y + 0.5) * 512 },
  14,
);
const view = (theme: 'light' | 'dark', z = 14): StaticMapView => ({
  ...centre,
  h: 640,
  theme,
  w: 640,
  z,
});
const at = (tx: number, ty: number) => [64 + tx / 8, 64 + ty / 8] as const;

type Answer = () => Promise<Response>;

function provider(tile: Answer = async () => new Response(FIXTURE)) {
  const calls: string[] = [];
  const fetch = jest.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === TILEJSON)
        return Response.json({ maxzoom: 14, tiles: [TILE_URL] });
      return Promise.race([
        tile(),
        new Promise<never>((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        ),
      ]);
    },
  ) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

async function pixel(image: Buffer, [x, y]: readonly [number, number]) {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

const hex = (colour: string) =>
  [1, 3, 5].map((i) => Number.parseInt(colour.slice(i, i + 2), 16));

// WebP at quality 75 moves a flat colour by a few levels.
function expectColour(actual: number[], expected: number[], tolerance = 6) {
  for (const [i, value] of actual.entries()) {
    expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

// @traces 1196-FR-004 1196-FR-006 1196-FR-007 1196-FR-020
describe('rendering a static map', () => {
  it('draws water, park and roads in the light palette', async () => {
    const { fetch } = provider();
    const image = await new StaticMapRenderer(TILEJSON, { fetch }).render(
      view('light'),
    );

    const meta = await sharp(image).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 640, 640]);
    expectColour(await pixel(image, at(1024, 1024)), hex(PALETTES.light.water));
    expectColour(await pixel(image, at(3072, 1024)), hex(PALETTES.light.park));
    expectColour(await pixel(image, at(2048, 2560)), hex(PALETTES.light.major));
    expectColour(await pixel(image, at(3584, 3600)), hex(PALETTES.light.minor));
    expectColour(
      await pixel(image, at(1024, 3500)),
      hex(PALETTES.light.background),
    );
  });

  it('draws the same ground in the dark palette', async () => {
    const { fetch } = provider();
    const image = await new StaticMapRenderer(TILEJSON, { fetch }).render(
      view('dark'),
    );

    expectColour(
      await pixel(image, at(1024, 1024)),
      hex(PALETTES.dark.water),
      4,
    );
    expectColour(
      await pixel(image, at(2048, 2560)),
      hex(PALETTES.dark.major),
      4,
    );
    expectColour(
      await pixel(image, at(1024, 3500)),
      hex(PALETTES.dark.background),
      4,
    );
  });

  it("uses the provider's own colours for the ground and the water", () => {
    expect(PALETTES.light.background).toBe('#f8f4f0');
    expect(PALETTES.light.water).toBe('#9ebdff');
    expect(PALETTES.dark.background).toBe('#0c0c0c');
    expect(PALETTES.dark.water).toBe('#1b1b1d');
  });

  it('asks the provider for the zoom-14 tiles that cover the image', async () => {
    const { calls, fetch } = provider();
    await new StaticMapRenderer(TILEJSON, { fetch }).render(view('light'));

    const tiles = calls.filter((url) => url !== TILEJSON).sort();
    expect(tiles).toEqual(
      [TILE.x - 1, TILE.x, TILE.x + 1]
        .flatMap((x) =>
          [TILE.y - 1, TILE.y, TILE.y + 1].map((y) => `${x}/${y}`),
        )
        .map((xy) => `https://tiles.test/planet/build/14/${xy}.pbf`)
        .sort(),
    );
  });

  it('draws a zoom past 14 from the zoom-14 tiles, scaled up', async () => {
    const { calls, fetch } = provider();
    const image = await new StaticMapRenderer(TILEJSON, { fetch }).render(
      view('light', 16),
    );

    expect(calls.filter((url) => url !== TILEJSON)).toEqual([
      `https://tiles.test/planet/build/14/${TILE.x}/${TILE.y}.pbf`,
    ]);
    // At zoom 16 the 640-px image is the middle 160 px of the zoom-14 tile:
    // the primary road at 5/8 of it lies 0.125 tile, 256 px, below the middle.
    expectColour(
      await pixel(image, [320, 320 + 256]),
      hex(PALETTES.light.major),
    );
  });

  it('reads the tile address once an hour', async () => {
    const { calls, fetch } = provider();
    let now = 0;
    const renderer = new StaticMapRenderer(TILEJSON, { fetch, now: () => now });

    await renderer.render(view('light'));
    now = 60 * 60 * 1000 - 1;
    await renderer.render(view('dark'));
    expect(calls.filter((url) => url === TILEJSON)).toHaveLength(1);

    now = 60 * 60 * 1000 + 1;
    await renderer.render(view('light'));
    expect(calls.filter((url) => url === TILEJSON)).toHaveLength(2);
  });

  it('draws the ground only, calling nobody, when the provider is off', async () => {
    const { fetch } = provider();
    const image = await new StaticMapRenderer('off', { fetch }).render(
      view('dark'),
    );

    expect(fetch).not.toHaveBeenCalled();
    for (const point of [at(1024, 1024), at(2048, 2560), [0, 0] as const]) {
      expectColour(await pixel(image, point), hex(PALETTES.dark.background), 4);
    }
  });

  it('draws a tile the provider has no data for as empty ground', async () => {
    const { fetch } = provider(async () => new Response('', { status: 404 }));
    const image = await new StaticMapRenderer(TILEJSON, { fetch }).render(
      view('light'),
    );

    expectColour(
      await pixel(image, at(1024, 1024)),
      hex(PALETTES.light.background),
    );
  });

  it('fails when a tile answers an error', async () => {
    const { fetch } = provider(
      async () => new Response('busy', { status: 503 }),
    );

    await expect(
      new StaticMapRenderer(TILEJSON, { fetch }).render(view('light')),
    ).rejects.toBeInstanceOf(MapTilesUnavailable);
  });

  it('fails when the tile address cannot be read', async () => {
    const fetch = jest.fn(async () => new Response('down', { status: 500 }));

    await expect(
      new StaticMapRenderer(TILEJSON, { fetch }).render(view('light')),
    ).rejects.toBeInstanceOf(MapTilesUnavailable);
  });

  it('fails on bytes that are no tile', async () => {
    const { fetch } = provider(
      async () => new Response(Buffer.from([0xff, 0xff, 0xff])),
    );

    await expect(
      new StaticMapRenderer(TILEJSON, { fetch }).render(view('light')),
    ).rejects.toBeInstanceOf(MapTilesUnavailable);
  });

  it('fails when one tile takes longer than its own limit', async () => {
    const { fetch } = provider(() => new Promise(() => undefined));
    const renderer = new StaticMapRenderer(TILEJSON, {
      fetch,
      renderTimeoutMs: 1000,
      tileTimeoutMs: 20,
    });

    await expect(renderer.render(view('light'))).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('fails when the whole image takes longer than its limit', async () => {
    const { fetch } = provider(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(new Response(FIXTURE)), 200),
        ),
    );
    const renderer = new StaticMapRenderer(TILEJSON, {
      fetch,
      renderTimeoutMs: 50,
      tileTimeoutMs: 1000,
    });

    await expect(renderer.render(view('light'))).rejects.toBeInstanceOf(
      MapTilesUnavailable,
    );
  });

  it('gives a tile 2 seconds and the image 5', () => {
    expect([TILE_TIMEOUT_MS, RENDER_TIMEOUT_MS]).toEqual([2000, 5000]);
  });
});
