import { GarageProfileDto, UpdateGarageProfileDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { GarageProfileService } from './garage-profile.service';
import { GarageProfileUpdate } from './garage-profile.update';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/profile')
export class GarageProfileController {
  constructor(
    private readonly profile: GarageProfileService,
    private readonly edit: GarageProfileUpdate,
  ) {}

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

  // The body is judged by the use case, after who asks and the garage's
  // state, so it reaches it as sent; the declared shape is the DTO's.
  @Patch()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      "Change the garage's name, description, phone, hours with closed days, service radius or facilities with payment methods in place",
  })
  @ApiBody({ type: UpdateGarageProfileDto })
  @ApiOkResponse({ type: GarageProfileDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a limit broken (errors[].field names it), an unknown field, an empty save, a radius for a workshop (radius_not_applicable), courtesy-car terms without the car or the car without its terms (no_courtesy_car)',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: the receptionist or mechanic of this garage',
  })
  @ApiNotFoundResponse({
    description: 'not_found: not this garage, or a garage not yet approved',
  })
  @ApiConflictResponse({
    description: 'profile_changed: the version is not the current one',
  })
  @ApiGoneResponse({ description: 'gone: the garage is suspended' })
  @ApiUnprocessableEntityResponse({
    description:
      'needs_verification: address, company or kinds of work, which change through a new verification (errors[].field names each)',
  })
  update(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<GarageProfileDto> {
    return this.edit.save(actor, garageId, body);
  }
}
