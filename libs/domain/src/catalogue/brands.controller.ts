import { BrandPageDto, BrandsQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { BrandsService } from './brands.service';
import { Public } from '../auth/actor.guard';

@ApiTags('brands')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: BrandPageDto })
  search(@Query() query: BrandsQueryDto): Promise<BrandPageDto> {
    return this.brands.search(query.q, query.cursor);
  }
}
