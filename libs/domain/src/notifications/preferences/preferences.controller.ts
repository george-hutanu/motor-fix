import {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from '@motor-fix/contracts';
import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { NotificationPreferencesService } from './preferences.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

// The signed-in person's own choices; no route names another account.
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  @ApiOkResponse({ type: NotificationPreferencesDto })
  read(@CurrentActor() actor: Actor): Promise<NotificationPreferencesDto> {
    return this.preferences.read(actor);
  }

  @Put()
  @ApiOkResponse({ type: NotificationPreferencesDto })
  save(
    @CurrentActor() actor: Actor,
    @Body() body: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return this.preferences.save(actor, body);
  }
}
