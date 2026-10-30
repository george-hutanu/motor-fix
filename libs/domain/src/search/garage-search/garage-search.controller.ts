import {
  filtersOf,
  GaragePinsDto,
  GaragePinsQueryDto,
  GarageSearchPageDto,
  GarageSearchQueryDto,
  parseBbox,
  parseNear,
} from '@motor-fix/contracts';
import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { GarageSearchService } from './garage-search.service';
import { Public } from '../../auth/actor.guard';
import { RateLimits } from '../../rate-limit/rate-limit.service';
import { GaragePinsService } from '../garage-pins/garage-pins.service';

// The query holds exactly one of the two.
const brandIn = (query: GaragePinsQueryDto) =>
  query.brand === undefined ? (query.brandId as string) : { slug: query.brand };

const bboxIn = (query: GaragePinsQueryDto) =>
  query.bbox === undefined ? undefined : parseBbox(query.bbox);

@ApiTags('search')
@Controller('search/garages')
export class GarageSearchController {
  constructor(
    private readonly search: GarageSearchService,
    private readonly pinned: GaragePinsService,
    private readonly limits: RateLimits,
  ) {}

  @Get()
  @Public()
  // Garages leave the list at any time; no cache on the way keeps an answer.
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: GarageSearchPageDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: neither or both of brand and brandId, a bad slug or uuid, near not a lat,lng in Romania, a radius other than 25 or 50, ids not up to 20 distinct uuids, bbox not a south,west,north,east box inside Romania at most 100 km on a side, or sort not rating, distance or price, or distance without near, or open_now or open_saturday other than exactly 1 or repeated; invalid_cursor: not a page of this search, of another box, of another sort or of other filters',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no brand with that slug or id',
  })
  @ApiTooManyRequestsResponse({
    description: 'rate_limited: too many searches from this address',
  })
  async forBrand(
    @Query() query: GarageSearchQueryDto,
    @Req() req: Request,
  ): Promise<GarageSearchPageDto> {
    await this.limits.take('search', req.ip ?? '');
    const brand = brandIn(query);
    const near = parseNear(query.near);
    const bbox = bboxIn(query);
    const filters = filtersOf(query, new Date());
    if (query.ids !== undefined) {
      return this.search.byIds(
        brand,
        query.ids.split(','),
        near,
        query.radius,
        bbox,
        filters,
      );
    }
    return this.search.forBrand(
      brand,
      query.cursor,
      near,
      query.radius,
      query.log === '1',
      bbox,
      query.sort,
      filters,
    );
  }

  @Get('pins')
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: GaragePinsDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: neither or both of brand and brandId, a bad slug or uuid, near not a lat,lng in Romania, a radius other than 25 or 50, or bbox not a south,west,north,east box inside Romania at most 100 km on a side, or open_now or open_saturday other than exactly 1 or repeated',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no brand with that slug or id',
  })
  pins(@Query() query: GaragePinsQueryDto): Promise<GaragePinsDto> {
    return this.pinned.forBrand(
      brandIn(query),
      parseNear(query.near),
      query.radius,
      bboxIn(query),
      filtersOf(query, new Date()),
    );
  }
}
