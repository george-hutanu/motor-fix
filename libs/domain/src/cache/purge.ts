import { Logger } from '@nestjs/common';

import { recordCache } from './cache.metrics';
import { kindOf, purgedKey, tagKey } from './cache.service';
import { SEARCH_AUDIENCE } from '../search/garage-search/garage-search.cache';

export interface Purger {
  eval(script: string, keys: number, ...args: string[]): Promise<unknown>;
}

// The tag set's entries and the set go, and the tag's purge time is kept for
// longer than any entry lives, so a read that began before it stores nothing.
const PURGE = `
local t = redis.call('TIME')
redis.call('SET', KEYS[2], tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000), 'PX', 1300000)
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, member in ipairs(members) do redis.call('UNLINK', member) end
redis.call('DEL', KEYS[1])
return members`;

// Purges each tag and hands it on to `hook`, the place a CDN purge by the same
// tag goes. A purge Redis refuses throws, so the relay retries the event; a
// hook that fails is one warning and never fails the purge.
export async function purgeTags(
  redis: Purger,
  tags: string[],
  hook: (tag: string) => unknown = () => undefined,
): Promise<string[]> {
  const purged: string[] = [];
  for (const tag of tags) {
    const keys = (await redis.eval(
      PURGE,
      2,
      tagKey(tag),
      purgedKey(tag),
    )) as string[];
    for (const key of keys) recordCache(kindOf(key), 'purge');
    purged.push(...keys);
    try {
      await hook(tag);
    } catch (error) {
      new Logger('CachePurge').warn(
        `purge hook failed for ${tag}: ${String(error)}`,
      );
    }
  }
  return purged;
}

const PUBLIC_GARAGE = /^public:garage:(.+)$/;

// The tags an event's audience changes: each garage whose public page it
// reaches, and the brand pages whenever it would drop the cached searches.
export function purgeAudience(
  redis: Purger,
  audience: string[],
  hook?: (tag: string) => unknown,
) {
  const tags = audience.flatMap((key) => {
    const garageId = PUBLIC_GARAGE.exec(key)?.[1];
    return garageId ? [`garage:${garageId}`] : [];
  });
  if (audience.some((key) => SEARCH_AUDIENCE.test(key))) tags.push('search');
  return purgeTags(redis, tags, hook);
}
