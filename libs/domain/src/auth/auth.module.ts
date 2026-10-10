import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';

import { AccountLoader } from './account-loader';
import { AccountsService } from './accounts.service';
import { ActorGuard, AUTH_OPTIONS, type AuthOptions } from './actor.guard';
import { AssistantController } from './assistant/assistant.controller';
import {
  ASSISTANT_THROTTLE,
  AssistantService,
  assistantThrottle,
} from './assistant/assistant.service';
import { Attempts, AUTH_REDIS } from './attempts';
import { AuthController } from './auth.controller';
import { MAINTENANCE, MaintenanceFlag } from './maintenance';
import { MeController } from './me.controller';
import { OauthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { createPrisma, PRISMA } from './prisma';
import { SESSION_EVENTS, SignInService } from './sign-in.service';
import { SignUpService } from './sign-up.service';
import { WhoAmI } from './who-am-i';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { AuditHistoryController } from '../audit/audit-history/audit-history.controller';
import { AuditHistoryService } from '../audit/audit-history/audit-history.service';
import { EVENT_PORT, outbox } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';

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
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  static register(options: AuthOptions): DynamicModule {
    return {
      controllers: [
        AuthController,
        AssistantController,
        OauthController,
        MeController,
        AuditHistoryController,
      ],
      exports: [
        AccountLoader,
        AccountsService,
        Attempts,
        AUTH_OPTIONS,
        AUTH_REDIS,
        EVENT_PORT,
        MAINTENANCE,
        WhoAmI,
        PRISMA,
        SESSION_EVENTS,
        SignInService,
      ],
      // One actor check for every route of the app, and one client.
      global: true,
      module: AuthModule,
      providers: [
        AccountLoader,
        AccountsService,
        ActorGuard,
        AssistantService,
        { provide: APP_GUARD, useExisting: ActorGuard },
        AuditHistoryService,
        WhoAmI,
        OAuthService,
        SignInService,
        SignUpService,
        { provide: AUTH_OPTIONS, useValue: options },
        {
          provide: PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        { provide: AUTH_REDIS, useFactory: () => connect(options.redisUrl) },
        { provide: SESSION_EVENTS, useExisting: AUTH_REDIS },
        {
          inject: [AUTH_REDIS],
          provide: Attempts,
          useFactory: (redis: Redis) => new Attempts(redis),
        },
        {
          inject: [AUTH_REDIS],
          provide: ASSISTANT_THROTTLE,
          useFactory: assistantThrottle,
        },
        { provide: MAINTENANCE, useClass: MaintenanceFlag },
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: EVENT_PORT, useValue: outbox },
      ],
    };
  }

  async onApplicationShutdown() {
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
