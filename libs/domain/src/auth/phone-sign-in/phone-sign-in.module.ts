import { type DynamicModule, Module } from '@nestjs/common';

import { PhoneSignInController } from './phone-sign-in.controller';
import { PhoneSignInService } from './phone-sign-in.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { PhoneChangeController } from '../phone-change/phone-change.controller';
import { PhoneChangeService } from '../phone-change/phone-change.service';

// The code goes out through the worker while the user waits (direct-send);
// the code that confirms a new number in Setări goes out the same way, so its
// change lives here too. `sending` is a module that exports DirectSend: the
// application's NotificationsModule.
@Module({})
export class PhoneSignInModule {
  static register(sending: DynamicModule): DynamicModule {
    return {
      controllers: [PhoneChangeController, PhoneSignInController],
      imports: [sending],
      module: PhoneSignInModule,
      providers: [
        PhoneChangeService,
        PhoneSignInService,
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
