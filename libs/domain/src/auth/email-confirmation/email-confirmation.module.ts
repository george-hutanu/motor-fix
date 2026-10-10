import { type DynamicModule, Module } from '@nestjs/common';

import { CONFIRMATION_OPTIONS } from './email-confirmation';
import {
  EmailConfirmationController,
  MeEmailConfirmationController,
} from './email-confirmation.controller';
import { EmailConfirmationService } from './email-confirmation.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import { EmailChangeController } from '../email-change/email-change.controller';
import { EmailChangeService } from '../email-change/email-change.service';

// Global, so the AuthModule's sign-up can reach it: the notifications module
// imports the AuthModule, so the AuthModule cannot import notifications. The
// e-mail change sends its link through notifications too, so it lives here.
@Module({})
export class EmailConfirmationModule {
  // `notifications` is the application's NotificationsModule.
  static register(
    options: { webUrl?: string },
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [
        EmailChangeController,
        EmailConfirmationController,
        MeEmailConfirmationController,
      ],
      exports: [EmailConfirmationService],
      global: true,
      imports: [notifications],
      module: EmailConfirmationModule,
      providers: [
        EmailChangeService,
        EmailConfirmationService,
        { provide: CONFIRMATION_OPTIONS, useValue: { webUrl: options.webUrl } },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
