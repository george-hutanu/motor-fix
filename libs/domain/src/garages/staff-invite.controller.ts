import {
  InviteTokenDto,
  InviteViewDto,
  StaffInviteDto,
  StaffInviteSentDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { StaffInviteService } from './staff-invite.service';
import { CurrentActor, Public } from '../auth/actor.guard';
import { JsonOnly } from '../auth/auth.controller';
import type { Actor } from '../auth/policy';

const uuid = new ParseUUIDPipe();

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/invites')
export class GarageInvitesController {
  constructor(private readonly invites: StaffInviteService) {}

  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: StaffInviteSentDto })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiConflictResponse({
    description: 'invite_open (with inviteId); already_in_team',
  })
  send(
    @CurrentActor() actor: Actor,
    @Param('garageId', uuid) garageId: string,
    @Body() body: StaffInviteDto,
  ): Promise<StaffInviteSentDto> {
    return this.invites.send(actor, garageId, body);
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StaffInviteSentDto })
  @ApiForbiddenResponse({ description: 'forbidden' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiConflictResponse({ description: 'invite_invalid: accepted or revoked' })
  resend(
    @CurrentActor() actor: Actor,
    @Param('garageId', uuid) garageId: string,
    @Param('id', uuid) id: string,
  ): Promise<StaffInviteSentDto> {
    return this.invites.resend(actor, garageId, id);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Revoked' })
  @ApiForbiddenResponse({ description: 'forbidden' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'invite_invalid: accepted or revoked' })
  async revoke(
    @CurrentActor() actor: Actor,
    @Param('garageId', uuid) garageId: string,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.invites.revoke(actor, garageId, id);
  }
}

@ApiTags('invites')
@Controller('invites')
@UseGuards(JsonOnly)
export class InvitesController {
  constructor(private readonly invites: StaffInviteService) {}

  @Public()
  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: InviteViewDto })
  @ApiNotFoundResponse({ description: 'feature_off' })
  @ApiGoneResponse({ description: 'invite_expired; invite_invalid' })
  check(@Body() body: InviteTokenDto): Promise<InviteViewDto> {
    return this.invites.check(body.token);
  }

  @ApiBearerAuth()
  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Joined; switch the session to the invited role next',
  })
  @ApiNotFoundResponse({ description: 'feature_off' })
  @ApiGoneResponse({ description: 'invite_expired; invite_invalid' })
  async accept(
    @CurrentActor() actor: Actor,
    @Body() body: InviteTokenDto,
  ): Promise<void> {
    await this.invites.accept(actor, body.token);
  }
}
