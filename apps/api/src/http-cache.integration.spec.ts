import { randomUUID } from 'node:crypto';
import { get as httpGet, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, PRISMA, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

const PUBLIC_POLICY =
  'public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400';
const SOME_ID = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;
let token: string;
let brand: string;
let garage: { id: string; slug: string };
let allowlist: string[];

beforeAll(async () => {
  app = await api.start();
  const prisma = app.get(PRISMA);
  brand = `cache-${randomUUID()}`;
  await prisma.brand.create({
    data: { key: brand, name: `Marca ${brand}`, popularity: 1, slug: brand },
  });
  garage = await prisma.garage.create({
    data: {
      name: 'Service Auto Militari',
      slug: `m-${randomUUID()}`,
      status: 'approved',
    },
  });
  const { id: accountId } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `driver-${randomUUID()}` },
    name: 'Andrei',
    roles: ['driver'],
  });
  token = `Bearer ${signAccessToken({ accountId, role: 'driver' }, TEST_TOKEN_SECRET, Date.now())}`;
  allowlist = [
    `/api/v1/garages/${garage.slug}`,
    `/api/v1/home?brand=${brand}`,
    '/api/v1/brands/popular',
    '/api/v1/brands',
    '/api/v1/job-types',
    '/api/v1/public-holidays?year=2026',
  ];
}, 120_000);

afterAll(() => api.stop());

const get = (path: string) => request(app.getHttpServer()).get(path);

// No Vary, or Vary on the encoding alone. A redirect keeps Express's own
// `Vary: Accept`: it is no read answer and carries no public policy.
const varyOf = (path: string, res: request.Response) => [
  path,
  res.redirect ? 'Accept-Encoding' : (res.headers['vary'] ?? 'Accept-Encoding'),
];

// @traces 1182-FR-009 1182-FR-010 1182-FR-011 1182-FR-012
describe('cache headers on read routes', () => {
  it('gives each visitor read on the allowlist exactly the public policy', async () => {
    for (const path of allowlist) {
      const res = await get(path);

      expect([path, res.status, res.headers['cache-control']]).toEqual([
        path,
        200,
        PUBLIC_POLICY,
      ]);
      expect(res.headers['etag']).toMatch(/^W\//);
      expect(varyOf(path, res)).toEqual([path, 'Accept-Encoding']);
    }
  });

  it('names the garage tag on a cached profile', async () => {
    const res = await get(`/api/v1/garages/${garage.slug}`);

    expect(res.headers['cache-tag']).toBe(`garage:${garage.id}`);
  });

  it('gives no other visitor route the public policy', async () => {
    const opened = new Set(allowlist.map((path) => path.split('?')[0]));
    const paths = Object.entries(openApiDocument(app).paths)
      .filter(([, item]) => 'get' in item)
      .map(([path]) => path.replace(/\{[^}]+\}/g, SOME_ID))
      .filter((path) => !opened.has(path));
    expect(paths.length).toBeGreaterThan(10);

    for (const path of paths) {
      // An open public stream never ends; a malformed query answers at once.
      const target = path.endsWith('/live/public') ? `${path}?garages=x` : path;
      const res = await get(target);

      expect([path, String(res.headers['cache-control'] ?? '')]).not.toEqual([
        path,
        expect.stringContaining('public'),
      ]);
      expect(varyOf(path, res)).toEqual([path, 'Accept-Encoding']);
    }
  });

  it('gives a signed-in read private, no-cache, and keeps a no-store route’s own', async () => {
    const me = await get('/api/v1/me').set('Authorization', token);
    const search = await get(`/api/v1/search/garages?brand=${brand}`).set(
      'Authorization',
      token,
    );

    expect([me.status, me.headers['cache-control']]).toEqual([
      200,
      'private, no-cache',
    ]);
    expect(me.headers['etag']).toMatch(/^W\//);
    expect([search.status, search.headers['cache-control']]).toEqual([
      200,
      'no-store',
    ]);
  });

  it('gives a problem answer no public policy', async () => {
    const res = await get(`/api/v1/garages/nobody-${randomUUID()}`);

    expect(res.status).toBe(404);
    expect(String(res.headers['cache-control'] ?? '')).not.toContain('public');
  });

  it('answers an unchanged visitor read 304 with no body and the same policy', async () => {
    const path = `/api/v1/garages/${garage.slug}`;
    const first = await get(path);

    const again = await get(path).set('If-None-Match', first.headers['etag']);

    expect(again.status).toBe(304);
    expect(again.text ?? '').toBe('');
    expect(again.headers['cache-control']).toBe(PUBLIC_POLICY);
  });

  it('carries the same policy on HEAD', async () => {
    const res = await request(app.getHttpServer()).head(
      `/api/v1/garages/${garage.slug}`,
    );

    expect([res.status, res.headers['cache-control']]).toEqual([
      200,
      PUBLIC_POLICY,
    ]);
  });

  it('compresses nothing, the event stream included', async () => {
    const res = await get(`/api/v1/garages/${garage.slug}`).set(
      'Accept-Encoding',
      'gzip, br',
    );
    expect(res.headers['content-encoding']).toBeUndefined();

    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const stream = await new Promise<IncomingMessage>((resolve, reject) => {
      httpGet(
        {
          headers: { 'Accept-Encoding': 'gzip' },
          host: '127.0.0.1',
          path: `/api/v1/live/public?garages=${garage.id}`,
          port,
        },
        resolve,
      ).on('error', reject);
    });
    stream.destroy();

    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-encoding']).toBeUndefined();
    expect(stream.headers['cache-control']).toBe('no-cache');
  });
});
