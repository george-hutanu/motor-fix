import { DocumentPageAddressDto } from '@motor-fix/contracts';
import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { LegalDocumentsService } from './legal-documents.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';

// The service decides who may open a page, not `@Requires`: the garage's own
// staff are answered 403, where the guard would answer every non-admin 404.
@ApiTags('verification-documents')
@ApiBearerAuth()
@Controller('admin/verification-files')
export class LegalDocumentsController {
  constructor(private readonly documents: LegalDocumentsService) {}

  @Get(':id/documents/:documentId/pages/:n/download-url')
  @ApiOkResponse({ type: DocumentPageAddressDto })
  @ApiForbiddenResponse({ description: "not_admin: the garage's own staff" })
  @ApiNotFoundResponse({
    description: 'not_found: not an admin, or no such file, document or page',
  })
  pageAddress(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Param('n') n: string,
  ): Promise<DocumentPageAddressDto> {
    return this.documents.pageAddress(actor, id, documentId, n);
  }
}
