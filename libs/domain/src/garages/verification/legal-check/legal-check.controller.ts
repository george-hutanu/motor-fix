import { LegalCheckDto } from '@motor-fix/contracts';
import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { LegalCheckService } from './legal-check.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/legal-check')
export class LegalCheckController {
  constructor(private readonly legalCheck: LegalCheckService) {}

  @Get()
  @ApiOperation({
    summary:
      "The approved or suspended garage's legal check: company, CAEN, RAR and documents, with its latest re-check, for its owner",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiOkResponse({ type: LegalCheckDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({
    description:
      'not_found: not this garage (a malformed id included), a draft, or no file',
  })
  read(
    @CurrentActor() actor: Actor,
    // An id that is not the actor's own garage, a malformed one included,
    // answers 404 before any read.
    @Param('garageId') garageId: string,
  ): Promise<LegalCheckDto> {
    return this.legalCheck.read(actor, garageId);
  }
}
