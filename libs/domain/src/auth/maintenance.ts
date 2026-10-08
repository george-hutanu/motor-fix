import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { Redis } from 'ioredis';

import { AUTH_REDIS } from './attempts';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

// Whether the platform is in maintenance: the platform rule of that name.
export const MAINTENANCE = Symbol('MAINTENANCE');

export interface Maintenance {
  on(): Promise<boolean>;
  set(on: boolean): Promise<void>;
}

const KEY = 'maintenance_mode';
// A lost write after a change heals within this.
const KEEP_SECONDS = 60;
const RETRY_AFTER_SECONDS = 300;

// Read on every call from Redis, filled from the stored rule on a miss; when
// Redis fails the stored rule answers, so Redis never decides a call. While
// Redis is down each call first waits out the client's command timeout, as
// the sign-in attempt limits on the same client already do.
@Injectable()
export class MaintenanceFlag implements Maintenance {
  private readonly logger = new Logger('Maintenance');
  private redisDown = false;

  constructor(
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async on(): Promise<boolean> {
    const kept = await this.cache(() => this.redis.get(KEY));
    if (kept === '1' || kept === '0') return kept === '1';
    const rule = await this.prisma.platformRule.findUnique({
      select: { value: true },
      where: { key: KEY },
    });
    const on = rule?.value === true;
    if (kept === null) await this.cache(() => this.fill(on));
    return on;
  }

  async set(on: boolean): Promise<void> {
    await this.write(on);
  }

  // Only into an empty key: a switch written since the miss stays.
  private fill(on: boolean) {
    return this.redis.set(KEY, on ? '1' : '0', 'EX', KEEP_SECONDS, 'NX');
  }

  private write(on: boolean) {
    return this.redis.set(KEY, on ? '1' : '0', 'EX', KEEP_SECONDS);
  }

  private async cache<T>(command: () => Promise<T>) {
    try {
      const result = await command();
      this.redisDown = false;
      return result;
    } catch (error) {
      if (!this.redisDown) {
        this.logger.warn(
          `maintenance flag read from the database, Redis unavailable: ${String(error)}`,
        );
        this.redisDown = true;
      }
      return undefined;
    }
  }
}

let refusals:
  | ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>
  | undefined;

// A call refused because the platform is in maintenance, counted by route and
// by whether a session was recognised.
export function maintenanceRefusal(
  route: string,
  role: 'visitor' | 'signed_in',
) {
  refusals ??= metrics
    .getMeter('motorfix')
    .createCounter('motorfix_maintenance_refusals_total', {
      description: 'Calls refused while the platform is in maintenance',
    });
  refusals.add(1, { role, route });
  return new HttpException(
    {
      code: 'maintenance',
      message: 'MotorFix is down for maintenance',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
