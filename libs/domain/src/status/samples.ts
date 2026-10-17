import type { Redis } from 'ioredis';

import type { TileKey } from './tiles';

export type SampleStore = Pick<
  Redis,
  'expire' | 'zadd' | 'zrangebyscore' | 'zremrangebyscore'
>;

const KEPT_MS = 10 * 60_000;
const WINDOW_MS = 5 * 60_000;

const keyOf = (tile: TileKey) => `status:samples:${tile}`;

// The member carries the time too, so two equal latencies stay two samples.
export async function recordSample(
  store: SampleStore,
  tile: TileKey,
  latencyMs: number,
  now: Date,
): Promise<void> {
  const at = now.getTime();
  const key = keyOf(tile);
  await store.zadd(key, at, `${at}:${latencyMs}`);
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
    .map((member) => Number(member.slice(member.indexOf(':') + 1)))
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}
