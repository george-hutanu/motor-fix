import { MeDto, UpdateMeDto } from '@motor-fix/contracts';
import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AccountsService } from './accounts.service';
import { CurrentActor } from './actor.guard';
import { capabilitiesOf } from './capabilities';
import { type Actor, landingFor } from './policy';
import { PRISMA } from './prisma';
import type { PrismaClient } from '../generated/prisma/client';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly accounts: AccountsService,
  ) {}

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

  @Patch()
  @ApiOkResponse({ type: MeDto })
  async update(
    @CurrentActor() actor: Actor,
    @Body() body: UpdateMeDto,
  ): Promise<MeDto> {
    await this.accounts.setLanguage(actor, body.language);
    return this.me(actor);
  }
}
