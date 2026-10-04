import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import {
  EmailConfirmationController,
  MeEmailConfirmationController,
} from './email-confirmation.controller';
import {
  CONFIRMATION_OPTIONS,
  CONFIRMATION_REDIS,
  EmailConfirmationService,
} from './email-confirmation.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

function connect(url: string) {
  // As the sign-in limits: a Redis that does not answer within 2 s is down,
  // and down only skips the limit and the live event.
  const redis = new Redis(url, {
    commandTimeout: 2000,
    connectTimeout: 2000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => undefined);
  return redis;
}

// Global, so the AuthModule's sign-up can reach it: the notifications module
// imports the AuthModule, so the AuthModule cannot import notifications.
@Module({})
export class EmailConfirmationModule implements OnApplicationShutdown {
  constructor(@Inject(CONFIRMATION_REDIS) private readonly redis: Redis) {}

  // `notifications` is the application's NotificationsModule.
  static register(
    options: { redisUrl: string; webUrl?: string },
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [EmailConfirmationController, MeEmailConfirmationController],
      exports: [EmailConfirmationService],
      global: true,
      imports: [notifications],
      module: EmailConfirmationModule,
      providers: [
        EmailConfirmationService,
        { provide: CONFIRMATION_OPTIONS, useValue: { webUrl: options.webUrl } },
        {
          provide: CONFIRMATION_REDIS,
          useFactory: () => connect(options.redisUrl),
        },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }

  onApplicationShutdown() {
    this.redis.disconnect();
  }
}
