import { type DynamicModule, Module } from '@nestjs/common';

import { ListingDocumentsController } from './listing-documents.controller';
import { ListingDocumentsService } from './listing-documents.service';

// Apart from GaragesModule, whose specs run without storage: `garages` is
// the application's GaragesModule, for the drafts' token rule.
@Module({})
export class ListingDocumentsModule {
  static register(garages: DynamicModule): DynamicModule {
    return {
      controllers: [ListingDocumentsController],
      imports: [garages],
      module: ListingDocumentsModule,
      providers: [ListingDocumentsService],
    };
  }
}
