import { TestMessageDto, TestMessageQueuedDto } from '@motor-fix/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { NotificationsService } from './notifications.service';
import { Requires } from '../auth/actor.guard';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('admin/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  @Requires('admin.settings')
  @ApiAcceptedResponse({ type: TestMessageQueuedDto })
  async test(@Body() body: TestMessageDto): Promise<TestMessageQueuedDto> {
    return {
      queued: await this.notifications.sendTestMessage(body.accountIds),
    };
  }
}
