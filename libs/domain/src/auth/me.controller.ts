import { type GarageAccessDto, MeDto, UpdateMeDto } from '@motor-fix/contracts';
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
    const { emailVerifiedAt, ...account } =
      await this.prisma.account.findUniqueOrThrow({
        select: {
          city: true,
          email: true,
          emailVerifiedAt: true,
          language: true,
          name: true,
        },
        where: { id: actor.accountId },
      });
    return {
      ...account,
      capabilities: capabilitiesOf(actor.role, actor.permissions),
      emailConfirmed: Boolean(account.email && emailVerifiedAt),
      garageAccess: await this.garageAccess(actor.accountId),
      garageId: actor.garageId,
      id: actor.accountId,
      landing: landingFor(actor.role),
      role: actor.role,
      roles: actor.roles,
    };
  }

  // Read from the memberships and the mechanic card, never from the address.
  private async garageAccess(accountId: string): Promise<GarageAccessDto[]> {
    const garage = {
      select: {
        features: { select: { enabled: true, key: true } },
        id: true,
        name: true,
        status: true,
      },
    } as const;
    const [memberships, card] = await Promise.all([
      this.prisma.garageMember.findMany({
        include: { garage },
        orderBy: { joinedAt: 'asc' },
        where: { accountId },
      }),
      this.prisma.mechanic.findUnique({
        include: { garage },
        where: { accountId },
      }),
    ]);
    const entry = (
      at: (typeof memberships)[number]['garage'],
      role: GarageAccessDto['role'],
      permissions: GarageAccessDto['permissions'],
    ): GarageAccessDto => ({
      features: Object.fromEntries(at.features.map((f) => [f.key, f.enabled])),
      garageId: at.id,
      name: at.name,
      permissions,
      role,
      status: at.status,
    });
    return [
      ...memberships.map((m) =>
        entry(m.garage, m.role, {
          canAnswerQuotes: true,
          canMoveBookings: true,
          canRecordFinalPrice: true,
        }),
      ),
      // A member's own row wins over a mechanic card at the same garage.
      ...(card && !memberships.some((m) => m.garageId === card.garageId)
        ? [
            entry(card.garage, 'mechanic', {
              canAnswerQuotes: card.canAnswerQuotes,
              canMoveBookings: card.canMoveBookings,
              canRecordFinalPrice: card.canRecordFinalPrice,
            }),
          ]
        : []),
    ];
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
