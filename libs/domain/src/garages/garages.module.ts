import { type DynamicModule, Module } from '@nestjs/common';

import { AdminOverviewController } from './admin-overview.controller';
import { PublicGaragesService } from './public-garages';
import { PublicGaragesController } from './public-garages.controller';
import {
  GarageInvitesController,
  InvitesController,
} from './staff-invite.controller';
import { INVITE_EMAIL, StaffInviteService } from './staff-invite.service';
import { VerificationService } from './verification.service';
import {
  VERIFICATION_CONFIG,
  type VerificationConfig,
} from './verification-config';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';
import { Brevo } from '../notifications/brevo';
import type { EmailConfig } from '../notifications/email-config';

// Apart from the AuthModule, which the notifications module imports: the
// invites tell the owner through the notifications.
@Module({})
export class GaragesModule {
  // `notifications` is the application's NotificationsModule. The invite
  // e-mail goes to an address that may have no account, so it is sent here
  // rather than queued.
  static register(
    email: EmailConfig,
    notifications: DynamicModule,
    verification: VerificationConfig,
  ): DynamicModule {
    return {
      controllers: [
        AdminOverviewController,
        GarageInvitesController,
        InvitesController,
        PublicGaragesController,
      ],
      exports: [VerificationService],
      imports: [notifications],
      module: GaragesModule,
      providers: [
        StaffInviteService,
        PublicGaragesService,
        VerificationService,
        { provide: VERIFICATION_CONFIG, useValue: verification },
        { provide: INVITE_EMAIL, useValue: email },
        {
          provide: Brevo,
          useFactory: () =>
            new Brevo({ apiKey: email.apiKey ?? '', apiUrl: email.apiUrl }),
        },
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
