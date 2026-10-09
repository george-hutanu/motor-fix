import {
  ConfirmDocumentPageDto,
  DocumentUploadAddressDto,
  DocumentUploadRequestDto,
  DraftDocumentDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ListingDocumentsService } from './listing-documents.service';
import { Public } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import {
  NoStore,
  TOKEN,
  tokenHeader,
} from '../../listing-drafts/listing-drafts.controller';

@ApiTags('listing-drafts')
@UseInterceptors(NoStore)
@Controller('listing-drafts/:id/documents/:kind')
export class ListingDocumentsController {
  constructor(private readonly documents: ListingDocumentsService) {}

  @Public()
  @Post('upload-url')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @tokenHeader
  @ApiCreatedResponse({ type: DocumentUploadAddressDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  @ApiUnprocessableEntityResponse({
    description:
      'document_kind_unknown, document_full, file_type_not_allowed, file_too_large',
  })
  uploadAddress(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: DocumentUploadRequestDto,
    @Headers(TOKEN) token?: string,
  ): Promise<DocumentUploadAddressDto> {
    return this.documents.uploadAddress(id, kind, token, body);
  }

  @Public()
  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @tokenHeader
  @ApiCreatedResponse({ type: DraftDocumentDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted, file_missing' })
  @ApiUnprocessableEntityResponse({
    description:
      'document_kind_unknown, document_full, file_type_mismatch, file_too_large',
  })
  confirm(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: ConfirmDocumentPageDto,
    @Headers(TOKEN) token?: string,
  ): Promise<DraftDocumentDto> {
    return this.documents.confirm(id, kind, token, body.key);
  }

  @Public()
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @tokenHeader
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  @ApiUnprocessableEntityResponse({ description: 'document_kind_unknown' })
  remove(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('key') key: string,
    @Headers(TOKEN) token?: string,
  ): Promise<void> {
    return this.documents.remove(id, kind, token, key);
  }
}
