import {
  SimilarGaragesDto,
  SimilarGaragesQueryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SimilarGaragesService } from './similar-garages.service';
import { Public } from '../../auth/actor.guard';

@ApiTags('search')
@Controller('garages')
export class SimilarGaragesController {
  constructor(private readonly similar: SimilarGaragesService) {}

  @Get(':slug/similar')
  @Public()
  // Garages leave the list at any time; no cache on the way keeps an answer.
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SimilarGaragesDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a bad brand slug or another parameter',
  })
  @ApiNotFoundResponse({
    description:
      'not_found: no garage with that slug that was listed and is no longer, or no brand with that slug',
  })
  forGarage(
    @Param('slug') slug: string,
    @Query() query: SimilarGaragesQueryDto,
  ): Promise<SimilarGaragesDto> {
    return this.similar.forGarage(slug, query.brand);
  }
}
