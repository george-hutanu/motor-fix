import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { AdminAccountsService } from '../admin/admin-accounts/admin-accounts.service';
import { assistantThrottle } from '../auth/assistant/assistant.service';
import { Attempts, AUTH_REDIS } from '../auth/attempts';
import { ConsentThrottle } from '../auth/consents/consents.throttle';
import { EmailConfirmationService } from '../auth/email-confirmation/email-confirmation.service';
import { MaintenanceFlag } from '../auth/maintenance';
import { OAuthService } from '../auth/oauth/oauth.service';
import {
  approve,
  type OpenIdStub,
  startOpenIdStub,
  WEB,
} from '../auth/oauth/openid/openid-stub.testing';
import { oauthSettings } from '../auth/oauth/providers';
import { createPrisma } from '../auth/prisma';
import { CacheService, cacheKey, lockKey } from '../cache/cache.service';
import { purgeTags } from '../cache/purge';
import { warmCache } from '../cache/warm-up/warm-up';
import { BrandsService } from '../catalogue/brands.service';
import { ListingDraftThrottle } from '../garages/listing-drafts/listing-drafts.throttle';
import { ProfileViewsService } from '../insights/profile-views/profile-views.service';
import { ProfileViewsThrottle } from '../insights/profile-views/profile-views.throttle';
import {
  databaseUrl,
  redisUrlFor,
} from '../notifications/notifications.testing';
import { PlacesThrottle } from '../places/lookup/places/places.throttle';
import {
  dropSearches,
  GarageSearchCache,
} from '../search/garage-search/garage-search.cache';

// Logical database 15 is shared with other spec files running at the same
// time, so this one keeps to its own key prefix rather than flushing it.
const PREFIX = 'ttl-check:';
const ALLOWLIST: Record<string, string> = {
  'garage-search-gen:v1':
    'the search generation, a version number: must never expire',
};

const url = redisUrlFor(15);
const store = new Redis(url, { keyPrefix: PREFIX });
const plain = new Redis(url);
const prisma = createPrisma(databaseUrl);
let openId: OpenIdStub;

// Every key under the prefix with its time to live in seconds (-1: none).
async function lifetimes() {
  const found = new Map<string, number>();
  let cursor = '0';
  do {
    const [next, keys] = await plain.scan(
      cursor,
      'MATCH',
      `${PREFIX}*`,
      'COUNT',
      1000,
    );
    cursor = next;
    for (const key of keys) {
      found.set(key.slice(PREFIX.length), await plain.ttl(key));
    }
  } while (cursor !== '0');
  return found;
}

async function unexpired() {
  return [...(await lifetimes())]
    .filter(([key, ttl]) => ttl === -1 && !Object.hasOwn(ALLOWLIST, key))
    .map(([key]) => key)
    .sort();
}

async function clear() {
  const keys = [...(await lifetimes()).keys()];
  if (keys.length) await store.del(...keys);
}

beforeAll(async () => {
  await clear();
  openId = await startOpenIdStub();
});

afterAll(async () => {
  await clear();
  await openId.close();
  await prisma.$disconnect();
  store.disconnect();
  plain.disconnect();
});

const address = '203.0.113.7';
const accountId = randomUUID();
const entry = cacheKey('profile', 'a');
let lockLeft = -2;

const oauth = () =>
  new OAuthService(
    {
      oauth: oauthSettings('test', {
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_ISSUER: openId.issuer,
        PUBLIC_WEB_URL: WEB,
      }),
    } as never,
    {
      account: { findUnique: async () => null },
      accountIdentity: { findUnique: async () => null },
    } as never,
    store,
    { on: async () => false } as never,
    {} as never,
    {} as never,
    {} as never,
  );

const steps: [string, () => Promise<unknown>][] = [
  [
    'the sign-in, sign-up, reset, code, change and password counts',
    async () => {
      const attempts = new Attempts(store);
      await attempts.fail('driver@example.test', address);
      await attempts.admitSignUp(address);
      await attempts.admitReset('driver@example.test', address);
      await attempts.admitPhoneCode('+40710000000', address);
      await attempts.uncountPhoneCode('+40710000000');
      await attempts.admitContactChange(accountId);
      await attempts.uncountContactChange(accountId);
      await attempts.passwordFailed(accountId);
    },
  ],
  [
    'the per-address throttles',
    async () => {
      for (const throttle of [
        new ConsentThrottle(store),
        new PlacesThrottle(store),
        new ListingDraftThrottle(store),
        new ProfileViewsThrottle(store),
        assistantThrottle(store),
      ]) {
        await throttle.take(address);
      }
    },
  ],
  [
    'the confirmation link asks',
    () =>
      expect(
        new EmailConfirmationService(
          {
            account: {
              findUniqueOrThrow: async () => ({
                email: 'driver@example.test',
                emailVerifiedAt: null,
              }),
            },
            accountToken: { findFirst: async () => null },
          } as never,
          {} as never,
          {} as never,
          {},
          store,
          {} as never,
          {} as never,
          new Attempts(store),
        ).askAgainFor(accountId),
      ).rejects.toThrow('PUBLIC_WEB_URL is not set'),
  ],
  [
    'the OAuth flow and the pending sign-up',
    async () => {
      const service = oauth();
      await service.start('google', { language: 'ro', remember: false });
      const started = await service.start('google', {
        language: 'ro',
        remember: false,
      });
      const { code, state } = await approve(new URL(started?.url ?? ''));
      const outcome = await service.finish('google', state, { code, state });
      expect(outcome.result).toBe('consent');
    },
  ],
  [
    'the cache entries, tags, locks and purge marks',
    async () => {
      const cache = new CacheService(store);
      await purgeTags(store, ['garage:b']);
      await cache.read({
        key: entry,
        read: async () => {
          lockLeft = await plain.pttl(`${PREFIX}${lockKey(entry)}`);
          return { tags: ['garage:a'], value: { name: 'Service Auto' } };
        },
        soft: 60,
      });
    },
  ],
  [
    'the garage search pages and their generation',
    async () => {
      await new GarageSearchCache(store).entry(
        { brandId: 'b', kind: 'page' },
        async () => ({ items: [] }) as never,
      );
      await dropSearches(store, ['public:search']);
    },
  ],
  [
    'the active brands',
    () =>
      new BrandsService(
        { brand: { findMany: async () => [] } } as never,
        store,
      ).search(),
  ],
  [
    'the account totals',
    () => new AdminAccountsService(prisma, store).summary(new Date()),
  ],
  [
    'the maintenance flag',
    async () => {
      const flag = new MaintenanceFlag(store, {
        platformRule: { findUnique: async () => null },
      } as never);
      await flag.on();
      await flag.set(false);
    },
  ],
  [
    'the warm-up mark',
    () =>
      warmCache(
        {
          get: (token: unknown) => {
            if (token === AUTH_REDIS) return store;
            throw new Error('only the mark is written here');
          },
        } as never,
        'ttl-check',
      ),
  ],
  [
    'the profile view counters and their secret',
    async () => {
      const garageId = randomUUID();
      await new ProfileViewsService(
        { garage: { findFirst: async () => ({ id: garageId }) } } as never,
        store,
      ).record(garageId, { address, userAgent: 'Mozilla/5.0' }, 'search');
    },
  ],
];

// @traces 1175-FR-005
describe('every key the store holds', () => {
  const seen = new Set<string>();

  it.each(steps)('%s carry a time to live', async (_, run) => {
    await run();
    const written = [...(await lifetimes()).keys()].filter(
      (key) => !seen.has(key),
    );
    for (const key of written) seen.add(key);

    expect(written).not.toEqual([]);
    expect(await unexpired()).toEqual([]);
  });

  it('a cache lock among them, while it is held', () => {
    expect(lockLeft).toBeGreaterThan(0);
  });

  it('names a key written without one', async () => {
    await store.set('bare', '1');

    expect(await unexpired()).toEqual(['bare']);
    await store.del('bare');
  });
});
