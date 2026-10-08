import {
  GarageSearchPageDto,
  GarageSearchQueryDto,
  parseNear,
} from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { GarageSearchService } from './garage-search.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('search')
@Controller('search/garages')
export class GarageSearchController {
  constructor(private readonly search: GarageSearchService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: GarageSearchPageDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: brandId missing or not a uuid, or near not a lat,lng in Romania; invalid_cursor: not a page of this search',
  })
  @ApiNotFoundResponse({ description: 'not_found: no brand with that id' })
  forBrand(@Query() query: GarageSearchQueryDto): Promise<GarageSearchPageDto> {
    return this.search.forBrand(
      query.brandId,
      query.cursor,
      parseNear(query.near),
    );
  }
}
