import { expect, test } from '@playwright/test';

import globalSetup from './global-setup.js';
import { clearSignUpCounts } from './sign-up-counts.js';

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

test.describe('the sign-up counts a local run clears', () => {
  test('deletes every sign-up count and nothing else', async () => {
    const { redis, store } = keyStore([
      'auth:signup:address:aaa',
      'auth:fail:email:bbb',
      'auth:signup:address:ccc',
      'auth:reset:address:ddd',
    ]);

    expect(await clearSignUpCounts(redis)).toBe(2);

    expect([...store].sort()).toEqual([
      'auth:fail:email:bbb',
      'auth:reset:address:ddd',
    ]);
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

    expect(await clearSignUpCounts(endless)).toBe(0);
    expect(pages).toBe(1000);
  });
});

test.describe('the global setup', () => {
  const before = {
    DATABASE_URL: process.env['DATABASE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
  };
  // Never the run's own database: resetting its accounts mid-run would race
  // the flows that use them.
  test.beforeEach(() => {
    process.env['DATABASE_URL'] = 'postgresql://127.0.0.1:1/none';
  });
  test.afterEach(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test('lets the run go on when Redis does not answer', async () => {
    process.env['REDIS_URL'] = 'redis://127.0.0.1:1';

    await expect(globalSetup()).resolves.toBeUndefined();
  });

  test('lets the run go on without REDIS_URL', async () => {
    delete process.env['REDIS_URL'];

    await expect(globalSetup()).resolves.toBeUndefined();
  });

  test('lets the run go on when PostgreSQL does not answer, or without DATABASE_URL', async () => {
    delete process.env['REDIS_URL'];
    await expect(globalSetup()).resolves.toBeUndefined();

    delete process.env['DATABASE_URL'];
    await expect(globalSetup()).resolves.toBeUndefined();
  });
});
