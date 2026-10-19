import { PublicGarageDto, PublicGarageQueryDto } from '@motor-fix/contracts';
import { parseNear } from '@motor-fix/contracts/search-place';
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { PublicGaragesService } from './public-garages';
import { Public } from '../../auth/actor.guard';
import { PublicCache } from '../../cache/http-cache/http-cache.interceptor';

@ApiTags('garages')
@Controller('garages')
export class PublicGaragesController {
  constructor(private readonly garages: PublicGaragesService) {}

  @Public()
  @PublicCache()
  @Get(':slug')
  @ApiOkResponse({ type: PublicGarageDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: near is not a lat,lng in Romania',
  })
  @ApiNotFoundResponse({ description: 'not_found: never approved, or unknown' })
  @ApiGoneResponse({ description: 'gone: suspended' })
  bySlug(
    @Param('slug') slug: string,
    @Query() query: PublicGarageQueryDto,
  ): Promise<PublicGarageDto> {
    return this.garages.bySlug(slug, query.brand, parseNear(query.near));
  }
}
