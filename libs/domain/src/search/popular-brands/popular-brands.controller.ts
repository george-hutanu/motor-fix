import { BrandDto, PopularBrandsQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { PopularBrandsService } from './popular-brands.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('brands')
@Controller('brands')
export class PopularBrandsController {
  constructor(private readonly popular: PopularBrandsService) {}

  @Get('popular')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOkResponse({
    description: 'Active brands by popularity, unranked last, then by name',
    type: [BrandDto],
  })
  @ApiBadRequestResponse({
    description: 'validation_failed: limit is not a whole number from 1 to 12',
  })
  tiles(@Query() query: PopularBrandsQueryDto): Promise<BrandDto[]> {
    return this.popular.tiles(query.limit);
  }
}
