import type {
  VerificationPresenceDto,
  VerificationPresenceEntryDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../../../auth/attempts';
import { PRISMA } from '../../../../auth/prisma';
import { publishLive } from '../../../../events/live/live.hub';
import type { PrismaClient } from '../../../../generated/prisma/client';
import { countPresence } from '../../../../metrics/product-counters';
import { shortName } from '../../../../quotes/reads';

// An entry not renewed for this long is gone: the tab stopped beating.
const TTL_MS = 60_000;

interface Entry {
  name: string;
  since: string;
  seen: string;
}

const keyOf = (fileId: string) => `verification:presence:${fileId}`;

// Removes each stale field only while it still holds the value read: a beat
// landing between the read and this removal keeps its fresh entry.
const DROP_STALE = `for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
return 0`;

const parsed = (raw: string): Entry | null => {
  try {
    const entry = JSON.parse(raw) as Partial<Entry>;
    return typeof entry.name === 'string' &&
      typeof entry.since === 'string' &&
      typeof entry.seen === 'string'
      ? (entry as Entry)
      : null;
  } catch {
    return null;
  }
};

// A transaction's replies, or the store's failure: an aborted one or one
// whose command answered an error.
const succeeded = (replies: [Error | null, unknown][] | null) => {
  const failed = replies?.find(([error]) => error)?.[0];
  if (!replies || failed) throw failed ?? new Error('transaction aborted');
  return replies;
};

// Which admins have a verification file open: a hint kept in Valkey only,
// never a lock, never audited. A store that fails answers nobody, so the
// file still opens and every check still records.
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  now: () => number = Date.now;

  constructor(
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  // The heartbeat: records the caller (its start kept across beats and tabs)
  // and answers the others, the earliest first.
  async touch(
    fileId: string,
    accountId: string,
  ): Promise<VerificationPresenceDto> {
    await this.fileExists(fileId);
    // Read from PostgreSQL before the store, so its failure is not counted as one.
    const account = await this.prisma.account.findUnique({
      select: { name: true },
      where: { id: accountId },
    });
    try {
      const now = this.now();
      const key = keyOf(fileId);
      const live = await this.liveEntries(key, now);
      const created = await this.record(key, accountId, live.get(accountId), {
        at: new Date(now).toISOString(),
        name: shortName(account?.name ?? ''),
      });
      if (created) this.changed(fileId, now, 'created');
      live.delete(accountId);
      return {
        others: [...live.values()]
          .sort((a, b) => a.since.localeCompare(b.since))
          .map(
            ({ name, since }): VerificationPresenceEntryDto => ({
              name,
              since,
            }),
          ),
      };
    } catch (error) {
      this.unavailable(fileId, error);
      return { others: [] };
    }
  }

  // Writes the caller's beat; true when it created the entry. Two first beats
  // at once (two tabs) create it once, the other keeping its "since".
  private async record(
    key: string,
    accountId: string,
    live: Entry | undefined,
    { name, at }: { name: string; at: string },
  ): Promise<boolean> {
    let own = live;
    if (!own) {
      // Created with its expiry in one transaction: a key never lacks a TTL.
      const fresh = { name, seen: at, since: at };
      const [[, set]] = succeeded(
        await this.redis
          .multi()
          .hsetnx(key, accountId, JSON.stringify(fresh))
          .pexpire(key, TTL_MS)
          .exec(),
      );
      if (set === 1) return true;
      own = parsed((await this.redis.hget(key, accountId)) ?? '') ?? fresh;
    }
    own.seen = at;
    succeeded(
      await this.redis
        .multi()
        .hset(key, accountId, JSON.stringify(own))
        .pexpire(key, TTL_MS)
        .exec(),
    );
    return false;
  }

  // The tab closed: the others stop seeing the caller at once.
  async leave(fileId: string, accountId: string): Promise<void> {
    await this.fileExists(fileId);
    try {
      const removed = await this.redis.hdel(keyOf(fileId), accountId);
      if (removed > 0) this.changed(fileId, this.now(), 'removed');
    } catch (error) {
      this.unavailable(fileId, error);
    }
  }

  private async fileExists(fileId: string) {
    if (!isUUID(fileId)) throw new NotFoundException();
    const file = await this.prisma.verificationFile.findUnique({
      select: { id: true },
      where: { id: fileId },
    });
    if (!file) throw new NotFoundException();
  }

  // The entries still beating; the rest are removed from the store.
  private async liveEntries(key: string, now: number) {
    const live = new Map<string, Entry>();
    const stale: string[] = [];
    for (const [field, raw] of Object.entries(await this.redis.hgetall(key))) {
      const entry = parsed(raw);
      if (entry && now - Date.parse(entry.seen) <= TTL_MS)
        live.set(field, entry);
      else stale.push(field, raw);
    }
    if (stale.length > 0) await this.redis.eval(DROP_STALE, 1, key, ...stale);
    return live;
  }

  // Only a nudge for the other drawers to read again: not awaited.
  private changed(fileId: string, now: number, outcome: 'created' | 'removed') {
    countPresence(outcome);
    publishLive(
      this.redis,
      { at: new Date(now).toISOString(), id: fileId, kind: 'presence.changed' },
      ['admin'],
    ).catch((error: Error) =>
      this.logger.warn(`presence.changed not sent: ${error.message}`),
    );
  }

  private unavailable(fileId: string, error: unknown) {
    countPresence('store_unavailable');
    this.logger.warn(
      `presence store unavailable for file ${fileId}: ${(error as Error).message}`,
    );
  }
}
