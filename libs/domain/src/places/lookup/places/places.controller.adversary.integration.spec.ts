import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { PLACES_LOOKUPS_PER_MINUTE } from './places.throttle';
import { AuthModule } from '../../../auth/auth.module';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  redisUrlFor,
} from '../../../notifications/notifications.testing';
import { PlacesModule } from '../../places.module';
import {
  PLACES_PROVIDER,
  type PlacesAnswer,
  type PlacesProvider,
} from '../../providers/places.provider';

const redisUrl = redisUrlFor(5);
serialDatabase(databaseUrl);

let answer: (q: string, lang: string) => Promise<PlacesAnswer>;
const calls: [string, string][] = [];
const provider: PlacesProvider = {
  name: 'scripted',
  search: (q, lang) => {
    calls.push([q, lang]);
    return answer(q, lang);
  },
};

let app: INestApplication;
let redis: Redis;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      PlacesModule.register({ provider: 'fake' }),
    ],
  })
    .overrideProvider(PLACES_PROVIDER)
    .useValue(provider)
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  redis = new Redis(redisUrl);
});

beforeEach(async () => {
  calls.length = 0;
  answer = async () => ({
    items: [{ label: 'Strada Exemplu 1, București', lat: 44.43, lng: 26.1 }],
  });
  const keys = await redis.keys('places:lookup:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await app.close();
  await redis.quit();
});

const get = (url: string) => request(app.getHttpServer()).get(url);
const lookup = (query: Record<string, string>) => get('/places').query(query);

describe('GET /places at its edges', () => {
  it('answers 200 for text of exactly three and exactly 200 characters', async () => {
    expect((await lookup({ q: 'Str' })).status).toBe(200);
    expect((await lookup({ q: 'a'.repeat(200) })).status).toBe(200);
    expect(calls.map(([q]) => q.length)).toEqual([3, 200]);
  });

  it('counts the length after trimming, so padding neither saves nor sinks a text', async () => {
    expect((await lookup({ q: `  ${'a'.repeat(200)}  ` })).status).toBe(200);
    expect((await lookup({ q: '  ab  ' })).status).toBe(400);
    expect((await lookup({ q: `${'a'.repeat(201)}` })).status).toBe(400);
    expect(calls).toEqual([['a'.repeat(200), 'ro']]);
  });

  it('counts three Romanian letters as three characters', async () => {
    expect((await lookup({ q: 'ăîș' })).status).toBe(200);
    expect(calls).toEqual([['ăîș', 'ro']]);
  });

  it.each([
    ['q given twice', '/places?q=Strada&q=Exemplu'],
    ['lang given twice', '/places?q=Strada&lang=ro&lang=en'],
    ['an upper-case language', '/places?q=Strada&lang=RO'],
    ['an empty language', '/places?q=Strada&lang='],
    ['an object-shaped q', '/places?q[a]=Strada'],
    ['an empty q', '/places?q='],
  ])('answers 400 to %s and never asks the provider', async (_, url) => {
    const res = await get(url);

    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers a hostile text with a status below 500 and passes it on whole', async () => {
    const q = "'; DROP TABLE garage; -- %00 <script>";
    const res = await lookup({ q });

    expect(res.status).toBe(200);
    expect(calls).toEqual([[q, 'ro']]);
  });

  it('refuses other methods on the route', async () => {
    const res = await request(app.getHttpServer())
      .post('/places')
      .send({ q: 'Strada Exemplu' });

    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('serves a visitor who presents a junk bearer token', async () => {
    const res = await get('/places?q=Strada')
      .set('Authorization', 'Bearer not.a.token')
      .set('Cookie', 'session=garbage');

    expect(res.status).toBe(200);
  });

  it('asks the provider again for the same text, keeping nothing of the first answer', async () => {
    await lookup({ q: 'Strada Exemplu' });
    await lookup({ q: 'Strada Exemplu' });

    expect(calls).toHaveLength(2);
  });
});

describe('GET /places answers from a misbehaving provider', () => {
  it('answers 503 search_unavailable, not 500, when the provider throws', async () => {
    answer = async () => {
      throw new Error('socket hang up with key=SECRET123');
    };

    const res = await lookup({ q: 'Strada' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('search_unavailable');
    expect(JSON.stringify(res.body)).not.toContain('SECRET123');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /places throttle', () => {
  it('lets the sixtieth call through and refuses the sixty-first', async () => {
    for (let n = 1; n <= PLACES_LOOKUPS_PER_MINUTE; n += 1) {
      expect((await lookup({ q: 'Strada' })).status).toBe(200);
    }

    const res = await lookup({ q: 'Strada' });

    expect(res.status).toBe(429);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is not escaped by sending a different forwarded address each time', async () => {
    for (let n = 1; n <= PLACES_LOOKUPS_PER_MINUTE; n += 1) {
      await lookup({ q: 'Strada' }).set('X-Forwarded-For', `10.0.0.${n}`);
    }

    const res = await lookup({ q: 'Strada' }).set(
      'X-Forwarded-For',
      '10.9.9.9',
    );

    expect(res.status).toBe(429);
  });

  it('gives every counter key an expiry within a minute', async () => {
    await lookup({ q: 'Strada' });

    const keys = await redis.keys('places:lookup:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    }
  });

  it('keeps the typed text out of every Redis key', async () => {
    await lookup({ q: 'Strada Secretă 99' });

    const keys = await redis.keys('*');
    expect(keys.filter((key) => key.includes('Secret'))).toEqual([]);
  });
});
