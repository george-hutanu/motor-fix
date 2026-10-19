import {
  PushKeyDto,
  PushSubscriptionDto,
  PushTestQueuedDto,
  SavePushSubscriptionDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';

import { PushSubscriptionsService } from './push-subscriptions.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { RateLimits } from '../../../rate-limit/rate-limit.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('push-subscriptions')
export class PushSubscriptionsController {
  constructor(
    private readonly devices: PushSubscriptionsService,
    private readonly limits: RateLimits,
  ) {}

  @Get('key')
  @ApiOkResponse({ type: PushKeyDto })
  key(): PushKeyDto {
    return this.devices.key();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PushSubscriptionDto })
  save(
    @CurrentActor() actor: Actor,
    @Body() body: SavePushSubscriptionDto,
  ): Promise<PushSubscriptionDto> {
    return this.devices.save(actor.accountId, body);
  }

  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: PushTestQueuedDto })
  @ApiTooManyRequestsResponse({
    description: 'rate_limited: too many test notifications for this account',
  })
  async test(@CurrentActor() actor: Actor): Promise<PushTestQueuedDto> {
    await this.limits.take('pushTest', actor.accountId);
    return this.devices.test(actor.accountId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.devices.remove(actor.accountId, id);
  }
}
