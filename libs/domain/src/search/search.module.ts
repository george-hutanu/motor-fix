import { Module } from '@nestjs/common';

import { GarageSearchCache } from './garage-search/garage-search.cache';
import { GarageSearchController } from './garage-search/garage-search.controller';
import { GarageSearchService } from './garage-search/garage-search.service';
import { HomeController } from './home/home.controller';
import { HomeService } from './home/home.service';
import { PopularBrandsController } from './popular-brands/popular-brands.controller';
import { PopularBrandsService } from './popular-brands/popular-brands.service';
import { SearchLogService } from './search-log/search-log.service';

// The PostgreSQL and Redis clients come from the global AuthModule.
@Module({
  controllers: [
    GarageSearchController,
    HomeController,
    PopularBrandsController,
  ],
  providers: [
    GarageSearchCache,
    GarageSearchService,
    HomeService,
    PopularBrandsService,
    SearchLogService,
  ],
})
export class SearchModule {}
