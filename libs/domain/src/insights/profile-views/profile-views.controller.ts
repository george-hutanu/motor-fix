import { ProfileViewDto } from '@motor-fix/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { recordView } from './profile-views.metrics';
import { ProfileViewsService } from './profile-views.service';
import { ProfileViewsThrottle } from './profile-views.throttle';
import { CurrentActor, OptionalActor, Public } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@Controller('garages')
export class ProfileViewsController {
  constructor(
    private readonly views: ProfileViewsService,
    @Inject(ProfileViewsThrottle)
    private readonly throttle: ProfileViewsThrottle,
  ) {}

  // The public profile's beacon. Whatever became of the view, the answer is
  // the same, so it says nothing about who was counted.
  @Public()
  @OptionalActor()
  @Post(':id/views')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Received; counted or not' })
  @ApiNotFoundResponse({ description: 'not_found: no approved garage' })
  @ApiTooManyRequestsResponse({ description: 'profile_views_rate_limited' })
  async record(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: ProfileViewDto,
    @CurrentActor() actor?: Actor,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (Array.isArray(body)) {
      throw new BadRequestException({
        code: 'validation',
        message: 'The body must be an object',
      });
    }
    const wait = await this.throttle.take(req.ip ?? '');
    if (wait !== null) {
      recordView('throttled');
      res.setHeader('Retry-After', String(wait));
      throw new HttpException(
        {
          code: 'profile_views_rate_limited',
          message: 'Too many profile views from here; try again shortly',
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.views.record(
      id,
      { actor, address: req.ip ?? '', userAgent: req.header('user-agent') },
      body?.source,
    );
  }
}
