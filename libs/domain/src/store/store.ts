import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

// One command connection per process and address: every module that issues
// commands borrows it, and the last one to give it back closes it. The live
// subscriber and BullMQ keep connections of their own.
const open = new Map<string, { holders: number; redis: Redis }>();
const logger = new Logger('Store');

export function borrowStore(url: string): Redis {
  const held = open.get(url);
  if (held) {
    held.holders += 1;
    return held.redis;
  }
  // A store that does not answer within 2 s counts as down; each caller
  // decides what down means for it.
  const redis = new Redis(url, {
    commandTimeout: 2000,
    connectTimeout: 2000,
    enableAutoPipelining: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  let reported = false;
  redis.on('error', (error: Error) => {
    if (reported) return;
    reported = true;
    logger.warn(`cannot reach the store: ${error.message}`);
  });
  redis.on('ready', () => {
    reported = false;
  });
  open.set(url, { holders: 1, redis });
  return redis;
}

export async function returnStore(redis: Redis): Promise<void> {
  for (const [url, held] of open) {
    if (held.redis !== redis) continue;
    held.holders -= 1;
    if (held.holders > 0) return;
    open.delete(url);
    // quit lets pipelined commands finish; a store that is not up has none.
    if (redis.status === 'ready')
      await redis.quit().catch(() => redis.disconnect());
    else redis.disconnect();
    return;
  }
}
