import { JobDto, ReceiveJobDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JobStagesService } from './job-stages.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

const uuid = () => new ParseUUIDPipe();

const FORBIDDEN = 'forbidden: the desk, or a mechanic not on this job';
const MISSING = 'not_found: not this garage’s job';
const MOVED = 'invalid_transition (with currentStatus)';

// The owner and the job's own mechanic move a job through its stages; the
// desk also records the reception. Each answers the job as the garage reads it.
@ApiTags('garage-jobs')
@ApiBearerAuth()
@Controller('garage/jobs/:id')
export class JobStagesController {
  constructor(private readonly stages: JobStagesService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the work, pausing the mechanic’s other job in work',
  })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: `not_received; ${MOVED}` })
  start(@CurrentActor() actor: Actor, @Param('id', uuid()) id: string) {
    return this.stages.move(actor, id, 'start');
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause the work' })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: MOVED })
  pause(@CurrentActor() actor: Actor, @Param('id', uuid()) id: string) {
    return this.stages.move(actor, id, 'pause');
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume the work, pausing the mechanic’s other job in work',
  })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: MOVED })
  resume(@CurrentActor() actor: Actor, @Param('id', uuid()) id: string) {
    return this.stages.move(actor, id, 'resume');
  }

  @Post('finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the work done' })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: `job_not_started; ${MOVED}` })
  finish(@CurrentActor() actor: Actor, @Param('id', uuid()) id: string) {
    return this.stages.move(actor, id, 'finish');
  }

  @Post('receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record the odometer at the reception; a repeat corrects it',
  })
  @ApiOkResponse({ type: JobDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({
    description: 'forbidden: a mechanic not on this job',
  })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: 'job_closed; invalid_state' })
  receive(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: ReceiveJobDto,
  ) {
    return this.stages.receive(actor, id, body.odometerKm);
  }
}
