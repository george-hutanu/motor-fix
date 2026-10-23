import { type DynamicModule, Module } from '@nestjs/common';

import { PasswordResetController } from './password-reset.controller';
import {
  PasswordResetService,
  RESET_OPTIONS,
  type ResetOptions,
} from './password-reset.service';
import { AUDIT_PORT } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';
import { AccountDeletionController } from '../../account-deletion/account-deletion.controller';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';
import { PasswordChangeController } from '../password-change/password-change.controller';
import { PasswordChangeService } from '../password-change/password-change.service';

// Apart from the AuthModule, which the notifications module imports: the
// reset, the change and the account deletion send notices, so the
// AuthModule cannot hold them.
@Module({})
export class PasswordResetModule {
  // `notifications` is the application's NotificationsModule.
  static register(
    options: ResetOptions,
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [
        PasswordResetController,
        PasswordChangeController,
        AccountDeletionController,
      ],
      imports: [notifications],
      module: PasswordResetModule,
      providers: [
        PasswordResetService,
        PasswordChangeService,
        AccountDeletionService,
        { provide: RESET_OPTIONS, useValue: { webUrl: options.webUrl } },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
