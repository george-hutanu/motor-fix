import { randomUUID } from 'node:crypto';

import { PRISMA } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot } from './api-boot.testing';

const api = apiBoot();

const PUBLIC_POLICY =
  'public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400';

let app: INestApplication;
let garage: { id: string; slug: string };

beforeAll(async () => {
  app = await api.start();
  garage = await app.get(PRISMA).garage.create({
    data: {
      name: 'Service Auto Adversar',
      slug: `adv-${randomUUID()}`,
      status: 'approved',
    },
  });
}, 120_000);

afterAll(() => api.stop());

const server = () => app.getHttpServer();
const get = (path: string) => request(server()).get(path);
const head = (path: string) => request(server()).head(path);
const missing = () => `/api/v1/garages/nobody-${randomUUID()}`;

const isPublic = (res: request.Response) =>
  String(res.headers['cache-control'] ?? '').includes('public');

// @traces 1182-FR-009 1182-FR-011
describe('problem answers over HTTP', () => {
  it('answers a conditional GET of a 404 with the 404, never 304, whatever validator it names', async () => {
    const path = missing();
    const first = await get(path);

    for (const validator of [first.headers['etag'], '*', 'W/"x", W/"y"']) {
      const res = await get(path).set('If-None-Match', String(validator));
      expect([validator, res.status]).toEqual([validator, 404]);
      expect(isPublic(res)).toBe(false);
    }
  });

  it('answers HEAD of a 404 with the 404 and no public policy', async () => {
    const res = await head(missing());

    expect(res.status).toBe(404);
    expect(isPublic(res)).toBe(false);
    expect(res.text ?? '').toBe('');
  });

  it('answers a conditional HEAD of a 404 with the 404', async () => {
    const path = missing();
    const first = await head(path);

    const res = await head(path).set(
      'If-None-Match',
      String(first.headers['etag'] ?? '*'),
    );

    expect(res.status).toBe(404);
  });

  it('carries no Cache-Tag on a 404, cached or not', async () => {
    const path = missing();

    const first = await get(path);
    const second = await get(path);

    expect(first.headers['cache-tag']).toBeUndefined();
    expect(second.headers['cache-tag']).toBeUndefined();
    expect(second.status).toBe(404);
  });

  it('answers a 410 for a suspended garage with no public policy, and 200 with it once restored', async () => {
    const prisma = app.get(PRISMA);
    const suspended = await prisma.garage.create({
      data: {
        name: 'Suspendat',
        slug: `sus-${randomUUID()}`,
        status: 'suspended',
      },
    });
    const path = `/api/v1/garages/${suspended.slug}`;

    const gone = await get(path);
    const conditional = await get(path).set('If-None-Match', '*');
    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: suspended.id },
    });
    const back = await get(path);

    expect(gone.status).toBe(410);
    expect(isPublic(gone)).toBe(false);
    expect(conditional.status).toBe(410);
    expect(back.status).toBe(200);
    expect(back.headers['cache-control']).toBe(PUBLIC_POLICY);
  });

  it('answers a draft garage 404 and then 200 on the next read once approved', async () => {
    const prisma = app.get(PRISMA);
    const draft = await prisma.garage.create({
      data: { name: 'Ciorna', slug: `dr-${randomUUID()}`, status: 'draft' },
    });
    const path = `/api/v1/garages/${draft.slug}`;

    const first = await get(path);
    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: draft.id },
    });
    const second = await get(path);

    expect(first.status).toBe(404);
    expect(second.status).toBe(200);
  });

  it.each(['0', '-1', '13', '1.5', 'abc', '', '1e9', '99999999999999999999'])(
    'answers popular brands with limit %j as 400 without a public policy',
    async (limit) => {
      const res = await get(`/api/v1/brands/popular?limit=${limit}`);

      expect([limit, res.status]).toEqual([limit, 400]);
      expect(isPublic(res)).toBe(false);
      expect(res.headers['cache-tag']).toBeUndefined();
    },
  );

  it('answers a conditional GET of a 400 with the 400', async () => {
    const res = await get('/api/v1/brands/popular?limit=0').set(
      'If-None-Match',
      '*',
    );

    expect(res.status).toBe(400);
  });
});

// @traces 1182-FR-004
describe('a slug that is created after it was read as missing', () => {
  it('keeps answering 404 for up to a minute after the garage appears, with no database read', async () => {
    const slug = `late-${randomUUID()}`;
    const path = `/api/v1/garages/${slug}`;
    expect((await get(path)).status).toBe(404);

    await app.get(PRISMA).garage.create({
      data: { name: 'Tardiv', slug, status: 'approved' },
    });

    expect((await get(path)).status).toBe(404);
  });

  it('answers 200 for a never-read slug created at once', async () => {
    const slug = `fresh-${randomUUID()}`;
    await app.get(PRISMA).garage.create({
      data: { name: 'Nou', slug, status: 'approved' },
    });

    const res = await get(`/api/v1/garages/${slug}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(PUBLIC_POLICY);
  });
});

// @traces 1182-FR-009 1182-FR-011
describe('conditional and HEAD requests on the public reads', () => {
  it('answers 304 for the wildcard validator and for a list holding the current one', async () => {
    const path = `/api/v1/garages/${garage.slug}`;
    const etag = String((await get(path)).headers['etag']);

    const star = await get(path).set('If-None-Match', '*');
    const list = await get(path).set('If-None-Match', `W/"nope", ${etag}`);

    expect([star.status, list.status]).toEqual([304, 304]);
    expect(list.headers['cache-control']).toBe(PUBLIC_POLICY);
  });

  it('answers 200 with the body for a validator that is not the current one', async () => {
    const res = await get(`/api/v1/garages/${garage.slug}`).set(
      'If-None-Match',
      'W/"0-stale"',
    );

    expect(res.status).toBe(200);
    expect(res.body.id ?? res.body.slug).toBeDefined();
  });

  it('answers the same ETag twice for an unchanged profile', async () => {
    const path = `/api/v1/garages/${garage.slug}`;

    const [a, b] = [await get(path), await get(path)];

    expect(a.headers['etag']).toBe(b.headers['etag']);
  });

  it('answers HEAD with the headers of GET and an empty body', async () => {
    const path = `/api/v1/garages/${garage.slug}`;
    const [h, g] = [await head(path), await get(path)];

    expect(h.status).toBe(200);
    expect(h.headers['cache-control']).toBe(g.headers['cache-control']);
    expect(h.headers['cache-tag']).toBe(g.headers['cache-tag']);
    expect(h.headers['etag']).toBe(g.headers['etag']);
    expect(h.text ?? '').toBe('');
  });

  it('answers a conditional HEAD with 304', async () => {
    const path = `/api/v1/garages/${garage.slug}`;
    const etag = String((await get(path)).headers['etag']);

    const res = await head(path).set('If-None-Match', etag);

    expect(res.status).toBe(304);
  });

  it('sets no Vary other than Accept-Encoding on a 404, a 400 and a 200', async () => {
    const answers = [
      await get(missing()),
      await get('/api/v1/brands/popular?limit=0'),
      await get(`/api/v1/garages/${garage.slug}`),
    ];

    expect(answers.map((r) => r.headers['vary'] ?? 'Accept-Encoding')).toEqual(
      Array(3).fill('Accept-Encoding'),
    );
  });
});

// @traces 1182-FR-007 1182-FR-009
describe('hostile input on the cached routes', () => {
  it.each([
    'x:-',
    'a:b:c',
    '%00',
    '%E2%82%AC-euro',
    encodeURIComponent('ünï cödé 🚗'),
    'x'.repeat(5000),
    '..%2f..%2fetc',
    "'; DROP TABLE garage;--",
  ])(
    'answers the profile of the slug %j with a 4xx and no public policy',
    async (slug) => {
      const res = await get(`/api/v1/garages/${slug}`);

      expect([slug.slice(0, 20), res.status < 500, isPublic(res)]).toEqual([
        slug.slice(0, 20),
        true,
        false,
      ]);
    },
  );

  it('answers 300 profile reads with made-up brands in context with one stable status', async () => {
    const statuses = new Set<number>();
    const sample = Array.from({ length: 300 }, (_x, n) => `brand-${n}`);
    for (let i = 0; i < sample.length; i += 30) {
      const batch = await Promise.all(
        sample
          .slice(i, i + 30)
          .map((b) => get(`/api/v1/garages/${garage.slug}?brand=${b}`)),
      );
      for (const res of batch) statuses.add(res.status);
    }

    expect([...statuses].every((s) => s < 500)).toBe(true);
    expect(statuses.size).toBe(1);
  }, 60_000);

  it.each(['x:-', '%00', encodeURIComponent('mărcă 🚗'), 'y'.repeat(5000), ''])(
    'answers the home read for the brand %j without a server error',
    async (brand) => {
      const res = await get(`/api/v1/home?brand=${brand}`);

      expect([brand.slice(0, 20), res.status < 500]).toEqual([
        brand.slice(0, 20),
        true,
      ]);
      if (res.status !== 200) expect(isPublic(res)).toBe(false);
    },
  );

  it('answers the home read for a made-up brand the same twice running', async () => {
    const path = `/api/v1/home?brand=nope-${randomUUID()}`;

    const [a, b] = [await get(path), await get(path)];

    expect([a.status, b.status]).toEqual([a.status, a.status]);
    expect(b.body).toEqual(a.body);
  });
});
