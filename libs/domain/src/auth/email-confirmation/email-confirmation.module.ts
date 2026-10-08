import { type DynamicModule, Module } from '@nestjs/common';

import {
  EmailConfirmationController,
  MeEmailConfirmationController,
} from './email-confirmation.controller';
import {
  CONFIRMATION_OPTIONS,
  EmailConfirmationService,
} from './email-confirmation.service';
import { AUDIT_PORT } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';

// Global, so the AuthModule's sign-up can reach it: the notifications module
// imports the AuthModule, so the AuthModule cannot import notifications.
@Module({})
export class EmailConfirmationModule {
  // `notifications` is the application's NotificationsModule.
  static register(
    options: { webUrl?: string },
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
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
