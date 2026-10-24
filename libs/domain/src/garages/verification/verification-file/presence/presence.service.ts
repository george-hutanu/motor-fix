import type {
  VerificationPresenceDto,
  VerificationPresenceEntryDto,
} from '@motor-fix/contracts';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Redis } from 'ioredis';

import { countPresence } from './presence.metrics';
import { AUTH_REDIS } from '../../../../auth/attempts';
import { PRISMA } from '../../../../auth/prisma';
import { publishLive } from '../../../../events/live/live.hub';
import type { PrismaClient } from '../../../../generated/prisma/client';
import { shortName } from '../../../../quotes/reads';

// An entry not renewed for this long is gone: the tab stopped beating.
const TTL_MS = 60_000;

interface Entry {
  name: string;
  since: string;
  seen: string;
}

const keyOf = (fileId: string) => `verification:presence:${fileId}`;

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
    try {
      const now = this.now();
      const key = keyOf(fileId);
      const live = await this.liveEntries(key, now);
      let own = live.get(accountId);
      const created = !own;
      if (!own) {
        const account = await this.prisma.account.findUnique({
          select: { name: true },
          where: { id: accountId },
        });
        own = {
          name: shortName(account?.name ?? ''),
          seen: '',
          since: new Date(now).toISOString(),
        };
      }
      own.seen = new Date(now).toISOString();
      await this.redis
        .multi()
        .hset(key, accountId, JSON.stringify(own))
        .pexpire(key, TTL_MS)
        .exec();
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
      else stale.push(field);
    }
    if (stale.length > 0) await this.redis.hdel(key, ...stale);
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
