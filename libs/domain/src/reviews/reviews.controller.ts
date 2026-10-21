import {
  JobReviewContextDto,
  PublishReviewDto,
  ReviewDto,
  ReviewEligibilityDto,
  ReviewEligibilityQueryDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ReviewsService } from './reviews.service';
import { CurrentActor, Requires } from '../auth/actor.guard';
import { JsonOnly } from '../auth/auth.controller';
import type { Actor } from '../auth/policy';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get('eligibility')
  @Requires('driver.reviews')
  @ApiOperation({
    summary: 'Whether the caller may review each of their jobs, and why not',
  })
  @ApiOkResponse({ type: [ReviewEligibilityDto] })
  @ApiBadRequestResponse({
    description: 'validation_failed: no id, more than 50, or one not a UUID',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: the caller is not a driver' })
  eligibility(
    @CurrentActor() actor: Actor,
    @Query() query: ReviewEligibilityQueryDto,
  ): Promise<ReviewEligibilityDto[]> {
    return this.service.eligibility(actor, query.jobIds);
  }

  @Get('job/:jobId')
  @Requires('driver.reviews')
  @ApiOperation({
    summary: 'A finished job as its review shows it, with the review if any',
  })
  @ApiOkResponse({ type: JobReviewContextDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the caller’s job' })
  forJob(
    @CurrentActor() actor: Actor,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
  ): Promise<JobReviewContextDto> {
    return this.service.read(actor, jobId);
  }

  @Post()
  @Requires('driver.reviews')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Publish a review of the caller’s finished job' })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a bad id, type or member',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not the caller’s job' })
  @ApiForbiddenResponse({
    description: 'own_garage: staff of the job’s garage',
  })
  @ApiConflictResponse({
    description:
      'job_not_done; already_reviewed; review_removed; email_not_confirmed',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: rating, paidBani or text out of range, named in errors',
  })
  publish(
    @CurrentActor() actor: Actor,
    @Body() body: PublishReviewDto,
  ): Promise<ReviewDto> {
    return this.service.publish(actor, body);
  }
}
