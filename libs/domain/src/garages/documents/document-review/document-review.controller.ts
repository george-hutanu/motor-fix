import { DocumentDecisionDto, DocumentRefusalDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { DocumentReviewService } from './document-review.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { NoStore } from '../../listing-drafts/listing-drafts.controller';

// An admin accepts or refuses one yearly document a garage sent.
@ApiTags('admin')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'not_found: not an admin, or no document' })
@ApiConflictResponse({ description: 'document_not_in_review' })
@UseInterceptors(NoStore)
@Controller('admin/legal-documents')
export class DocumentReviewController {
  constructor(private readonly reviews: DocumentReviewService) {}

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.garages')
  @ApiOkResponse({ type: DocumentDecisionDto })
  accept(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<DocumentDecisionDto> {
    return this.reviews.accept(actor, id);
  }

  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.garages')
  @ApiOkResponse({ type: DocumentDecisionDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  refuse(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: DocumentRefusalDto,
  ): Promise<DocumentDecisionDto> {
    return this.reviews.refuse(actor, id, body);
  }
}
