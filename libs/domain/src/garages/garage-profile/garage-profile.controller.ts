import { GarageProfileDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { GarageProfileService } from './garage-profile.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/profile')
export class GarageProfileController {
  constructor(private readonly profile: GarageProfileService) {}

  @Get()
  @ApiOperation({
    summary:
      "The garage's public profile as drivers see it, with its stored phone",
  })
  @ApiOkResponse({ type: GarageProfileDto })
  @ApiBadRequestResponse({ description: 'The garage id is not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: staff of this garage without the profile',
  })
  @ApiNotFoundResponse({
    description: 'not_found: not this garage, or a garage not yet approved',
  })
  @ApiGoneResponse({ description: 'The garage is suspended' })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<GarageProfileDto> {
    return this.profile.read(actor, garageId);
  }
}
