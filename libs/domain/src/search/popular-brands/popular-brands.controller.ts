import { BrandDto, PopularBrandsQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { PopularBrandsService, tilesRead } from './popular-brands.service';
import { Public } from '../../auth/actor.guard';
import { CacheService } from '../../cache/cache.service';
import { PublicCache } from '../../cache/http-cache/http-cache.interceptor';

@ApiTags('brands')
@Controller('brands')
export class PopularBrandsController {
  constructor(
    private readonly popular: PopularBrandsService,
    private readonly cache: CacheService,
  ) {}

  @Get('popular')
  @Public()
  @PublicCache()
  @ApiOkResponse({
    description: 'Active brands by popularity, unranked last, then by name',
    type: [BrandDto],
  })
  @ApiBadRequestResponse({
    description: 'validation_failed: limit is not a whole number from 1 to 12',
  })
  tiles(@Query() query: PopularBrandsQueryDto): Promise<BrandDto[]> {
    return this.cache.read(tilesRead(this.popular, query.limit));
  }
}
