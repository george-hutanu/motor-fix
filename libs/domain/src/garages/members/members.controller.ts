import { GarageMembersDto } from '@motor-fix/contracts';
import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
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

import { GarageMembersService } from './members.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/members')
export class GarageMembersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly members: GarageMembersService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Who has access to the garage: its members and open invites, for the owner',
  })
  @ApiOkResponse({ type: GarageMembersDto })
  @ApiBadRequestResponse({ description: 'the garage id is not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  list(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<GarageMembersDto> {
    // The pipe lets an upper-case uuid through; the actor's garage ids are lower case.
    return this.members.list(this.prisma, actor, garageId.toLowerCase());
  }
}
