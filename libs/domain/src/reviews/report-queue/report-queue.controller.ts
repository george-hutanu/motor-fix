import {
  ReportQueueDto,
  ReportQueueQueryDto,
  ReviewDecisionDto,
  ReviewDecisionResultDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ReportQueueService } from './report-queue.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { ReviewDecisionsService } from '../decision/decision.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/review-reports')
export class ReportQueueController {
  constructor(
    private readonly queue: ReportQueueService,
    private readonly decisions: ReviewDecisionsService,
  ) {}

  // Reading the queue is not logged. The texts follow the admin's language.
  @Get()
  @Requires('admin.reviews')
  @ApiOperation({
    summary: 'The pending review reports, oldest first, 20 a page',
  })
  @ApiOkResponse({ type: ReportQueueDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: page is not a positive integer',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'account_suspended' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(
    @CurrentActor() actor: Actor,
    @Query() { page = 1 }: ReportQueueQueryDto,
  ): Promise<ReportQueueDto> {
    return this.queue.read({
      language: actor.language === 'en' ? 'en' : 'ro',
      page,
    });
  }

  // Decides the review's one pending report; this story removes. The review
  // or reply, the report, the audit entries and the event go together.
  @Post(':reviewId/decision')
  @HttpCode(200)
  @Requires('admin.reviews')
  @ApiOperation({
    summary: "Decide a review's pending report; this story removes",
  })
  @ApiOkResponse({ type: ReviewDecisionResultDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad id, decision not remove, reason not one of the eight rules (other included), or an extra member',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'account_suspended' })
  @ApiNotFoundResponse({
    description: 'not_found: not an admin, or no review with that id',
  })
  @ApiConflictResponse({
    description:
      "already_decided (with decidedBy, the first decider's short name); no_pending_report",
  })
  decide(
    @CurrentActor() actor: Actor,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ReviewDecisionResultDto> {
    return this.decisions.decide(actor, reviewId, dto);
  }
}
