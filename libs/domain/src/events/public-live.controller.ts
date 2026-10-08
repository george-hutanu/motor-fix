import { PublicLiveQueryDto } from '@motor-fix/contracts';
import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { LiveHub } from './live/live.hub';
import { Public } from '../auth/actor.guard';
import { clientOf } from '../auth/attempts';
import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import { publicGarages } from '../garages/public-garages/public-garages';
import type { PrismaClient } from '../generated/prisma/client';

// A visitor's stream: no session, no token read, nothing written. An id that
// names nothing public is ignored rather than refused, so a stream says no
// more about a garage than its page does.
@ApiTags('live')
@Controller()
export class PublicLiveController {
  constructor(
    private readonly hub: LiveHub,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Get('live/public')
  @Public()
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'A server-sent events stream' })
  @ApiTooManyRequestsResponse({
    description: 'This address already holds its streams on this copy',
  })
  async live(
    @Query() query: PublicLiveQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const channels = await this.channels(query);
    // Counted after the read, with no await before open: a burst of requests
    // from one address cannot all pass the count while the reads run.
    const address = clientOf(req.ip ?? '');
    if (!this.hub.publicPlace(address)) {
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_streams',
        'Too many live streams from this address',
      );
    }
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    this.hub.open(res, { address, channels, public: true });
  }

  private async channels({ brand, garages, mechanics }: PublicLiveQueryDto) {
    const [garage, mechanic, known] = await Promise.all([
      garages &&
        this.prisma.garage.findFirst({
          select: { id: true },
          where: { id: garages, ...publicGarages() },
        }),
      mechanics &&
        this.prisma.mechanic.findFirst({
          select: { id: true },
          where: { garage: publicGarages(), id: mechanics },
        }),
      // A retired brand's page still shows its results.
      brand &&
        this.prisma.brand.findUnique({
          select: { id: true },
          where: { id: brand },
        }),
    ]);
    return [
      'system',
      ...(garage ? [`public:garage:${garage.id}`] : []),
      ...(mechanic ? [`public:mechanic:${mechanic.id}`] : []),
      ...(known ? [`public:search:${known.id}`, 'public:search'] : []),
    ];
  }
}
