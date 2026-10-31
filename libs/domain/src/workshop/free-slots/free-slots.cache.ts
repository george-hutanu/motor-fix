import type { EventKind, FreeSlotsDto } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from '../../auth/attempts';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';

// A garage's free-slot answers in Valkey for 60 seconds, under a generation
// of that garage: a schedule event advances it, so every entry written before
// is never read again and expires by itself. PostgreSQL stays the truth.
const SLOTS_SECONDS = 60;
const generationKey = (garageId: string) => `free-slots-gen:${garageId}`;

// The question after its defaults and the rounding of the earliest start.
export interface FreeSlotsKey {
  garageId: string;
  duration: number;
  needsLift: boolean;
  earliest: Date;
  horizonDays: number;
  count: number;
  mechanicId?: string;
  excludeBookingId?: string;
}

const entryKey = (generation: string, k: FreeSlotsKey) =>
  `free-slots:v1:${k.garageId}:${generation}:${k.duration}:${k.needsLift}:${k.earliest.toISOString()}:${k.horizonDays}:${k.count}:${k.mechanicId ?? '-'}:${k.excludeBookingId ?? '-'}`;

// The kinds that can move a garage's free slots.
const SCHEDULE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'booking.confirmed',
  'booking.moved',
  'booking.cancelled',
  'booking.lapsed',
  'quote.accepted',
  'mechanic.added',
  'mechanic.updated',
  'mechanic.removed',
  'garage.updated',
  'garage.features_changed',
  'time_block.created',
  'time_block.updated',
  'time_block.deleted',
]);

const GARAGE_KEY = /^garage:([^:]+)$/;

// On a schedule event of a garage: drops its cached answers and records the
// one garage.slots_changed its public page listens for, in the relay's batch.
// A drop Valkey refuses throws, so the batch rolls back and is retried.
export async function relaySchedule(
  tx: Prisma.TransactionClient,
  redis: { incr(key: string): Promise<unknown> },
  row: { kind: EventKind; audience: string[] },
) {
  if (!SCHEDULE_KINDS.has(row.kind)) return;
  const garageId = row.audience
    .map((key) => GARAGE_KEY.exec(key)?.[1])
    .find(Boolean);
  if (!garageId) return;
  await redis.incr(generationKey(garageId));
  await outbox.record(tx, {
    audience: { garageId, results: false, type: 'public_garage' },
    kind: 'garage.slots_changed',
    payload: { garageId },
    subjectId: garageId,
  });
}

@Injectable()
export class FreeSlotsCache {
  private readonly logger = new Logger('FreeSlotsCache');
  private redisDown = false;

  constructor(@Inject(AUTH_REDIS) private readonly redis: Redis) {}

  // The answer from Valkey, or from `read` stored for the next 60 seconds.
  // While Valkey fails every answer comes from `read`, as it would without it.
  async entry(
    key: FreeSlotsKey,
    read: () => Promise<FreeSlotsDto>,
  ): Promise<FreeSlotsDto> {
    const generation = await this.attempt(() =>
      this.redis.get(generationKey(key.garageId)),
    );
    const entry = entryKey(generation ?? '0', key);
    const cached =
      generation === undefined
        ? undefined
        : await this.attempt(() => this.redis.get(entry));
    if (cached) return JSON.parse(cached) as FreeSlotsDto;
    const answer = await read();
    if (cached === undefined) return answer;
    await this.attempt(() =>
      this.redis.set(entry, JSON.stringify(answer), 'EX', SLOTS_SECONDS),
    );
    return answer;
  }

  // The first failure of an outage is the one logged, and the recovery.
  private async attempt<T>(command: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await command();
      if (this.redisDown) this.logger.log('free slots cache available again');
      this.redisDown = false;
      return result;
    } catch (error) {
      if (!this.redisDown) {
        this.logger.warn(`free slots cache unavailable: ${String(error)}`);
        this.redisDown = true;
      }
      return undefined;
    }
  }
}
