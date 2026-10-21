import { VerificationStatusDto } from '@motor-fix/contracts';
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

import { VerificationStatusService } from './verification-status.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/verification')
export class VerificationStatusController {
  constructor(private readonly verificationStatus: VerificationStatusService) {}

  @Get()
  @ApiOperation({
    summary:
      "Where the garage's listing stands in its verification, for its owner or an admin",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiOkResponse({ type: VerificationStatusDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({
    description: 'not_found: not this garage, a malformed id included',
  })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId') garageId: string,
  ): Promise<VerificationStatusDto> {
    return this.verificationStatus.read(actor, garageId);
  }
}
