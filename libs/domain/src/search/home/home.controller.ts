import { HomeDto, HomeQueryDto, parseNear } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HomeService, homeRead } from './home.service';
import { Public } from '../../auth/actor.guard';
import { CacheService } from '../../cache/cache.service';
import { PublicCache } from '../../cache/http-cache/http-cache.interceptor';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @Public()
  @PublicCache()
  @ApiOkResponse({ type: HomeDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: brand is not a slug, or near is not a lat,lng in Romania',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no active brand with that slug',
  })
  forBrand(@Query() query: HomeQueryDto): Promise<HomeDto> {
    return this.cache.read(
      homeRead(this.home, query.brand, parseNear(query.near)),
    );
  }
}
