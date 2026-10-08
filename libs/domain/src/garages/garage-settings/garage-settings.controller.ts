import { GarageSettingsDto, UpdateGarageDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
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

import { GarageSettingsService } from './garage-settings.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId')
export class GarageSettingsController {
  constructor(private readonly settings: GarageSettingsService) {}

  @Patch()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary: "Change the garage's payment methods or courtesy car price",
  })
  @ApiOkResponse({ type: GarageSettingsDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: an empty body, no payment method, a bad price, a courtesy car the garage does not list',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  update(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: UpdateGarageDto,
  ): Promise<GarageSettingsDto> {
    return this.settings.update(actor, garageId, body);
  }
}
