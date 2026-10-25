import {
  GarageStaffReviewsPageDto,
  MechanicReviewsQueryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { ReviewsService } from '../reviews.service';

// The garage's own reviews, read by its owner and receptionist. Read-only:
// replying and reporting come with their own stories.
@ApiTags('reviews')
@ApiBearerAuth()
@Controller('garages/:garageId/reviews')
export class GarageReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary:
      'The garage’s published and reported reviews, 20 a page, with its rating, count and breakdown',
  })
  @ApiOkResponse({ type: GarageStaffReviewsPageDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad id, or a page not a whole number from 1',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: a mechanic of this garage' })
  @ApiNotFoundResponse({ description: 'not_found: not the caller’s garage' })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Query() query: MechanicReviewsQueryDto,
  ): Promise<GarageStaffReviewsPageDto> {
    return this.service.staffReviews(actor, garageId, query.page);
  }
}
