import { type DynamicModule, Module } from '@nestjs/common';

import { OwnerPhotosController } from './owner-photos.controller';
import { OwnerPhotosSave } from './owner-photos.save';
import { OwnerPhotosService } from './owner-photos.service';
import { AUDIT_PORT } from '../../../audit/audit.port';
import { AuditService } from '../../../audit/audit.service';

// Beside ListingPhotosModule, whose queue and copies it reuses; storage,
// the rate limits and the event outbox are global.
@Module({})
export class OwnerPhotosModule {
  static register(listingPhotos: DynamicModule): DynamicModule {
    return {
      controllers: [OwnerPhotosController],
      imports: [listingPhotos],
      module: OwnerPhotosModule,
      providers: [
        { provide: AUDIT_PORT, useClass: AuditService },
        OwnerPhotosSave,
        OwnerPhotosService,
      ],
    };
  }
}
