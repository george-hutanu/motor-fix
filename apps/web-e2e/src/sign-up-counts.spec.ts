import { expect, test } from '@playwright/test';

import { clearSignUpCounts, redisToClear } from './sign-up-counts.js';

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

  test('clears the Redis at REDIS_URL when the run starts its own servers', () => {
    expect(redisToClear({ REDIS_URL: 'redis://localhost:6379' })).toBe(
      'redis://localhost:6379',
    );
  });

  test('never clears a deployed environment', () => {
    expect(
      redisToClear({
        BASE_URL: 'https://staging.example.test',
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toBeNull();
  });

  test('clears nothing without REDIS_URL', () => {
    expect(redisToClear({})).toBeNull();
    expect(redisToClear({ REDIS_URL: '' })).toBeNull();
  });
});
