import {
  DocumentCycleDto,
  DocumentsSubmitDto,
  DocumentUploadAddressDto,
  DocumentUploadRequestDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { OwnerDocumentsService } from './owner-documents.service';
import { CurrentActor } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import type { Actor } from '../../../auth/policy';
import { NoStore } from '../../listing-drafts/listing-drafts.controller';

// The owner's yearly upload of the garage's ONRC certificate and RAR
// authorisation; a session is required, as on every route.
@ApiTags('garages')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@ApiForbiddenResponse({ description: 'not_owner' })
@ApiNotFoundResponse({ description: 'No such approved garage of yours' })
@UseInterceptors(NoStore)
@Controller('garages/:garageId/legal-documents')
export class OwnerDocumentsController {
  constructor(private readonly owners: OwnerDocumentsService) {}

  @Post('upload-url')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: DocumentUploadAddressDto })
  @ApiConflictResponse({ description: 'document_in_review' })
  @ApiUnprocessableEntityResponse({
    description: 'file_type_not_allowed, file_too_large',
  })
  @ApiTooManyRequestsResponse({ description: 'rate_limited' })
  uploadUrl(
    @CurrentActor() actor: Actor,
    @Param('garageId') garageId: string,
    @Body() body: DocumentUploadRequestDto,
  ): Promise<DocumentUploadAddressDto> {
    return this.owners.uploadAddress(actor, garageId, body);
  }

  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: DocumentCycleDto })
  @ApiBadRequestResponse({ description: 'A malformed body' })
  @ApiConflictResponse({ description: 'document_in_review, file_missing' })
  @ApiUnprocessableEntityResponse({
    description:
      'both_documents_required, certificate_too_old, file_type_mismatch, file_too_large',
  })
  submit(
    @CurrentActor() actor: Actor,
    @Param('garageId') garageId: string,
    @Body() body: DocumentsSubmitDto,
  ): Promise<DocumentCycleDto | null> {
    return this.owners.submit(actor, garageId, body);
  }
}
