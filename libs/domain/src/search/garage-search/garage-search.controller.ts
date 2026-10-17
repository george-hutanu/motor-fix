import {
  GaragePinsDto,
  GaragePinsQueryDto,
  GarageSearchPageDto,
  GarageSearchQueryDto,
  parseBbox,
  parseNear,
} from '@motor-fix/contracts';
import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { GarageSearchService } from './garage-search.service';
import { Public } from '../../auth/actor.guard';
import { GaragePinsService } from '../garage-pins/garage-pins.service';

// The query holds exactly one of the two.
const brandIn = (query: GaragePinsQueryDto) =>
  query.brand === undefined ? (query.brandId as string) : { slug: query.brand };

@ApiTags('search')
@Controller('search/garages')
export class GarageSearchController {
  constructor(
    private readonly search: GarageSearchService,
    private readonly pinned: GaragePinsService,
  ) {}

  @Get()
  @Public()
  // Garages leave the list at any time; no cache on the way keeps an answer.
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: GarageSearchPageDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: neither or both of brand and brandId, a bad slug or uuid, near not a lat,lng in Romania, a radius other than 25 or 50, or ids not up to 20 distinct uuids; invalid_cursor: not a page of this search',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no brand with that slug or id',
  })
  forBrand(@Query() query: GarageSearchQueryDto): Promise<GarageSearchPageDto> {
    const brand = brandIn(query);
    const near = parseNear(query.near);
    if (query.ids !== undefined) {
      return this.search.byIds(brand, query.ids.split(','), near, query.radius);
    }
    return this.search.forBrand(
      brand,
      query.cursor,
      near,
      query.radius,
      query.log === '1',
    );
  }

  @Get('pins')
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: GaragePinsDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: neither or both of brand and brandId, a bad slug or uuid, near not a lat,lng in Romania, a radius other than 25 or 50, or bbox not a south,west,north,east box inside Romania at most 100 km on a side',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no brand with that slug or id',
  })
  pins(@Query() query: GaragePinsQueryDto): Promise<GaragePinsDto> {
    return this.pinned.forBrand(
      brandIn(query),
      parseNear(query.near),
      query.radius,
      query.bbox === undefined ? undefined : parseBbox(query.bbox),
    );
  }
}
