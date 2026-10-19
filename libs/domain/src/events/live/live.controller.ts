import { randomUUID } from 'node:crypto';

import { LiveTestDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { LIVE_HEADERS, LiveHub } from './live.hub';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { verifyAccessToken } from '../../auth/access-token';
import {
  AUTH_OPTIONS,
  type AuthOptions,
  CurrentActor,
  OpenInMaintenance,
  Requires,
} from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { EVENT_PORT, type EventPort } from '../event.port';

// A client's last position: anything but a whole number above zero, of at
// most 18 digits, replays nothing.
export function positionOf(value: string | undefined): bigint | null {
  if (value === undefined || !/^\d{1,18}$/.test(value)) return null;
  const position = BigInt(value);
  return position > 0n ? position : null;
}

@ApiTags('live')
@ApiBearerAuth()
@Controller()
export class LiveController {
  constructor(
    private readonly hub: LiveHub,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_OPTIONS) private readonly auth: AuthOptions,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  @Get('live')
  @OpenInMaintenance()
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'A server-sent events stream' })
  @ApiQuery({
    description:
      'The last position the client saw, for a client that cannot send Last-Event-ID (the header wins)',
    name: 'since',
    required: false,
    type: String,
  })
  async live(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
    @Query('since') since?: string,
  ) {
    const token = req.header('authorization')?.slice('Bearer '.length) ?? '';
    // The guard accepted this token; reading it again gives its expiry.
    const expiresAt =
      verifyAccessToken(token, this.auth.tokenSecret)?.expiresAt ?? Date.now();
    const channels = await this.channels(actor);
    res.writeHead(200, LIVE_HEADERS);
    res.flushHeaders();
    this.hub.open(res, {
      accountId: actor.accountId,
      channels,
      expiresAt,
      garageId: actor.garageId,
      role: actor.role,
      since: positionOf(req.header('last-event-id') ?? since),
    });
  }

  @Post('admin/live/test')
  @HttpCode(HttpStatus.ACCEPTED)
  // In the guard, so a non-admin gets 404 before the body is validated.
  @Requires('admin.users')
  @ApiAcceptedResponse({
    description: 'The test update was recorded; the relay sends it',
  })
  async test(@CurrentActor() actor: Actor, @Body() body: LiveTestDto) {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.account.findUnique({
        select: { id: true },
        where: { id: body.accountId },
      });
      if (!target) throw new NotFoundException();
      // A fresh id: the update is about nothing a screen would re-read.
      await this.events.record(tx, {
        audience: { accountId: target.id, type: 'account' },
        kind: 'live.test',
        payload: {},
        subjectId: randomUUID(),
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        kind: 'live.test',
        newValue: { accountId: target.id },
        subjectId: target.id,
        subjectType: 'account',
      });
    });
  }

  private async channels(actor: Actor) {
    const channels = [`account:${actor.accountId}`, 'system'];
    if (actor.garageId) channels.push(`garage:${actor.garageId}`);
    if (actor.role === 'mechanic') {
      const mechanic = await this.prisma.mechanic.findUnique({
        select: { id: true },
        where: { accountId: actor.accountId },
      });
      if (mechanic) channels.push(`mechanic:${mechanic.id}`);
    }
    if (actor.role === 'admin') channels.push('admin');
    return channels;
  }
}
