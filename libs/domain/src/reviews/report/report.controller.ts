import { ReportReviewDto, ReviewReportDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';

import { ReviewReportsService } from './report.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller('reviews/:reviewId/reports')
export class ReviewReportsController {
  constructor(private readonly service: ReviewReportsService) {}

  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Report one of the garage’s reviews to an admin, with a reason',
  })
  @ApiCreatedResponse({ type: ReviewReportDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a reason outside the list, or a member',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: a receptionist or mechanic of the garage',
  })
  @ApiNotFoundResponse({
    description:
      'not_found: no such review of the caller’s garage, or one removed or deleted',
  })
  @ApiConflictResponse({ description: 'already_reported; already_kept' })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: the text missing or too long for other, or given with another reason',
  })
  report(
    @CurrentActor() actor: Actor,
    @Param('reviewId') reviewId: string,
    @Body() body: ReportReviewDto,
  ): Promise<ReviewReportDto> {
    // A bad id answers as an absent review, so it tells nothing apart.
    if (!isUUID(reviewId)) throw new NotFoundException();
    return this.service.report(actor, reviewId, body);
  }
}
