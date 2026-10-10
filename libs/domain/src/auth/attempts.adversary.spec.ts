import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { Attempts } from './attempts';

// A Redis that counts, expires nothing by itself, and keeps what it was sent.
function fake() {
  const counts = new Map<string, number>();
  const expires: Array<[string, number]> = [];
  const keys = () => [...counts.keys()];
  const multi = () => {
    const queued: Array<() => unknown> = [];
    const chain = {
      decr: (key: string) => {
        queued.push(() => counts.set(key, (counts.get(key) ?? 0) - 1).get(key));
        return chain;
      },
      exec: async () => queued.map((run) => [null, run()]),
      expire: (key: string, seconds: number) => {
        queued.push(() => expires.push([key, seconds]) && 1);
        return chain;
      },
      incr: (key: string) => {
        queued.push(() => counts.set(key, (counts.get(key) ?? 0) + 1).get(key));
        return chain;
      },
    };
    return chain;
  };
  const redis = {
    del: async (key: string) => (counts.delete(key) ? 1 : 0),
    expire: async (key: string, seconds: number) => {
      expires.push([key, seconds]);
      return 1;
    },
    get: async (key: string) =>
      counts.has(key) ? String(counts.get(key)) : null,
    incr: async (key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key);
    },
    multi,
  } as unknown as Redis;
  return { counts, expires, keys, redis };
}

const down = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('Redis did not answer');
    },
  },
) as unknown as Redis;

describe('the hourly limit on links and codes, attacked', () => {
  it('admits exactly 5 and refuses the 6th, 7th and 100th', async () => {
    const attempts = new Attempts(fake().redis);
    const id = randomUUID();
    const answers: boolean[] = [];
    for (let i = 0; i < 100; i++)
      answers.push(await attempts.admitContactChange(id));
    expect(answers.slice(0, 5)).toEqual([true, true, true, true, true]);
    expect(answers.slice(5).every((admitted) => admitted === false)).toBe(true);
  });

  it('keeps accounts apart, also ones that differ by case or padding', async () => {
    const attempts = new Attempts(fake().redis);
    for (let i = 0; i < 5; i++) await attempts.admitContactChange('Account-A');
    expect(await attempts.admitContactChange('Account-A')).toBe(false);
    expect(await attempts.admitContactChange('account-a')).toBe(true);
    expect(await attempts.admitContactChange('Account-A ')).toBe(true);
  });

  it('survives an empty and a huge account id and keeps the id out of the key', async () => {
    const { keys, redis } = fake();
    const attempts = new Attempts(redis);
    const huge = 'x'.repeat(100_000);
    expect(await attempts.admitContactChange('')).toBe(true);
    expect(await attempts.admitContactChange(huge)).toBe(true);
    expect(keys().every((key) => key.length < 200)).toBe(true);
    expect(keys().some((key) => key.includes('xxxxxxxx'))).toBe(false);
  });

  it('gives the counter an hour to live', async () => {
    const { expires, redis } = fake();
    await new Attempts(redis).admitContactChange(randomUUID());
    expect(expires.map(([, seconds]) => seconds)).toContain(3600);
  });

  it('does not share its counter with the sign-in code limit of the same string', async () => {
    const { keys, redis } = fake();
    const attempts = new Attempts(redis);
    await attempts.admitContactChange('+40722123456');
    await attempts.admitPhoneCode('+40722123456', '198.51.100.7');
    expect(new Set(keys()).size).toBe(keys().length);
    expect(keys().length).toBeGreaterThanOrEqual(4);
  });

  it('admits and logs when Redis fails, every time', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const attempts = new Attempts(down);
    for (let i = 0; i < 10; i++) {
      expect(await attempts.admitContactChange(randomUUID())).toBe(true);
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('admits when the transaction answers nothing at all', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const redis = {
      multi: () => {
        const chain = {
          exec: async () => null,
          expire: () => chain,
          incr: () => chain,
        };
        return chain;
      },
    } as unknown as Redis;
    expect(await new Attempts(redis).admitContactChange(randomUUID())).toBe(
      true,
    );
    warn.mockRestore();
  });
});

describe('the wrong-current-password limit, attacked', () => {
  it('is open at 0 to 4 failures and closed from the 5th', async () => {
    const attempts = new Attempts(fake().redis);
    const id = randomUUID();
    const seen: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(await attempts.passwordBlocked(id));
      await attempts.passwordFailed(id);
    }
    expect(seen).toEqual([false, false, false, false, false, true]);
  });

  it('stays closed after many more failures', async () => {
    const attempts = new Attempts(fake().redis);
    const id = randomUUID();
    for (let i = 0; i < 50; i++) await attempts.passwordFailed(id);
    expect(await attempts.passwordBlocked(id)).toBe(true);
  });

  it('renews the 15 minutes on every counted failure, also past the 5th', async () => {
    const { expires, redis } = fake();
    const attempts = new Attempts(redis);
    const id = randomUUID();
    for (let i = 0; i < 7; i++) await attempts.passwordFailed(id);
    const fifteen = expires.filter(([, seconds]) => seconds === 900);
    expect(fifteen.length).toBe(7);
  });

  it('clears the count on success and opens again', async () => {
    const attempts = new Attempts(fake().redis);
    const id = randomUUID();
    for (let i = 0; i < 5; i++) await attempts.passwordFailed(id);
    await attempts.passwordClear(id);
    expect(await attempts.passwordBlocked(id)).toBe(false);
  });

  it('clearing twice, or an account that never failed, is harmless', async () => {
    const attempts = new Attempts(fake().redis);
    const id = randomUUID();
    await attempts.passwordClear(id);
    await attempts.passwordClear(id);
    expect(await attempts.passwordBlocked(id)).toBe(false);
  });

  it('counts per account, not for everyone', async () => {
    const attempts = new Attempts(fake().redis);
    for (let i = 0; i < 5; i++) await attempts.passwordFailed('a');
    expect(await attempts.passwordBlocked('a')).toBe(true);
    expect(await attempts.passwordBlocked('b')).toBe(false);
  });

  it("does not let password failures block the same account's sign-in by e-mail", async () => {
    const attempts = new Attempts(fake().redis);
    for (let i = 0; i < 5; i++) await attempts.passwordFailed('a@b.co');
    expect(await attempts.blocked('a@b.co', '198.51.100.7')).toBe(false);
  });

  it('does not let password failures use up the hourly send count', async () => {
    const attempts = new Attempts(fake().redis);
    const id = randomUUID();
    for (let i = 0; i < 10; i++) await attempts.passwordFailed(id);
    expect(await attempts.admitContactChange(id)).toBe(true);
  });

  it('fails open on all three calls when Redis fails', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const attempts = new Attempts(down);
    const id = randomUUID();
    expect(await attempts.passwordBlocked(id)).toBe(false);
    await expect(attempts.passwordFailed(id)).resolves.toBeUndefined();
    await expect(attempts.passwordClear(id)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the account id out of its keys', async () => {
    const { keys, redis } = fake();
    const id = 'secret-account-id-1234';
    await new Attempts(redis).passwordFailed(id);
    expect(keys().some((key) => key.includes(id))).toBe(false);
  });

  it('treats a garbage counter value as not blocked', async () => {
    const redis = { get: async () => 'not-a-number' } as unknown as Redis;
    expect(await new Attempts(redis).passwordBlocked(randomUUID())).toBe(false);
  });
});
