import { SEARCH_RADIUS_DEFAULT_KM } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { recordSearchCache } from './garage-search.metrics';
import { AUTH_REDIS } from '../../auth/attempts';

// A search page, or the map pins of a search, in Redis for 60 seconds, under one generation for every
// search: a public garage change advances it, so every entry written before
// is never read again and expires by itself. No CDN keeps an answer (the
// route is no-store), so every search still reaches the API and its log.
// The `v1` in the keys is the answer's shape: a change to the DTO bumps it.
const SEARCH_SECONDS = 60;
const SEARCH_GENERATION = 'garage-search-gen:v1';

interface SearchKey {
  // A page of the list, or the pins of the map.
  kind: 'page' | 'pins';
  brandId: string;
  // The place as its shared 3-decimal text.
  near?: string;
  radiusKm?: number;
  // The visible box as its shared 3-decimal text.
  bbox?: string;
  cursor?: string;
}

const searchKey = (
  generation: string,
  { bbox, brandId, cursor, kind, near, radiusKm }: SearchKey,
) =>
  `garage-search:v1:${generation}:${kind}:${brandId}:${near ?? '-'}:${radiusKm ?? SEARCH_RADIUS_DEFAULT_KM}:${bbox ?? '-'}:${cursor ?? '-'}`;

export const SEARCH_AUDIENCE = /^public:(garage:|search$|search:)/;

// Drops every cached search when an event reaches a garage's public page or
// a search. A drop Redis refuses throws, so the relay retries the event.
export async function dropSearches(
  redis: { incr(key: string): Promise<unknown> },
  audience: string[],
) {
  if (audience.some((key) => SEARCH_AUDIENCE.test(key))) {
    await redis.incr(SEARCH_GENERATION);
  }
}

@Injectable()
export class GarageSearchCache {
  private readonly logger = new Logger('GarageSearchCache');
  private redisDown = false;

  constructor(@Inject(AUTH_REDIS) private readonly redis: Redis) {}

  // The answer from Redis, or from `read` stored for the next 60 seconds.
  // While Redis fails every answer comes from `read`, as it would without it.
  async entry<T>(key: SearchKey, read: () => Promise<T>): Promise<T> {
    const generation = await this.attempt(() =>
      this.redis.get(SEARCH_GENERATION),
    );
    const entry = searchKey(generation ?? '0', key);
    const cached =
      generation === undefined
        ? undefined
        : await this.attempt(() => this.redis.get(entry));
    if (cached) {
      recordSearchCache('hit');
      return JSON.parse(cached) as T;
    }
    const answer = await read();
    if (cached === undefined) {
      recordSearchCache('fallback');
      return answer;
    }
    recordSearchCache('miss');
    await this.attempt(() =>
      this.redis.set(entry, JSON.stringify(answer), 'EX', SEARCH_SECONDS),
    );
    return answer;
  }

  // The first failure of an outage is the one logged, and the recovery.
  private async attempt<T>(command: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await command();
      if (this.redisDown)
        this.logger.log('garage search cache available again');
      this.redisDown = false;
      return result;
    } catch (error) {
      if (!this.redisDown) {
        this.logger.warn(`garage search cache unavailable: ${String(error)}`);
        this.redisDown = true;
      }
      return undefined;
    }
  }
}
