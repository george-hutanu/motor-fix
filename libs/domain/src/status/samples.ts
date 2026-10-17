import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { TileKey } from './tiles';

export type SampleStore = Pick<
  Redis,
  'expire' | 'zadd' | 'zrangebyscore' | 'zremrangebyscore'
>;

const KEPT_MS = 10 * 60_000;
const WINDOW_MS = 5 * 60_000;

const keyOf = (tile: TileKey) => `status:samples:${tile}`;

// The member carries the time and a random tag too, so two equal latencies,
// even in the same millisecond, stay two samples.
export async function recordSample(
  store: SampleStore,
  tile: TileKey,
  latencyMs: number,
  now: Date,
): Promise<void> {
  const at = now.getTime();
  const key = keyOf(tile);
  const tag = randomUUID().slice(0, 8);
  await store.zadd(key, at, `${at}:${tag}:${latencyMs}`);
  await store.zremrangebyscore(key, '-inf', `(${at - KEPT_MS}`);
  await store.expire(key, KEPT_MS / 1000);
}

export async function medianLatency(
  store: SampleStore,
  tile: TileKey,
  now: Date,
): Promise<number | null> {
  const members = await store.zrangebyscore(
    keyOf(tile),
    `(${now.getTime() - WINDOW_MS}`,
    '+inf',
  );
  const values = members
    .map((member) => Number(member.slice(member.lastIndexOf(':') + 1)))
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}
