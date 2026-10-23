import { type DynamicModule, Module } from '@nestjs/common';

import { OwnerDocumentsController } from './owner-documents.controller';
import {
  OWNER_DOCUMENTS_WEB_URL,
  OwnerDocumentsService,
} from './owner-documents.service';

// Apart from GaragesModule, whose specs run without storage: `garages` and
// `notifications` are the application's own; `webUrl` links the admins'
// message to their dashboard.
@Module({})
export class OwnerDocumentsModule {
  static register(
    garages: DynamicModule,
    notifications: DynamicModule,
    webUrl: string | undefined,
  ): DynamicModule {
    return {
      controllers: [OwnerDocumentsController],
      imports: [garages, notifications],
      module: OwnerDocumentsModule,
      providers: [
        OwnerDocumentsService,
        { provide: OWNER_DOCUMENTS_WEB_URL, useValue: webUrl },
      ],
    };
  }
}
