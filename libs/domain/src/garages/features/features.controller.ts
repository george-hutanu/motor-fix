import { GarageFeaturesDto, SetGarageFeatureDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
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

import { GarageFeaturesService } from './features.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/features')
export class GarageFeaturesController {
  constructor(private readonly features: GarageFeaturesService) {}

  @Put(':feature')
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: "Switch one of the garage's features on or off" })
  @ApiOkResponse({ type: GarageFeaturesDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: an unknown feature or a bad enabled',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({
    description: 'mechanics_on_team: other mechanics are still on the team',
  })
  set(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('feature') feature: string,
    @Body() body: SetGarageFeatureDto,
  ): Promise<GarageFeaturesDto> {
    return this.features.set(actor, garageId, feature, body.enabled);
  }
}
