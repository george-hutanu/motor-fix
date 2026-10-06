import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { Attempts, clientOf } from './attempts';

describe('the reset request limit', () => {
  const down = {
    multi: () => {
      throw new Error('Redis did not answer');
    },
  } as unknown as Redis;

  it('admits every request when Redis does not answer', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const attempts = new Attempts(down);
    for (let i = 0; i < 5; i++) {
      expect(
        await attempts.admitReset('andrei@example.test', '198.51.100.7'),
      ).toBe(true);
    }
    warn.mockRestore();
  });
});

describe('one client however its address is written', () => {
  it.each([
    ['an IPv4 address', '198.51.100.7', '198.51.100.7'],
    ['its IPv4-mapped form', '::ffff:198.51.100.7', '198.51.100.7'],
    ['its IPv4-mapped form in hex', '::ffff:c633:6407', '198.51.100.7'],
    ['an IPv6 address in capitals', '2001:DB8::ABCD', '2001:db8:0:0::/64'],
    ['the same, written out', '2001:db8:0:0:0:0:0:abcd', '2001:db8:0:0::/64'],
    ['another host of that /64', '2001:db8::1:2:3:4', '2001:db8:0:0::/64'],
    ['an address with a zone id', 'fe80::1%eth0', 'fe80:0:0:0::/64'],
  ])('keys %s', (_, address, client) => {
    expect(clientOf(address)).toBe(client);
  });

  it.each([
    ['no address at all', ''],
    ['something that is no address', 'not-an-address'],
    ['an IPv4 address out of range', '999.1.1.1'],
    ['a zone id alone', '%eth0'],
  ])('has no client for %s', (_, address) => {
    expect(clientOf(address)).toBeNull();
  });
});

// Counts as Redis would, and keeps every command it was sent.
function countingRedis() {
  const counts = new Map<string, number>();
  const sent: unknown[][] = [];
  const run = (command: unknown[]) => {
    sent.push(command);
    const [name, key] = command as [string, string];
    if (name === 'incr') counts.set(key, (counts.get(key) ?? 0) + 1);
    if (name === 'decr') counts.set(key, (counts.get(key) ?? 0) - 1);
    return [null, name === 'expire' ? 1 : counts.get(key)];
  };
  const multi = () => {
    const queued: unknown[][] = [];
    const queue =
      (name: string) =>
      (...args: unknown[]) => {
        queued.push([name, ...args]);
        return chain;
      };
    const chain = {
      decr: queue('decr'),
      exec: async () => {
        sent.push(['multi']);
        return queued.map(run);
      },
      expire: queue('expire'),
      incr: queue('incr'),
    };
    return chain;
  };
  const redis = { multi } as unknown as Redis;
  return { counts, redis, sent };
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('the limits on sending a sign-in code', () => {
  const phone = '+40722123456';
  const address = '198.51.100.7';
  const minute = `auth:code:minute:${sha256(phone)}`;
  const hour = `auth:code:hour:${sha256(phone)}`;
  const byAddress = `auth:code:address:${sha256(address)}`;

  it('counts the number by the minute and by the hour, and the address by the hour, in one transaction', async () => {
    const { redis, sent } = countingRedis();

    expect(await new Attempts(redis).admitPhoneCode(phone, address)).toBe(true);

    expect(sent).toEqual([
      ['multi'],
      ['incr', minute],
      ['expire', minute, 60, 'NX'],
      ['incr', hour],
      ['expire', hour, 3600, 'NX'],
      ['incr', byAddress],
      ['expire', byAddress, 3600, 'NX'],
    ]);
  });

  it('keys the number and the address by their digest, never as they are', async () => {
    const { redis, sent } = countingRedis();

    await new Attempts(redis).admitPhoneCode(phone, address);

    const text = JSON.stringify(sent);
    expect(text).not.toContain('722123456');
    expect(text).not.toContain('198.51.100');
  });

  it('refuses a second code to the number within the minute', async () => {
    const { redis } = countingRedis();
    const attempts = new Attempts(redis);

    expect(await attempts.admitPhoneCode(phone, address)).toBe(true);
    expect(await attempts.admitPhoneCode(phone, '198.51.100.8')).toBe(false);
  });

  it('refuses a sixth code to the number within the hour', async () => {
    const { counts, redis } = countingRedis();
    const attempts = new Attempts(redis);

    for (let i = 0; i < 5; i++) {
      counts.delete(minute);
      expect(await attempts.admitPhoneCode(phone, address)).toBe(true);
    }
    counts.delete(minute);
    expect(await attempts.admitPhoneCode(phone, address)).toBe(false);
  });

  it('refuses a twenty-first request from the address within the hour', async () => {
    const { redis } = countingRedis();
    const attempts = new Attempts(redis);

    for (let i = 0; i < 20; i++) {
      expect(
        await attempts.admitPhoneCode(`+4072212${1000 + i}`, address),
      ).toBe(true);
    }
    expect(await attempts.admitPhoneCode('+40733000000', address)).toBe(false);
    expect(await attempts.admitPhoneCode('+40733000001', '198.51.100.8')).toBe(
      true,
    );
  });

  it('gives back the hourly count of a code that was never sent', async () => {
    const { counts, redis } = countingRedis();
    const attempts = new Attempts(redis);
    await attempts.admitPhoneCode(phone, address);

    await attempts.uncountPhoneCode(phone);

    expect(counts.get(hour)).toBe(0);
    expect(counts.get(byAddress)).toBe(1);
  });

  it('counts the number alone when the address cannot be read', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { redis, sent } = countingRedis();

    expect(await new Attempts(redis).admitPhoneCode(phone, '')).toBe(true);

    expect(sent.filter(([name]) => name === 'incr')).toEqual([
      ['incr', minute],
      ['incr', hour],
    ]);
    warn.mockRestore();
  });

  it('admits and logs, without the number, when Redis does not answer', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const down = {
      multi: () => {
        throw new Error('Redis did not answer');
      },
    } as unknown as Redis;
    const attempts = new Attempts(down);

    expect(await attempts.admitPhoneCode(phone, address)).toBe(true);
    await expect(attempts.uncountPhoneCode(phone)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      'phone-code attempt limits skipped: Redis unavailable',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('722123456');
    warn.mockRestore();
  });
});
