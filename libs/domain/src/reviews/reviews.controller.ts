import {
  JobReviewContextDto,
  PublishReviewDto,
  ReviewDto,
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
  @ApiConflictResponse({
    description: 'job_not_done; email_not_confirmed; review_exists',
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
