import { type DynamicModule, Module } from '@nestjs/common';

import { PhoneSignInController } from './phone-sign-in.controller';
import { PHONE_BREVO, PhoneSignInService } from './phone-sign-in.service';
import { Brevo } from '../../notifications/brevo/brevo';
import {
  PHONE_CONFIG,
  type PhoneConfig,
} from '../../notifications/phone-config';

// The api sends the code itself, while the user waits: no queue, and a Brevo
// of its own with a short timeout.
@Module({})
export class PhoneSignInModule {
  static register(options: {
    brevo: { apiKey: string; apiUrl: string };
    phone: PhoneConfig;
  }): DynamicModule {
    return {
      controllers: [PhoneSignInController],
      module: PhoneSignInModule,
      providers: [
        PhoneSignInService,
        {
          provide: PHONE_BREVO,
          useValue: new Brevo({ ...options.brevo, timeoutMs: 5000 }),
        },
        { provide: PHONE_CONFIG, useValue: options.phone },
      ],
    };
  }
}
