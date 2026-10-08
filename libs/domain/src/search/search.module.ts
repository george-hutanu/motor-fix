import { Module } from '@nestjs/common';

import { GarageSearchController } from './garage-search/garage-search.controller';
import { GarageSearchService } from './garage-search/garage-search.service';
import { HomeController } from './home/home.controller';
import { HomeService } from './home/home.service';
import { PopularBrandsController } from './popular-brands/popular-brands.controller';
import { PopularBrandsService } from './popular-brands/popular-brands.service';

// The client comes from the global AuthModule.
@Module({
  controllers: [
    GarageSearchController,
    HomeController,
    PopularBrandsController,
  ],
  providers: [GarageSearchService, HomeService, PopularBrandsService],
})
export class SearchModule {}
