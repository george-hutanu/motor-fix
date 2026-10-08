import { HomeDto, HomeQueryDto, parseNear } from '@motor-fix/contracts';
import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { HomeService } from './home.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: HomeDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: brand is not a slug, or near is not a lat,lng in Romania',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no active brand with that slug',
  })
  async forBrand(
    @Query() query: HomeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HomeDto> {
    const home = await this.home.forBrand(query.brand, parseNear(query.near));
    res.setHeader('Cache-Control', 'public, max-age=60');
    return home;
  }
}
