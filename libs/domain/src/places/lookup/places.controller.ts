import { PlacesQueryDto, PlacesResultDto } from '@motor-fix/contracts';
import {
  inRomania,
  PLACE_SUGGESTIONS_MAX,
} from '@motor-fix/contracts/place-section';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { recordLookup } from './places.metrics';
import { PlacesThrottle } from './places.throttle';
import { Public } from '../../auth/actor.guard';
import {
  PLACES_PROVIDER,
  type PlacesAnswer,
  type PlacesProvider,
} from '../providers/places.provider';

@ApiTags('places')
@Controller('places')
export class PlacesController {
  private readonly logger = new Logger('Places');

  constructor(
    @Inject(PLACES_PROVIDER) private readonly provider: PlacesProvider,
    @Inject(PlacesThrottle) private readonly throttle: PlacesThrottle,
  ) {}

  // What the owner typed is personal: no browser or proxy keeps the answer.
  @Public()
  @Get()
  @ApiOkResponse({ type: PlacesResultDto })
  @ApiTooManyRequestsResponse({ description: 'places_rate_limited' })
  @ApiServiceUnavailableResponse({ description: 'search_unavailable' })
  async search(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query() { lang = 'ro', q }: PlacesQueryDto,
  ): Promise<PlacesResultDto> {
    res.setHeader('Cache-Control', 'no-store');
    const name = this.provider.name;
    const wait = await this.throttle.take(req.ip ?? '');
    if (wait !== null) {
      recordLookup(name, 'throttled');
      throw new HttpException(
        {
          code: 'places_rate_limited',
          message: 'Too many address look-ups from here; try again shortly',
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const started = performance.now();
    const answer = await this.provider
      .search(q, lang)
      .catch((error: unknown): PlacesAnswer => {
        this.logger.warn(
          `address search threw: ${(error as Error | undefined)?.name ?? 'unknown'}`,
        );
        return { unavailable: 'thrown' };
      });
    const seconds = (performance.now() - started) / 1_000;
    if ('unavailable' in answer) {
      recordLookup(name, 'unavailable', seconds);
      throw new HttpException(
        {
          code: 'search_unavailable',
          message: 'Address search is not available right now',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const items = answer.items
      .filter(({ lat, lng }) => inRomania(lat, lng))
      .slice(0, PLACE_SUGGESTIONS_MAX);
    recordLookup(name, items.length ? 'found' : 'empty', seconds);
    return { items };
  }
}
