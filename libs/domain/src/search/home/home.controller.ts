import { HomeDto, HomeQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HomeService } from './home.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOkResponse({ type: HomeDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: brand is not a slug, or near is not lat,lng',
  })
  @ApiNotFoundResponse({
    description: 'not_found: no active brand with that slug',
  })
  forBrand(@Query() query: HomeQueryDto): Promise<HomeDto> {
    return this.home.forBrand(query.brand);
  }
}
