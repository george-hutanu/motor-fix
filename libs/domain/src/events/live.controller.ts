import { randomUUID } from 'node:crypto';

import { LiveTestDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { audienceOf } from './audience';
import { LiveHub } from './live.hub';
import { verifyAccessToken } from '../auth/access-token';
import {
  AUTH_OPTIONS,
  type AuthOptions,
  CurrentActor,
  Requires,
} from '../auth/actor.guard';
import type { Actor } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

@ApiTags('live')
@ApiBearerAuth()
@Controller()
export class LiveController {
  constructor(
    private readonly hub: LiveHub,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_OPTIONS) private readonly auth: AuthOptions,
  ) {}

  @Get('live')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'A server-sent events stream' })
  async live(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = req.header('authorization')?.slice('Bearer '.length) ?? '';
    // The guard accepted this token; reading it again gives its expiry.
    const expiresAt =
      verifyAccessToken(token, this.auth.tokenSecret)?.expiresAt ?? Date.now();
    const channels = await this.channels(actor);
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    this.hub.open(res, {
      accountId: actor.accountId,
      channels,
      expiresAt,
      garageId: actor.garageId,
      role: actor.role,
    });
  }

  @Post('admin/live/test')
  @HttpCode(HttpStatus.ACCEPTED)
  // In the guard, so a non-admin gets 404 before the body is validated.
  @Requires('admin.users')
  @ApiAcceptedResponse({ description: 'The test update was published' })
  async test(@Body() body: LiveTestDto) {
    const target = await this.prisma.account.findUnique({
      select: { id: true },
      where: { id: body.accountId },
    });
    if (!target) throw new NotFoundException();
    const event = {
      at: new Date().toISOString(),
      id: randomUUID(),
      kind: 'live.test',
    };
    try {
      await this.hub.publish(
        event,
        audienceOf({ accountId: target.id, type: 'account' }),
      );
    } catch {
      throw new HttpException(
        { code: 'live_unavailable', message: 'Live updates are unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
