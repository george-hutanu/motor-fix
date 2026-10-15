import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  type CacheKind,
  type CacheOutcome,
  recordCache,
} from './cache.metrics';
import { AUTH_REDIS } from '../auth/attempts';
import { requestContext } from '../logging';

// An entry is fresh until its soft expiry, then served stale while one read
// refreshes it, until Redis drops it 10 minutes later. A not-found or empty
// answer is kept 60 seconds and never served stale.
const STALE_MS = 600_000;
const NEGATIVE_SECONDS = 60;
// One reader per key across instances; a holder that dies frees it by then.
const LOCK_MS = 3000;
const POLL_MS = 50;

// The `v1` is the shape of what is stored: a change to it bumps the version.
// A part's own colons are escaped, so a slug or brand a visitor types never
// names another part's key.
export const cacheKey = (kind: CacheKind, ...parts: string[]) =>
  `v1:${kind}:${parts.map((part) => part.replaceAll('%', '%25').replaceAll(':', '%3A')).join(':')}`;
export const lockKey = (key: string) => `v1:lock:${key}`;
export const tagKey = (tag: string) => `v1:tag:${tag}`;
export const purgedKey = (tag: string) => `v1:purged:${tag}`;
export const kindOf = (key: string) => key.split(':')[1] as CacheKind;

// Lifetimes are jittered ×0.9–1.1 so entries written together do not expire
// together.
export function lifetimes(
  softSeconds: number,
  negative: boolean,
  random = Math.random,
) {
  const jitter = 0.9 + 0.2 * random();
  if (negative) {
    const ms = Math.floor(NEGATIVE_SECONDS * 1000 * jitter);
    return { hardMs: ms, softMs: ms };
  }
  const softMs = Math.floor(softSeconds * 1000 * jitter);
  return { hardMs: softMs + STALE_MS, softMs };
}

// What a read function answers: the value, the tags whose purge removes it,
// whether it is a not-found or empty answer, and the key to store it under
// when that is not the key read (an unknown brand fills the no-brand entry).
export interface Filled<T> {
  value: T;
  tags?: string[];
  negative?: boolean;
  key?: string;
}

export interface CacheRead<T> {
  key: string;
  // The soft lifetime, in seconds.
  soft: number;
  read: () => Promise<Filled<T>>;
}

interface Entry<T> {
  // The soft expiry, in milliseconds since the epoch.
  s: number;
  v: T;
  t?: string[];
  n?: 1;
}

// Takes the key's lock and answers Redis's time in milliseconds, or 0.
const LOCK = `
if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end
return 0`;

// Stores the entry under each tag, unless one of them was purged since the
// read began: the purge wins. A tag holds its keys scored by when they expire,
// and drops the expired ones on each store, so it never outgrows its live
// entries.
const STORE = `
for i = 2, #KEYS, 2 do
  local purged = redis.call('GET', KEYS[i + 1])
  if purged and tonumber(purged) >= tonumber(ARGV[3]) then return 0 end
end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
for i = 2, #KEYS, 2 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  redis.call('ZADD', KEYS[i], now + tonumber(ARGV[2]), KEYS[1])
  if redis.call('PTTL', KEYS[i]) < tonumber(ARGV[2]) then
    redis.call('PEXPIRE', KEYS[i], ARGV[2])
  end
end
return 1`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

// A value that is not one of ours reads as a miss, and is written over.
function parse<T>(text: string | null | undefined) {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Entry<T>;
  } catch {
    return undefined;
  }
}

// Names the served answer's tags on the request, for its Cache-Tag header.
function tagRequest(tags: string[] | undefined) {
  const store = requestContext.getStore();
  if (!store || !tags) return;
  store.cacheTags = [...new Set([...(store.cacheTags ?? []), ...tags])];
}

// Reads through Redis. PostgreSQL stays the truth: while Redis fails, every
// read comes from its read function, uncached, and the first failure of an
// outage is the one logged, with the recovery.
@Injectable()
export class CacheService {
  private readonly logger = new Logger('CacheService');
  private readonly flights = new Map<
    string,
    Promise<Entry<unknown> | undefined>
  >();
  private readonly warming = new AsyncLocalStorage<true>();
  private redisDown = false;

  constructor(@Inject(AUTH_REDIS) private readonly redis: Redis) {}

  // Runs the warm-up's reads: each entry they fill counts as warm.
  warm<T>(run: () => Promise<T>): Promise<T> {
    return this.warming.run(true, run);
  }

  async read<T>(spec: CacheRead<T>): Promise<T> {
    const text = await this.attempt(() => this.redis.get(spec.key));
    if (text === undefined) {
      this.count(spec.key, 'fallback');
      const filled = await spec.read();
      tagRequest(filled.tags);
      return filled.value;
    }
    const entry = parse<T>(text);
    if (entry) return this.served(spec, entry);
    const flight = this.flights.get(spec.key);
    const joined = flight && ((await flight) as Entry<T> | undefined);
    if (joined) this.count(spec.key, 'coalesced');
    const served = joined ?? ((await this.fly(spec, false)) as Entry<T>);
    tagRequest(served.t);
    return served.v;
  }

  // A stored entry: fresh, remembered as not found, or stale, when one read
  // refreshes it behind the answer.
  private served<T>(spec: CacheRead<T>, entry: Entry<T>) {
    tagRequest(entry.t);
    if (entry.n) {
      this.count(spec.key, 'negative');
    } else if (Date.now() < entry.s) {
      this.count(spec.key, 'hit');
    } else {
      this.count(spec.key, 'stale');
      if (!this.flights.has(spec.key)) {
        this.fly(spec, true).catch((error: unknown) =>
          this.logger.warn(`cache refresh failed: ${String(error)}`),
        );
      }
    }
    return entry.v;
  }

  private fly<T>(spec: CacheRead<T>, background: boolean) {
    const flight = this.fill(spec, background).finally(() =>
      this.flights.delete(spec.key),
    );
    this.flights.set(spec.key, flight);
    return flight;
  }

  // One read per key: the lock's holder reads and stores, the others wait for
  // what it stored. A background refresh that loses the lock does nothing.
  private async fill<T>(
    spec: CacheRead<T>,
    background: boolean,
  ): Promise<Entry<T> | undefined> {
    const lock = lockKey(spec.key);
    const token = randomUUID();
    const start = await this.take(lock, token);
    if (start === undefined) return this.unstored(spec, background, 'fallback');
    if (start > 0) return this.lead(spec, lock, token, start, background);
    if (background) return undefined;
    const stored = await this.stored<T>(spec.key, lock);
    if (stored) {
      this.count(spec.key, 'coalesced');
      return stored;
    }
    // The holder is gone without storing: one more try at the lock, then the
    // read goes to the database itself.
    const again = await this.take(lock, token);
    if (again) return this.lead(spec, lock, token, again, false);
    return this.unstored(
      spec,
      false,
      again === undefined ? 'fallback' : 'miss',
    );
  }

  // Takes the key's lock: Redis's time when taken, 0 when held, undefined
  // when Redis failed.
  private take(lock: string, token: string) {
    return this.attempt(
      () => this.redis.eval(LOCK, 1, lock, token, LOCK_MS) as Promise<number>,
    );
  }

  private async unstored<T>(
    spec: CacheRead<T>,
    background: boolean,
    outcome: CacheOutcome,
  ) {
    if (background) return undefined;
    this.count(spec.key, outcome);
    return this.entry(spec, await spec.read()).entry;
  }

  private async lead<T>(
    spec: CacheRead<T>,
    lock: string,
    token: string,
    start: number,
    background: boolean,
  ) {
    try {
      const filled = await spec.read();
      const { entry, hardMs } = this.entry(spec, filled);
      const tags = filled.tags ?? [];
      await this.attempt(() =>
        this.redis.eval(
          STORE,
          1 + tags.length * 2,
          filled.key ?? spec.key,
          ...tags.flatMap((tag) => [tagKey(tag), purgedKey(tag)]),
          JSON.stringify(entry),
          hardMs,
          start,
        ),
      );
      if (!background) this.count(spec.key, 'miss');
      return entry;
    } finally {
      await this.attempt(() => this.redis.eval(RELEASE, 1, lock, token));
    }
  }

  private entry<T>(spec: CacheRead<T>, filled: Filled<T>) {
    const { hardMs, softMs } = lifetimes(spec.soft, filled.negative === true);
    const entry: Entry<T> = {
      s: Date.now() + softMs,
      v: filled.value,
      ...(filled.tags?.length ? { t: filled.tags } : {}),
      ...(filled.negative && { n: 1 as const }),
    };
    return { entry, hardMs };
  }

  // Polls until the holder has stored the entry, or its lock is gone.
  private async stored<T>(key: string, lock: string) {
    const deadline = performance.now() + LOCK_MS;
    while (performance.now() < deadline) {
      await sleep(POLL_MS);
      const found = await this.attempt(() => this.redis.mget(key, lock));
      if (!found) return undefined;
      const entry = parse<T>(found[0]);
      if (entry) return entry;
      if (found[1] === null) return undefined;
    }
    return undefined;
  }

  private count(key: string, outcome: CacheOutcome) {
    if (this.warming.getStore()) {
      if (outcome === 'miss') recordCache(kindOf(key), 'warm');
      return;
    }
    recordCache(kindOf(key), outcome);
  }

  private async attempt<T>(command: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await command();
      if (this.redisDown) this.logger.log('cache available again');
      this.redisDown = false;
      return result;
    } catch (error) {
      if (!this.redisDown) {
        this.logger.warn(`cache unavailable: ${String(error)}`);
        this.redisDown = true;
      }
      return undefined;
    }
  }
}
