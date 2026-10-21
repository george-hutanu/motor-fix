import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { AddressThrottle } from './address-throttle';
import { redisUrlFor } from '../notifications/notifications.testing';

const store = new Redis(redisUrlFor(6));
const rule = (limit = 3) => ({
  key: `limit:adv-${randomUUID()}`,
  limit,
  name: 'AdversaryThrottle',
  windowSeconds: 3600,
});
const address = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;

afterEach(async () => {
  jest.restoreAllMocks();
  const keys = await store.keys('limit:adv-*');
  if (keys.length) await store.del(...keys);
});
afterAll(async () => {
  await store.quit();
});

// @traces 116-FR-032
describe('giving a counted request back', () => {
  it('lets the address use its whole share again after every take is given back', async () => {
    const throttle = new AddressThrottle(store, rule(3));
    const from = address();
    for (let i = 0; i < 3; i++) expect(await throttle.take(from)).toBeNull();
    expect(await throttle.take(from)).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 4; i++) await throttle.give(from);

    for (let i = 0; i < 3; i++) expect(await throttle.take(from)).toBeNull();
    expect(await throttle.take(from)).toBeGreaterThanOrEqual(1);
  });

  it('never takes the count below nothing, so a surplus give buys no extra request', async () => {
    const throttle = new AddressThrottle(store, rule(2));
    const from = address();
    await throttle.take(from);
    for (let i = 0; i < 10; i++) await throttle.give(from);

    expect(await throttle.take(from)).toBeNull();
    expect(await throttle.take(from)).toBeNull();
    expect(await throttle.take(from)).toBeGreaterThanOrEqual(1);
  });

  it('leaves no key behind when the address was never counted', async () => {
    const config = rule();
    const throttle = new AddressThrottle(store, config);

    await throttle.give(address());

    expect(await store.keys(`${config.key}:*`)).toEqual([]);
  });

  it('keeps the window running: a give does not strip or extend the key lifetime', async () => {
    const config = rule();
    const throttle = new AddressThrottle(store, config);
    const from = address();
    await throttle.take(from);
    await throttle.take(from);
    const [key] = await store.keys(`${config.key}:*`);
    await store.expire(key, 100);

    await throttle.give(from);

    const ttl = await store.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(100);
  });

  it('counts a mapped IPv4 address and the plain one as the same address when giving', async () => {
    const throttle = new AddressThrottle(store, rule(1));
    await throttle.take('198.51.100.7');

    await throttle.give('::ffff:198.51.100.7');

    expect(await throttle.take('198.51.100.7')).toBeNull();
  });

  it('ignores an unreadable address without throwing or touching other counts', async () => {
    const config = rule(1);
    const throttle = new AddressThrottle(store, config);
    const from = address();
    await throttle.take(from);

    for (const bad of ['', 'not an address', 'x'.repeat(5000)]) {
      await expect(throttle.give(bad)).resolves.toBeUndefined();
    }

    expect(await throttle.take(from)).toBeGreaterThanOrEqual(1);
  });

  it('swallows a store failure and says so in the log', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const broken = {
      eval: async () => {
        throw new Error('connection lost');
      },
    } as unknown as Redis;

    await expect(
      new AddressThrottle(broken, rule()).give(address()),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('give-back skipped: Redis unavailable');
  });

  it('keeps counts of other addresses apart', async () => {
    const throttle = new AddressThrottle(store, rule(1));
    const a = address();
    const b = '192.0.2.56';
    await throttle.take(a);
    await throttle.take(b);

    await throttle.give(a);

    expect(await throttle.take(a)).toBeNull();
    expect(await throttle.take(b)).toBeGreaterThanOrEqual(1);
  });
});
