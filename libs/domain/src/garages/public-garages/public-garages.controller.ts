import {
  GaragePickListDto,
  GaragePickQueryDto,
  PublicGarageDto,
  PublicGarageQueryDto,
} from '@motor-fix/contracts';
import { parseNear } from '@motor-fix/contracts/search-place';
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { PublicGaragesService } from './public-garages';
import { Public, Requires } from '../../auth/actor.guard';
import { PublicCache } from '../../cache/http-cache/http-cache.interceptor';

@ApiTags('garages')
@Controller('garages')
export class PublicGaragesController {
  constructor(private readonly garages: PublicGaragesService) {}

  // Declared before ':slug', so /garages never reads as an empty slug.
  @Get()
  @Requires('driver.cars')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approved garages whose name holds the text' })
  @ApiOkResponse({ type: GaragePickListDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: q not 2 to 80 characters, limit not 1 to 8',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not a driver' })
  search(@Query() query: GaragePickQueryDto): Promise<GaragePickListDto> {
    return this.garages.pick(query.q, query.limit);
  }

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
