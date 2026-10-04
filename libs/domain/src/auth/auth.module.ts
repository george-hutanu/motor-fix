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
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { AuditHistoryController } from '../audit/audit-history.controller';
import { AuditHistoryService } from '../audit/audit-history.service';
import { EVENT_PORT, noEvents } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';

@Module({})
export class AuthModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  static register(options: AuthOptions): DynamicModule {
    return {
      controllers: [MeController, AuditHistoryController],
      exports: [AccountsService, ActorGuard, AUTH_OPTIONS, PRISMA],
      module: AuthModule,
      providers: [
        AccountsService,
        ActorGuard,
        AuditHistoryService,
        { provide: AUTH_OPTIONS, useValue: options },
        {
          provide: PRISMA,
          useFactory: () => createPrisma(options.databaseUrl),
        },
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: EVENT_PORT, useValue: noEvents },
      ],
    };
  }

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}
