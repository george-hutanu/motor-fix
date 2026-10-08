import { BrandDto, PopularBrandsQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { PopularBrandsService } from './popular-brands.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('brands')
@Controller('brands')
export class PopularBrandsController {
  constructor(private readonly popular: PopularBrandsService) {}

  @Get('popular')
  @Public()
  @ApiOkResponse({
    description: 'Active brands by popularity, unranked last, then by name',
    type: [BrandDto],
  })
  @ApiBadRequestResponse({
    description: 'validation_failed: limit is not a whole number from 1 to 12',
  })
  async tiles(
    @Query() query: PopularBrandsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BrandDto[]> {
    const tiles = await this.popular.tiles(query.limit);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return tiles;
  }
}
