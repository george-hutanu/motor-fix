import {
  STATIC_MAP_CACHE_CONTROL,
  StaticMapQueryDto,
} from '@motor-fix/contracts';
import { snapCentre } from '@motor-fix/contracts/map-view';
import {
  BadRequestException,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  Query,
  Req,
  Res,
  StreamableFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { catchError, type Observable, tap, throwError } from 'rxjs';

import { recordRender } from './static-map.metrics';
import { MapTilesUnavailable, StaticMapRenderer } from './static-map.renderer';
import { Public } from '../../auth/actor.guard';
import { refusal } from '../../auth/http-refusal';
import { RateLimits } from '../../rate-limit/rate-limit.service';

// Wraps the query check too, which runs inside the handler's call: every
// refusal leaves with no-store, and each answer is counted by outcome.
@Injectable()
export class StaticMapAnswers implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    return next.handle().pipe(
      tap(() => recordRender('ok', seconds())),
      catchError((error: unknown) => {
        if (error instanceof BadRequestException) recordRender('invalid');
        if (error instanceof MapTilesUnavailable) {
          recordRender('tiles_failed', seconds());
          return throwError(() =>
            refusal(
              HttpStatus.BAD_GATEWAY,
              'map_tiles_unavailable',
              'The map tiles did not answer',
            ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}

@ApiTags('maps')
@Controller('maps')
@UseInterceptors(StaticMapAnswers)
export class StaticMapController {
  constructor(
    private readonly renderer: StaticMapRenderer,
    private readonly limits: RateLimits,
  ) {}

  @Get('static')
  @Public()
  @ApiProduces('image/webp')
  @ApiOkResponse({
    description:
      'The map at the snapped centre, named in X-Map-Lat and X-Map-Lng; the same query always draws the same image',
  })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a theme other than light or dark, a zoom not a whole 5 to 16, a centre outside Romania, a width or height not one of the sizes, or more than 1280 × 1024',
  })
  @ApiTooManyRequestsResponse({
    description: 'rate_limited: too many maps from this address',
  })
  @ApiBadGatewayResponse({
    description:
      'map_tiles_unavailable: the tile provider failed or took too long',
  })
  async render(
    @Query() query: StaticMapQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    await this.limits.take('staticMap', req.ip ?? '');
    const centre = snapCentre(query, query.z, query.w);
    const image = await this.renderer.render({
      h: query.h,
      theme: query.theme,
      w: query.w,
      z: query.z,
      ...centre,
    });
    res.setHeader('Cache-Control', STATIC_MAP_CACHE_CONTROL);
    res.setHeader('X-Map-Lat', String(centre.lat));
    res.setHeader('X-Map-Lng', String(centre.lng));
    return new StreamableFile(image, { type: 'image/webp' });
  }
}
