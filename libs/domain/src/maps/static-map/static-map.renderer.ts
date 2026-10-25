import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { project, type StaticMapView } from '@motor-fix/contracts/map-view';
import { Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { PbfReader } from 'pbf';
import sharp from 'sharp';

import {
  PALETTES,
  ROAD_GROUPS,
  type RoadGroup,
  roadWidth,
} from './static-map.palette';

export const TILE_TIMEOUT_MS = 2000;
export const RENDER_TIMEOUT_MS = 5000;
const TILEJSON_TTL_MS = 60 * 60 * 1000;
// The provider's tiles stop at 14; a closer view scales those up.
const TILE_ZOOM_MAX = 14;
const TILE_PX = 512;
const WEBP_QUALITY = 75;

export class MapTilesUnavailable extends Error {
  override readonly name = 'MapTilesUnavailable';
}

export interface RendererOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  tileTimeoutMs?: number;
  renderTimeoutMs?: number;
}

// A tile's own coordinates, 0 to its extent.
interface Point {
  x: number;
  y: number;
}

interface Tile {
  x: number;
  y: number;
  data: VectorTile | null;
}

type Palette = (typeof PALETTES)[keyof typeof PALETTES];

// Polygons in the order the styles paint them, ground first; water running
// in a tunnel is under the ground and not drawn.
const FILLS: {
  layer: string;
  colour: (p: Palette, cls: unknown, brunnel?: unknown) => string | null;
}[] = [
  {
    colour: (p, cls) =>
      cls === 'wood' ? p.wood : cls === 'grass' ? p.grass : null,
    layer: 'landcover',
  },
  {
    colour: (p, cls) => (cls === 'residential' ? p.residential : null),
    layer: 'landuse',
  },
  { colour: (p) => p.park, layer: 'park' },
  {
    colour: (p, _cls, brunnel) => (brunnel === 'tunnel' ? null : p.water),
    layer: 'water',
  },
];
const ROAD_ORDER: RoadGroup[] = ['path', 'minor', 'major'];

const tracer = () => trace.getTracer('motorfix');

// Draws one view of the map as WebP from the provider's vector tiles, in the
// colours of the interactive map, so the page has a picture before MapLibre.
export class StaticMapRenderer {
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly tileTimeoutMs: number;
  private readonly renderTimeoutMs: number;
  private readonly logger = new Logger('StaticMapRender');
  private tileUrl: { template: string; at: number } | null = null;

  constructor(
    private readonly tileJsonUrl: string,
    options: RendererOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.tileTimeoutMs = options.tileTimeoutMs ?? TILE_TIMEOUT_MS;
    this.renderTimeoutMs = options.renderTimeoutMs ?? RENDER_TIMEOUT_MS;
  }

  render(view: StaticMapView): Promise<Buffer> {
    const tz = Math.min(view.z, TILE_ZOOM_MAX);
    const scale = 2 ** (view.z - tz);
    const centre = project(view, view.z);
    const left = centre.x - view.w / 2;
    const top = centre.y - view.h / 2;
    const span = TILE_PX * scale;
    const xs = range(
      Math.floor(left / span),
      Math.floor((left + view.w - 1e-9) / span),
    );
    const ys = range(
      Math.floor(top / span),
      Math.floor((top + view.h - 1e-9) / span),
    );
    const off = this.tileJsonUrl === 'off';

    return tracer().startActiveSpan('static-map.render', async (span) => {
      span.setAttributes({
        'map.height': view.h,
        'map.theme': view.theme,
        'map.tiles': off ? 0 : xs.length * ys.length,
        'map.width': view.w,
        'map.zoom': view.z,
      });
      try {
        const tiles = off ? [] : await this.tilesWithin(tz, xs, ys);
        const svg = draw(view, tiles, { left, scale, top });
        return await sharp(Buffer.from(svg))
          .webp({ quality: WEBP_QUALITY })
          .toBuffer();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (error instanceof MapTilesUnavailable) {
          this.logger.warn(
            `static map not drawn zoom=${view.z} theme=${view.theme} outcome=tiles_failed`,
          );
        }
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async tilesWithin(
    tz: number,
    xs: number[],
    ys: number[],
  ): Promise<Tile[]> {
    const abort = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new MapTilesUnavailable('the tiles took too long'));
      }, this.renderTimeoutMs);
    });
    try {
      const work = (async () => {
        const template = await this.template(abort.signal);
        const count = 2 ** tz;
        return Promise.all(
          xs.flatMap((x) =>
            ys
              .filter((y) => y >= 0 && y < count)
              .map((y) => this.tile(template, tz, x, y, count, abort.signal)),
          ),
        );
      })();
      return await Promise.race([work, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The tile address from the provider's TileJSON, kept an hour: the
  // provider moves it to each new build.
  private async template(signal: AbortSignal): Promise<string> {
    if (this.tileUrl && this.now() - this.tileUrl.at < TILEJSON_TTL_MS) {
      return this.tileUrl.template;
    }
    const answer = await this.get(this.tileJsonUrl, signal);
    if (!answer.ok)
      throw new MapTilesUnavailable(`tile address ${answer.status}`);
    const body = (await answer.json().catch(() => null)) as {
      tiles?: unknown;
    } | null;
    const [template] = Array.isArray(body?.tiles) ? body.tiles : [];
    if (typeof template !== 'string')
      throw new MapTilesUnavailable('no tile address');
    this.tileUrl = { at: this.now(), template };
    return template;
  }

  private tile(
    template: string,
    z: number,
    x: number,
    y: number,
    count: number,
    signal: AbortSignal,
  ): Promise<Tile> {
    // The world wraps east and west.
    const wrapped = ((x % count) + count) % count;
    const url = template
      .replace('{z}', String(z))
      .replace('{x}', String(wrapped))
      .replace('{y}', String(y));
    return tracer().startActiveSpan('static-map.tile', async (span) => {
      try {
        const answer = await this.get(url, signal);
        span.setAttribute('http.response.status_code', answer.status);
        // No data there: the open sea, or past the edge of the build.
        if (answer.status === 404) return { data: null, x, y };
        if (!answer.ok) throw new MapTilesUnavailable(`tile ${answer.status}`);
        return {
          data: decode(new Uint8Array(await answer.arrayBuffer())),
          x,
          y,
        };
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error instanceof MapTilesUnavailable
          ? error
          : new MapTilesUnavailable('tile not read', { cause: error });
      } finally {
        span.end();
      }
    });
  }

  private async get(url: string, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetch(url, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(this.tileTimeoutMs),
        ]),
      });
    } catch (error) {
      throw new MapTilesUnavailable('provider not reached', { cause: error });
    }
  }
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

// Parses every layer the drawing reads, so bytes that are no tile fail here
// rather than half-way through the picture.
function decode(bytes: Uint8Array): VectorTile {
  try {
    const tile = new VectorTile(new PbfReader(bytes));
    for (const name of [
      'landuse',
      'landcover',
      'park',
      'water',
      'transportation',
    ]) {
      const layer = tile.layers[name];
      for (let i = 0; i < (layer?.length ?? 0); i++)
        layer?.feature(i).loadGeometry();
    }
    return tile;
  } catch (error) {
    throw new MapTilesUnavailable('not a vector tile', { cause: error });
  }
}

interface Frame {
  left: number;
  top: number;
  scale: number;
}

const fixed = (n: number) => Math.round(n * 100) / 100;

function pathOf(
  rings: Point[][],
  toImage: (p: Point) => [number, number],
  close: boolean,
) {
  return rings
    .map((ring) => {
      const points = ring.map((p) => toImage(p).map(fixed).join(' '));
      return `M${points.join('L')}${close ? 'Z' : ''}`;
    })
    .join('');
}

type Bucket = Map<string, string[]>;

function draw(view: StaticMapView, tiles: Tile[], frame: Frame): string {
  const palette = PALETTES[view.theme];
  // One set of paths per fill layer and colour, painted in the styles' order;
  // filled nonzero, since the tiles' buffers overlap and evenodd would cancel
  // them out at the seams (a hole winds the other way and stays a hole).
  const fills = FILLS.map((): Bucket => new Map());
  const roads: Bucket = new Map();
  for (const tile of tiles) {
    for (const [index, fill] of FILLS.entries()) {
      collect(tile, fill.layer, frame, fills[index], true, (feature) =>
        feature.type === 3
          ? fill.colour(
              palette,
              feature.properties['class'],
              feature.properties['brunnel'],
            )
          : null,
      );
    }
    collect(tile, 'transportation', frame, roads, false, (feature) =>
      feature.type === 2
        ? (ROAD_GROUPS[String(feature.properties['class'])] ?? null)
        : null,
    );
  }

  const layers = [
    `<rect width="100%" height="100%" fill="${palette.background}"/>`,
  ];
  for (const [colour, paths] of fills.flatMap((bucket) => [...bucket])) {
    layers.push(
      `<path fill="${colour}" fill-rule="nonzero" d="${paths.join('')}"/>`,
    );
  }
  for (const group of ROAD_ORDER) {
    const paths = roads.get(group);
    const width = roadWidth(view.theme, group, view.z);
    if (!paths || width <= 0) continue;
    layers.push(
      `<path fill="none" stroke="${palette[group]}" stroke-width="${fixed(width)}" stroke-linecap="round" stroke-linejoin="round" d="${paths.join('')}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${view.w}" height="${view.h}" viewBox="0 0 ${view.w} ${view.h}">${layers.join('')}</svg>`;
}

// Adds each feature of one layer of a tile to the bucket its key names;
// a feature with no key is not drawn.
function collect(
  tile: Tile,
  name: string,
  frame: Frame,
  into: Bucket,
  close: boolean,
  keyOf: (feature: VectorTileFeature) => string | null,
) {
  const layer = tile.data?.layers[name];
  if (!layer) return;
  const toImage = toImageOf(tile, layer.extent, frame);
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const key = keyOf(feature);
    if (!key) continue;
    const paths = into.get(key) ?? [];
    paths.push(pathOf(feature.loadGeometry(), toImage, close));
    into.set(key, paths);
  }
}

function toImageOf(tile: Tile, extent: number, { left, top, scale }: Frame) {
  const unit = (TILE_PX * scale) / extent;
  const x0 = tile.x * TILE_PX * scale - left;
  const y0 = tile.y * TILE_PX * scale - top;
  return (p: Point): [number, number] => [x0 + p.x * unit, y0 + p.y * unit];
}
