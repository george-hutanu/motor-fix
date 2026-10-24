import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';

import { AccountController } from './account.controller';
import {
  ACCOUNT_OPTIONS,
  type AccountOptions,
  AccountService,
} from './account.service';
import { AUDIT_PORT } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';
import { AccountDeletionService } from '../../../auth/account-deletion/account-deletion.service';
import {
  PasswordResetService,
  RESET_OPTIONS,
} from '../../../auth/password/password-reset/password-reset.service';
import { FailureLog } from '../failure-log';

// The admin's page for one account and its actions. Apart from the accounts
// list, since the actions send e-mail through the notifications module and
// reuse the reset and the deletion.
@Module({})
export class AdminAccountModule implements NestModule {
  // `notifications` is the application's NotificationsModule.
  static register(
    options: AccountOptions,
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [AccountController],
      imports: [notifications],
      module: AdminAccountModule,
      providers: [
        AccountService,
        PasswordResetService,
        AccountDeletionService,
        { provide: ACCOUNT_OPTIONS, useValue: options },
        { provide: RESET_OPTIONS, useValue: { webUrl: options.webUrl } },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FailureLog).forRoutes(AccountController);
  }
}
