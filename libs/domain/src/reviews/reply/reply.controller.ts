import { ReplyToReviewDto, ReviewReplyDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';

import { notFound, ReviewRepliesService } from './reply.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

const NOT_FOUND =
  'not_found: no such review of the caller’s garage (an edit: or no reply on it)';
const LENGTH =
  'validation_failed: the text is empty or over 1,000 characters after the trim';

@ApiTags('reviews')
@ApiBearerAuth()
@ApiBadRequestResponse({
  description: 'validation_failed: the text not a string, or another member',
})
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@ApiForbiddenResponse({
  description: 'forbidden: a receptionist or mechanic of the garage',
})
@ApiNotFoundResponse({ description: NOT_FOUND })
@ApiUnprocessableEntityResponse({ description: LENGTH })
@Controller('reviews/:reviewId/reply')
export class ReviewRepliesController {
  constructor(private readonly service: ReviewRepliesService) {}

  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reply in public to one of the garage’s reviews' })
  @ApiCreatedResponse({ type: ReviewReplyDto })
  @ApiConflictResponse({
    description: 'review_not_public; reply_removed; already_replied',
  })
  post(
    @CurrentActor() actor: Actor,
    @Param('reviewId') reviewId: string,
    @Body() body: ReplyToReviewDto,
  ): Promise<ReviewReplyDto> {
    // A bad id answers as an absent review, so it tells nothing apart.
    if (!isUUID(reviewId)) throw notFound(actor);
    return this.service.post(actor, reviewId, body);
  }

  @Patch()
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: 'Edit the garage’s reply to one of its reviews' })
  @ApiOkResponse({ type: ReviewReplyDto })
  @ApiConflictResponse({
    description: 'review_not_public; reply_not_public; reply_removed',
  })
  edit(
    @CurrentActor() actor: Actor,
    @Param('reviewId') reviewId: string,
    @Body() body: ReplyToReviewDto,
  ): Promise<ReviewReplyDto> {
    if (!isUUID(reviewId)) throw notFound(actor);
    return this.service.edit(actor, reviewId, body);
  }
}
