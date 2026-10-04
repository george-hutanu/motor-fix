import { MeDto } from '@motor-fix/contracts';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ActorGuard, CurrentActor } from './actor.guard';
import { capabilitiesOf } from './capabilities';
import { type Actor, landingFor } from './policy';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(ActorGuard)
export class MeController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  async me(@CurrentActor() actor: Actor): Promise<MeDto> {
    const account = await this.prisma.account.findUniqueOrThrow({
      select: { email: true, language: true, name: true },
      where: { id: actor.accountId },
    });
    return {
      ...account,
      capabilities: capabilitiesOf(actor.role, actor.permissions),
      garageId: actor.garageId,
      id: actor.accountId,
      landing: landingFor(actor.role),
      role: actor.role,
      roles: actor.roles,
    };
  }
}
