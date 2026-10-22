import { BrandDto, PopularBrandsQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { PopularBrandsService, tilesRead } from './popular-brands.service';
import { CurrentActor, OptionalActor, Public } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
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
  @OptionalActor()
  @PublicCache()
  @ApiOkResponse({
    description:
      'Active brands by popularity, unranked last, then by name; a signed-in driver’s own cars’ brands first',
    type: [BrandDto],
  })
  @ApiBadRequestResponse({
    description: 'validation_failed: limit is not a whole number from 1 to 16',
  })
  tiles(
    @Query() query: PopularBrandsQueryDto,
    @CurrentActor() actor?: Actor,
  ): Promise<BrandDto[]> {
    // A driver's order is theirs alone: never cached, never shared.
    if (actor) return this.popular.tiles(query.limit, actor.accountId);
    return this.cache.read(tilesRead(this.popular, query.limit));
  }
}
