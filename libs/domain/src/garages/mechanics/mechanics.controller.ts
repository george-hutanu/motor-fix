import { GarageMechanicsDto } from '@motor-fix/contracts';
import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
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
}
