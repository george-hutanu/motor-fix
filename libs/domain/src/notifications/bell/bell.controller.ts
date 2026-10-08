import {
  NotificationDto,
  NotificationListQueryDto,
  NotificationPageDto,
  UnreadCountDto,
} from '@motor-fix/contracts';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { BellService } from './bell.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

// The signed-in person's own bell; no route names another account.
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class BellController {
  constructor(private readonly bell: BellService) {}

  @Get()
  @ApiOkResponse({ type: NotificationPageDto })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: NotificationListQueryDto,
  ): Promise<NotificationPageDto> {
    return this.bell.list(actor.accountId, query);
  }

  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(@CurrentActor() actor: Actor): Promise<UnreadCountDto> {
    return { count: await this.bell.unreadCount(actor.accountId) };
  }

  // Declared before `:id/read`, so the path is never read as an id.
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  readAll(@CurrentActor() actor: Actor): Promise<void> {
    return this.bell.readAll(actor.accountId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse()
  read(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDto> {
    return this.bell.read(actor.accountId, id);
  }
}
