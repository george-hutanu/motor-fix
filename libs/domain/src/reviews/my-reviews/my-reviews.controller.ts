import {
  MechanicReviewsQueryDto,
  MyReviewsPageDto,
} from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { MyReviewsService } from './my-reviews.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

// The caller's own reviews and the repairs waiting for one. Any signed-in
// account may ask; one that drives no car gets an empty page.
@ApiTags('reviews')
@ApiBearerAuth()
@Controller('me/reviews')
export class MyReviewsController {
  constructor(private readonly service: MyReviewsService) {}

  @Get()
  @ApiOperation({
    summary:
      'The caller’s written reviews and the repairs waiting for one, waiting first, 20 a page, with the counts',
  })
  @ApiOkResponse({ type: MyReviewsPageDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a page not a whole number from 1',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  read(
    @CurrentActor() actor: Actor,
    @Query() query: MechanicReviewsQueryDto,
  ): Promise<MyReviewsPageDto> {
    return this.service.read(actor, query.page);
  }
}
