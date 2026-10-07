import { Module } from '@nestjs/common';

import { GarageSearchController } from './garage-search.controller';
import { GarageSearchService } from './garage-search.service';

// The client comes from the global AuthModule.
@Module({
  controllers: [GarageSearchController],
  providers: [GarageSearchService],
})
export class SearchModule {}
