import { type DynamicModule, Module } from '@nestjs/common';

import { ListingSubmitController } from './submit.controller';
import { ListingSubmitService } from './submit.service';
import { AUDIT_PORT } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';

// Apart from GaragesModule: the send reads the photos' sizes, and the photos
// module already imports `garages`. `notifications` is the application's
// NotificationsModule: a sent draft's waiting reminder is settled there.
@Module({})
export class ListingSubmitModule {
  static register(
    garages: DynamicModule,
    photos: DynamicModule,
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      controllers: [ListingSubmitController],
      imports: [garages, photos, notifications],
      module: ListingSubmitModule,
      providers: [
        ListingSubmitService,
        { provide: AUDIT_PORT, useClass: AuditService },
      ],
    };
  }
}
