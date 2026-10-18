import { LegalCheckDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
      "The approved garage's legal check: company, CAEN, RAR and documents, for its owner",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiOkResponse({ type: LegalCheckDto })
  @ApiBadRequestResponse({ description: 'validation_failed: not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({
    description: 'not_found: not this garage, not approved, or no file',
  })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<LegalCheckDto> {
    return this.legalCheck.read(actor, garageId);
  }
}
