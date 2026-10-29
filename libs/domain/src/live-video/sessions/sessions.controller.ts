import {
  LiveRecordingKeepDto,
  LiveSessionStartedDto,
  LiveSessionStoppedDto,
  LiveStopRequestDto,
  LiveViewCredentialDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { LiveSessionsService } from './sessions.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('live-sessions')
@ApiBearerAuth()
@Controller()
export class LiveSessionsController {
  constructor(private readonly sessions: LiveSessionsService) {}

  @Post('jobs/:id/live')
  @ApiOperation({ summary: 'Go live on a job, video only' })
  @ApiCreatedResponse({ type: LiveSessionStartedDto })
  @ApiBadRequestResponse({ description: 'The job id is not a uuid' })
  @ApiNotFoundResponse({
    description:
      'not_found: no such job, another garage’s, live media off, or not the owner or the job’s mechanic',
  })
  @ApiConflictResponse({ description: 'live_already_on or job_closed' })
  @ApiServiceUnavailableResponse({
    description: 'live_unavailable: send photos and clips instead',
  })
  start(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) jobId: string,
  ): Promise<LiveSessionStartedDto> {
    return this.sessions.start(actor, jobId);
  }

  @Post('live-sessions/:id/view-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A short-lived link to watch a live session' })
  @ApiOkResponse({ type: LiveViewCredentialDto })
  @ApiBadRequestResponse({ description: 'The session id is not a uuid' })
  @ApiNotFoundResponse({
    description:
      'not_found: no such session, live media off, or not the job’s driver, owner or mechanic',
  })
  @ApiConflictResponse({ description: 'live_ended' })
  @ApiServiceUnavailableResponse({
    description: 'live_unavailable: the link cannot be signed now',
  })
  view(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LiveViewCredentialDto> {
    return this.sessions.view(actor, id);
  }

  @Patch('live-sessions/:id/recording')
  @ApiOperation({ summary: 'Keep or discard the recording while live' })
  @ApiOkResponse({ type: LiveRecordingKeepDto })
  @ApiBadRequestResponse({
    description: 'The session id is not a uuid, or keep is not a boolean',
  })
  @ApiNotFoundResponse({
    description:
      'not_found: no such session, live media off, or not the owner or the job’s mechanic',
  })
  @ApiConflictResponse({ description: 'live_ended' })
  setKeep(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: LiveRecordingKeepDto,
  ): Promise<LiveRecordingKeepDto> {
    return this.sessions.setKeep(actor, id, body);
  }

  @Post('live-sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop the live stream, keeping or discarding it' })
  @ApiOkResponse({ type: LiveSessionStoppedDto })
  @ApiBadRequestResponse({
    description: 'The session id is not a uuid, or keep is not a boolean',
  })
  @ApiNotFoundResponse({
    description:
      'not_found: no such session, live media off, or not the owner or the job’s mechanic',
  })
  @ApiConflictResponse({ description: 'live_ended' })
  stop(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: LiveStopRequestDto,
  ): Promise<LiveSessionStoppedDto> {
    return this.sessions.stop(actor, id, body);
  }
}
