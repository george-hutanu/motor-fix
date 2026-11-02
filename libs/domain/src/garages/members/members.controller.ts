import { GarageMembersDto } from '@motor-fix/contracts';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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

  @Delete(':accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a receptionist from the garage, for the owner',
  })
  @ApiNoContentResponse({ description: 'removed' })
  @ApiBadRequestResponse({ description: 'an id is not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: "owner_row: the owner's own row" })
  remove(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
  ): Promise<void> {
    return this.members.remove(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      accountId.toLowerCase(),
    );
  }
}
