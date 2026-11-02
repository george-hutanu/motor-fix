import { snapCentre } from '@motor-fix/contracts/map-view';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';

import { MapTilesUnavailable, StaticMapRenderer } from './static-map.renderer';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { MapsModule } from '../maps.module';

// @traces 1196-FR-001 1196-FR-002 1196-FR-005 1196-FR-006 1196-FR-008 1196-FR-020

const redisUrl = redisUrlFor(3);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const CACHED =
  'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800';

const render =
  vi.fn<
    (...args: Parameters<StaticMapRenderer['render']>) => Promise<Buffer>
  >();
let app: NestExpressApplication;
let webp: Buffer;

beforeAll(async () => {
  webp = await sharp({
    create: { background: '#f8f4f0', channels: 3, height: 480, width: 640 },
  })
    .webp()
    .toBuffer();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        redisUrl,
        tokenSecret: 'test-secret',
      }),
      MapsModule.register({ tileJsonUrl: 'off' }),
    ],
  })
    .overrideProvider(StaticMapRenderer)
    .useValue({ render })
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  // The API's own pipe (apps/api/src/bootstrap.ts).
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  render.mockReset();
  render.mockResolvedValue(webp);
});

const QUERY = {
  h: 480,
  lat: 44.4268,
  lng: 26.1025,
  theme: 'light',
  w: 640,
  z: 13,
};
const get = (query: Record<string, unknown> = QUERY) =>
  request(app.getHttpServer()).get('/maps/static').query(query);

describe('the static map image', () => {
  it('answers a visitor with a WebP kept a day by the browser and a month at the edge', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe(CACHED);
    expect(res.headers['vary']).toBeUndefined();
    expect(Buffer.compare(res.body as Buffer, webp)).toBe(0);
  });

  it('renders and names the snapped centre, never the one asked for', async () => {
    const snapped = snapCentre(QUERY, 13, 640);
    const res = await get();

    expect(render).toHaveBeenCalledWith({ ...QUERY, ...snapped });
    expect([res.headers['x-map-lat'], res.headers['x-map-lng']]).toEqual([
      String(snapped.lat),
      String(snapped.lng),
    ]);
  });

  it.each([
    ['theme', 'sepia'],
    ['z', '17'],
    ['z', '12.5'],
    ['lat', '50'],
    ['lng', '19'],
    ['w', '500'],
    ['h', '1100'],
  ])(
    'refuses %s of %s with validation_failed, naming it, never cached',
    async (field, value) => {
      const res = await get({ ...QUERY, [field]: value });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(field);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(render).not.toHaveBeenCalled();
    },
  );

  it('refuses a query with a parameter missing', async () => {
    const { theme: _theme, ...rest } = QUERY;
    const res = await get(rest);

    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers map_tiles_unavailable with no image and no cache when the tiles fail', async () => {
    render.mockRejectedValue(new MapTilesUnavailable('tile 503'));

    const res = await get();

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'map_tiles_unavailable' });
    expect(res.headers['content-type']).not.toContain('image');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('writes no search log and tags nothing for purging', async () => {
    const before = await prisma.searchLog.count();

    const res = await get();

    expect(await prisma.searchLog.count()).toBe(before);
    expect(res.headers['cache-tag']).toBeUndefined();
    expect(res.headers['cdn-tag']).toBeUndefined();
  });

  it('refuses an address past its share of renders, never cached', async () => {
    const from = '203.0.113.9';
    app.set('trust proxy', true);
    let res = await get().set('X-Forwarded-For', from);
    for (let n = 1; n <= 240 && res.status === 200; n++) {
      res = await get().set('X-Forwarded-For', from);
    }
    app.set('trust proxy', false);

    expect(res.status).toBe(429);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
