import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';

import { AccountsService } from './accounts.service';
import { ActorGuard, AUTH_OPTIONS, type AuthOptions } from './actor.guard';
import { Attempts } from './attempts';
import { AuthController } from './auth.controller';
import { MAINTENANCE, maintenanceOff } from './maintenance';
import { MeController } from './me.controller';
import { createPrisma, PRISMA } from './prisma';
import { SESSION_EVENTS, SignInService } from './sign-in.service';
import { SignUpService } from './sign-up.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { AuditHistoryController } from '../audit/audit-history.controller';
import { AuditHistoryService } from '../audit/audit-history.service';
import { EVENT_PORT, noEvents } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';

const REDIS = Symbol('AUTH_REDIS');

function connect(url: string) {
  // A Redis that does not answer within 2 s counts as down (the sign-in rule).
  const redis = new Redis(url, {
    commandTimeout: 2000,
    connectTimeout: 2000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  // A down Redis only skips the attempt limits; Attempts logs it.
  redis.on('error', () => undefined);
  return redis;
}

@Module({})
export class AuthModule implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static register(options: AuthOptions): DynamicModule {
    return {
      controllers: [AuthController, MeController, AuditHistoryController],
      exports: [AccountsService, AUTH_OPTIONS, PRISMA],
      // One actor check for every route of the app, and one client.
      global: true,
      module: AuthModule,
      providers: [
        AccountsService,
        ActorGuard,
        { provide: APP_GUARD, useExisting: ActorGuard },
        AuditHistoryService,
        SignInService,
        SignUpService,
        { provide: AUTH_OPTIONS, useValue: options },
        {
          provide: PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        { provide: REDIS, useFactory: () => connect(options.redisUrl) },
        { provide: SESSION_EVENTS, useExisting: REDIS },
        {
          inject: [REDIS],
          provide: Attempts,
          useFactory: (redis: Redis) => new Attempts(redis),
        },
        { provide: MAINTENANCE, useValue: maintenanceOff },
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: EVENT_PORT, useValue: noEvents },
      ],
    };
  }

  async onApplicationShutdown() {
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
