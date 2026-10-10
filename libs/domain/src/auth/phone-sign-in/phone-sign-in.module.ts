import { type DynamicModule, Module } from '@nestjs/common';

import { PhoneSignInController } from './phone-sign-in.controller';
import { PHONE_BREVO, PhoneSignInService } from './phone-sign-in.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { Brevo } from '../../notifications/brevo/brevo';
import {
  PHONE_CONFIG,
  type PhoneConfig,
} from '../../notifications/phone-config';
import { PhoneChangeController } from '../phone-change/phone-change.controller';
import { PhoneChangeService } from '../phone-change/phone-change.service';

// The api sends the code itself, while the user waits: no queue, and a Brevo
// of its own with a short timeout. The code that confirms a new number in
// Setări goes out the same way, so its change lives here too.
@Module({})
export class PhoneSignInModule {
  static register(options: {
    brevo: { apiKey: string; apiUrl: string };
    phone: PhoneConfig;
  }): DynamicModule {
    return {
      controllers: [PhoneChangeController, PhoneSignInController],
      module: PhoneSignInModule,
      providers: [
        PhoneChangeService,
        PhoneSignInService,
        { provide: AUDIT_PORT, useClass: AuditService },
        {
          provide: PHONE_BREVO,
          useValue: new Brevo({ ...options.brevo, timeoutMs: 5000 }),
        },
        { provide: PHONE_CONFIG, useValue: options.phone },
      ],
    };
  }
}
