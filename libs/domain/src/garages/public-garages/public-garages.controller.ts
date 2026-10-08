import { PublicGarageDto } from '@motor-fix/contracts';
import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { PublicGaragesService } from './public-garages';
import { Public } from '../../auth/actor.guard';

@ApiTags('garages')
@Controller('garages')
export class PublicGaragesController {
  constructor(private readonly garages: PublicGaragesService) {}

  @Public()
  @Get(':slug')
  @ApiOkResponse({ type: PublicGarageDto })
  @ApiNotFoundResponse({ description: 'not_found: never approved, or unknown' })
  @ApiGoneResponse({ description: 'gone: suspended' })
  bySlug(@Param('slug') slug: string): Promise<PublicGarageDto> {
    return this.garages.bySlug(slug);
  }
}
