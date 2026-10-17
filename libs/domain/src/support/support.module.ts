import { type DynamicModule, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { SupportContactController } from './contact/contact.controller';
import { SupportMessagesController } from './messages/messages.controller';
import { SupportMessagesService } from './messages/messages.service';
import { SupportThrottle, SupportThrottleGuard } from './messages/throttle';
import { SUPPORT_CONFIG, type SupportConfig } from './support-config';
import { AUTH_REDIS } from '../auth/attempts';

// Contact MotorFix: the form's endpoint and the support address. Needs the
// global AuthModule for its database, Redis and event port.
@Module({})
export class SupportModule {
  static register(config: SupportConfig): DynamicModule {
    return {
      controllers: [SupportContactController, SupportMessagesController],
      module: SupportModule,
      providers: [
        { provide: SUPPORT_CONFIG, useValue: config },
        SupportMessagesService,
        SupportThrottleGuard,
        {
          inject: [AUTH_REDIS],
          provide: SupportThrottle,
          useFactory: (redis: Redis) => new SupportThrottle(redis),
        },
      ],
    };
  }
}
