import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { PLACES_LOOKUPS_PER_MINUTE } from './places.throttle';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { PlacesModule } from '../places.module';
import {
  PLACES_PROVIDER,
  type PlacesAnswer,
  type PlacesProvider,
} from '../providers/places.provider';

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

async function boot(
  config: Parameters<typeof PlacesModule.register>[0] = { provider: 'fake' },
) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      PlacesModule.register(config),
    ],
  })
    .overrideProvider(PLACES_PROVIDER)
    .useValue(provider)
    .compile();
  const nest = moduleRef.createNestApplication();
  nest.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await nest.init();
  return nest;
}

beforeAll(async () => {
  app = await boot();
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

const lookup = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/places').query(query);

describe('GET /places', () => {
  it('answers a visitor with the suggestions, trimmed text, Romanian by default', async () => {
    const res = await lookup({ q: '  Strada Exemplu  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [{ label: 'Strada Exemplu 1, București', lat: 44.43, lng: 26.1 }],
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['Strada Exemplu', 'ro']]);
  });

  it('passes the language asked for', async () => {
    await lookup({ lang: 'en', q: 'Strada Exemplu' });

    expect(calls).toEqual([['Strada Exemplu', 'en']]);
  });

  it('answers an empty list when nothing matches', async () => {
    answer = async () => ({ items: [] });

    const res = await lookup({ q: 'Strada Nicăieri' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('sends at most five, all inside Romania, whatever the provider gave', async () => {
    const inside = Array.from({ length: 6 }, (_, n) => ({
      label: `Strada Exemplu ${n + 1}, București`,
      lat: 44.43,
      lng: 26.1,
    }));
    answer = async () => ({
      items: [{ label: 'Wien', lat: 48.2, lng: 16.37 }, ...inside],
    });

    const res = await lookup({ q: 'Strada Exemplu' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(inside.slice(0, 5));
  });

  it('answers 503 search_unavailable when the provider throws', async () => {
    answer = async () => {
      throw new TypeError('broken');
    };

    const res = await lookup({ q: 'Strada Exemplu' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('search_unavailable');
  });

  it.each([
    ['text under three characters', { q: 'ab' }],
    ['text that is blank once trimmed', { q: '      ' }],
    ['text over 200 characters', { q: 'a'.repeat(201) }],
    ['no text', {}],
    ['a language it does not speak', { lang: 'de', q: 'Strada Exemplu' }],
    ['an unknown parameter', { q: 'Strada Exemplu', radius: '5' }],
  ])('answers 400 to %s without asking the provider', async (_, query) => {
    const res = await lookup(query);

    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 503 search_unavailable when the provider cannot answer, without its reason', async () => {
    answer = async () => ({ unavailable: 'timeout' });

    const res = await lookup({ q: 'Strada Exemplu' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('search_unavailable');
    expect(JSON.stringify(res.body)).not.toContain('timeout');
    expect(JSON.stringify(res.body)).not.toContain('Strada Exemplu');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it(`answers 429 places_rate_limited past ${PLACES_LOOKUPS_PER_MINUTE} a minute, without asking the provider`, async () => {
    for (let n = 0; n < PLACES_LOOKUPS_PER_MINUTE; n += 1) {
      expect((await lookup({ q: 'Strada Exemplu' })).status).toBe(200);
    }
    calls.length = 0;

    const res = await lookup({ q: 'Strada Exemplu' });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('places_rate_limited');
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(calls).toEqual([]);
  });
});

describe('GET /places with the limit set at boot', () => {
  let limited: INestApplication;

  beforeAll(async () => {
    limited = await boot({ lookupsPerMinute: 2, provider: 'fake' });
  });

  afterAll(async () => {
    await limited.close();
  });

  it('refuses the look-up past the limit it was given', async () => {
    const ask = () =>
      request(limited.getHttpServer())
        .get('/places')
        .query({ q: 'Strada Exemplu' });

    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
  });
});

it('gives the real provider the timeout it was booted with', async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      PlacesModule.register({
        apiKey: 'k',
        provider: 'geoapify',
        timeoutMs: 1500,
      }),
    ],
  }).compile();

  expect(moduleRef.get(PLACES_PROVIDER)).toMatchObject({ timeoutMs: 1500 });
  await moduleRef.close();
});
