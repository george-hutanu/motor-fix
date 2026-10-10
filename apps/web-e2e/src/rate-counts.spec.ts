import { expect } from '@playwright/test';

import { test } from './fixtures.js';
import globalSetup from './global-setup.js';
import { clearCounts, DRAFT_KEYS, SIGN_UP_KEYS } from './rate-counts.js';

// A Redis that holds plain keys and answers SCAN one key per page, so the
// cursor has to be followed to the end.
function keyStore(keys: string[]) {
  const store = new Set(keys);
  const redis = {
    async del(...names: string[]) {
      let gone = 0;
      for (const name of names) if (store.delete(name)) gone++;
      return gone;
    },
    async scan(cursor: string, _match: 'MATCH', pattern: string) {
      const prefix = pattern.replace(/\*$/, '');
      const all = [...store].sort();
      const at = Number(cursor);
      const page = all.slice(at, at + 1).filter((k) => k.startsWith(prefix));
      const next = at + 1 >= all.length ? '0' : String(at + 1);
      return [next, page] as [string, string[]];
    },
  };
  return { redis, store };
}

test.describe('the per-address counts a local run clears', () => {
  test('deletes every sign-up count and nothing else', async () => {
    const { redis, store } = keyStore([
      'auth:signup:address:aaa',
      'auth:fail:email:bbb',
      'auth:signup:address:ccc',
      'auth:reset:address:ddd',
    ]);

    expect(await clearCounts(redis, SIGN_UP_KEYS)).toBe(2);

    expect([...store].sort()).toEqual([
      'auth:fail:email:bbb',
      'auth:reset:address:ddd',
    ]);
  });

  // @traces 948-FR-001
  test('deletes every listing-draft create count and nothing else', async () => {
    const { redis, store } = keyStore([
      'listing-drafts:create:aaa',
      'auth:signup:address:bbb',
      'listing-drafts:create:ccc',
    ]);

    expect(await clearCounts(redis, DRAFT_KEYS)).toBe(2);

    expect([...store]).toEqual(['auth:signup:address:bbb']);
  });

  test('stops scanning after its page cap when the cursor never ends', async () => {
    let pages = 0;
    const endless = {
      del: async () => 0,
      scan: async () => {
        pages++;
        return ['1', []] as [string, string[]];
      },
    };

    expect(await clearCounts(endless, SIGN_UP_KEYS)).toBe(0);
    expect(pages).toBe(1000);
  });
});

test.describe('the global setup', () => {
  const before = {
    DATABASE_URL: process.env['DATABASE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
  };
  // Never the run's own stores: clearing its counts or resetting its accounts
  // mid-run would race the flows that use them.
  test.beforeEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['REDIS_URL'];
  });
  test.afterEach(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  // @traces 1130-FR-004
  test('stops the run, naming Redis and not its address, when Redis does not answer', async () => {
    process.env['REDIS_URL'] = 'redis://:secret@127.0.0.1:1';

    const failed = await globalSetup().then(
      () => 'went on',
      (error: Error) => error.message,
    );

    expect(failed).toMatch(/Redis did not answer/);
    expect(failed).not.toMatch(/secret|127\.0\.0\.1/);
  });

  // @traces 1130-FR-004
  test('stops the run, naming PostgreSQL and not its address, when PostgreSQL does not answer', async () => {
    process.env['DATABASE_URL'] = 'postgresql://me:secret@127.0.0.1:1/none';

    const failed = await globalSetup().then(
      () => 'went on',
      (error: Error) => error.message,
    );

    expect(failed).toMatch(/PostgreSQL did not answer/);
    expect(failed).not.toMatch(/secret|127\.0\.0\.1/);
  });

  // @traces 1130-FR-004
  test('lets the run go on without REDIS_URL and DATABASE_URL', async () => {
    await expect(globalSetup()).resolves.toBeUndefined();
  });
});
