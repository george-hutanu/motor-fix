import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { AccountsService } from './accounts.service';
import { ActorGuard, AUTH_OPTIONS, type AuthOptions } from './actor.guard';
import { MeController } from './me.controller';
import { createPrisma, PRISMA } from './prisma';
import { AUDIT_PORT, noAudit } from '../audit/audit.port';
import { EVENT_PORT, noEvents } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';

@Module({})
export class AuthModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  static register(options: AuthOptions): DynamicModule {
    return {
      controllers: [MeController],
      exports: [AccountsService, ActorGuard, AUTH_OPTIONS, PRISMA],
      module: AuthModule,
      providers: [
        AccountsService,
        ActorGuard,
        { provide: AUTH_OPTIONS, useValue: options },
        {
          provide: PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        { provide: AUDIT_PORT, useValue: noAudit },
        { provide: EVENT_PORT, useValue: noEvents },
      ],
    };
  }

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}
