import { ReportQueueDto, ReportQueueQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
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

import { ReportQueueService } from './report-queue.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/review-reports')
export class ReportQueueController {
  constructor(private readonly queue: ReportQueueService) {}

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
}
