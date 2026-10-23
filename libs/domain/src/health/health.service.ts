import type { HealthReadyDto } from '@motor-fix/contracts';
import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Redis } from 'ioredis';

import { PrismaClient } from '../generated/prisma/client';
import { StorageService } from '../storage/storage.service';
import { borrowStore, returnStore } from '../store/store';

export const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');

// Provided by a module whose own work the app is not ready without (the
// worker's notifications consumer); not ready turns the report to error.
export const READINESS = Symbol('READINESS');

export interface Readiness {
  ready(): boolean;
}

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
export class HealthService implements OnModuleInit, OnApplicationShutdown {
  private readonly prisma: PrismaClient;
  private readiness: Readiness | null = null;
  private readonly redis: Redis;

  constructor(
    @Inject(HEALTH_OPTIONS) private readonly options: HealthOptions,
    private readonly storage: StorageService,
    private readonly modules: ModuleRef,
  ) {
    this.prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: options.databaseUrl,
        connectionTimeoutMillis: LIMIT_MS,
      }),
    });
    this.redis = borrowStore(options.redisUrl);
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
    const ok =
      Object.values(checks).every((check) => check === 'ok') &&
      (this.readiness?.ready() ?? true);
    return {
      checks,
      status: ok ? 'ok' : 'error',
      version: this.options.version,
    };
  }

  // Any module may provide it; the API has none.
  onModuleInit() {
    try {
      this.readiness = this.modules.get<Readiness>(READINESS, {
        strict: false,
      });
    } catch {
      this.readiness = null;
    }
  }

  async onApplicationShutdown() {
    await returnStore(this.redis);
    await this.prisma.$disconnect();
  }
}
