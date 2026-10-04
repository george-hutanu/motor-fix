import type { HealthReadyDto } from '@motor-fix/contracts';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';

import { PrismaClient } from '../generated/prisma/client';
import { StorageService } from '../storage/storage.service';

export const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');

export interface HealthOptions {
  databaseUrl: string;
  redisUrl: string;
  version: string;
}

const LIMIT_MS = 2000;

function within<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), LIMIT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const outcome = (result: PromiseSettledResult<unknown>): 'ok' | 'error' =>
  result.status === 'fulfilled' ? 'ok' : 'error';

@Injectable()
export class HealthService implements OnApplicationShutdown {
  private readonly prisma: PrismaClient;
  private readonly redis: Redis;

  constructor(
    @Inject(HEALTH_OPTIONS) private readonly options: HealthOptions,
    private readonly storage: StorageService,
  ) {
    this.prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: options.databaseUrl,
        connectionTimeoutMillis: LIMIT_MS,
      }),
    });
    this.redis = new Redis(options.redisUrl, {
      connectTimeout: LIMIT_MS,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // Without a listener ioredis reports every failed reconnect as unhandled;
    // the ready check is where a down Redis is reported.
    this.redis.on('error', () => undefined);
  }

  async ready(): Promise<HealthReadyDto> {
    const [postgres, redis, storage] = await Promise.allSettled([
      within(this.prisma.$queryRaw`SELECT 1`),
      within(this.redis.ping()),
      within(this.storage.ready()),
    ]);
    const checks = {
      postgres: outcome(postgres),
      redis: outcome(redis),
      storage: outcome(storage),
    };
    const ok = Object.values(checks).every((check) => check === 'ok');
    return {
      checks,
      status: ok ? 'ok' : 'error',
      version: this.options.version,
    };
  }

  async onApplicationShutdown() {
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
