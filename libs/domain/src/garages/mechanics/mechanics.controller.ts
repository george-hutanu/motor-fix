import {
  CreateMechanicDto,
  GarageMechanicDto,
  GarageMechanicsDto,
  UpdateMechanicDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { GarageMechanicsService } from './garage-mechanics.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/mechanics')
export class GarageMechanicsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly mechanics: GarageMechanicsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "The garage's mechanic cards, for the owner" })
  @ApiOkResponse({ type: GarageMechanicsDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  list(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<GarageMechanicsDto> {
    // The pipe lets an upper-case uuid through; the actor's garage ids are lower case.
    return this.mechanics.list(this.prisma, actor, garageId.toLowerCase());
  }

  @Post()
  @ApiOperation({ summary: 'Add a mechanic card, for the owner' })
  @ApiCreatedResponse({ type: GarageMechanicDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: staff of this garage; mechanic_owned_field',
  })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiUnprocessableEntityResponse({
    description: 'validation_failed, with errors: [{ code, field }]',
  })
  add(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: CreateMechanicDto,
  ): Promise<GarageMechanicDto> {
    return this.mechanics.add(this.prisma, actor, garageId.toLowerCase(), body);
  }

  @Patch(':mechanicId')
  @ApiOperation({ summary: 'Edit a mechanic card, for the owner' })
  @ApiOkResponse({ type: GarageMechanicDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({
    description: 'forbidden: staff of this garage; mechanic_owned_field',
  })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiUnprocessableEntityResponse({
    description: 'validation_failed, with errors: [{ code, field }]',
  })
  edit(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('mechanicId', new ParseUUIDPipe()) mechanicId: string,
    @Body() body: UpdateMechanicDto,
  ): Promise<GarageMechanicDto> {
    return this.mechanics.edit(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      mechanicId.toLowerCase(),
      body,
    );
  }

  @Delete(':mechanicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a mechanic from the team, for the owner' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiConflictResponse({ description: "owner_row: the owner's own row" })
  remove(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('mechanicId', new ParseUUIDPipe()) mechanicId: string,
  ): Promise<void> {
    return this.mechanics.remove(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      mechanicId.toLowerCase(),
    );
  }
}
