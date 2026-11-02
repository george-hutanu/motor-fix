import {
  BasedOnUpdatedAtDto,
  FinalPriceDto,
  JobDto,
  ReceiveJobDto,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JobStagesService } from './job-stages.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

const uuid = () => new ParseUUIDPipe();

const FORBIDDEN = 'forbidden: the desk, or a mechanic not on this job';
const MISSING = 'not_found: not this garage’s job';
const MOVED = 'invalid_transition (with currentStatus)';
const LOCKED = 'job_locked (with holder): another person holds the job';
const UNAVAILABLE = 'try_again: the lock store is unreachable';
const PRICED = 'forbidden: a mechanic; the owner and the desk record the price';

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
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({
    description: `job_changed (with job); not_received; ${MOVED}`,
  })
  start(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: BasedOnUpdatedAtDto,
  ) {
    return this.stages.move(actor, id, 'start', body?.basedOnUpdatedAt);
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause the work' })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({ description: `job_changed (with job); ${MOVED}` })
  pause(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: BasedOnUpdatedAtDto,
  ) {
    return this.stages.move(actor, id, 'pause', body?.basedOnUpdatedAt);
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume the work, pausing the mechanic’s other job in work',
  })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({ description: `job_changed (with job); ${MOVED}` })
  resume(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: BasedOnUpdatedAtDto,
  ) {
    return this.stages.move(actor, id, 'resume', body?.basedOnUpdatedAt);
  }

  @Post('finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the work done' })
  @ApiOkResponse({ type: JobDto })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({
    description: `job_changed (with job); job_not_started; ${MOVED}`,
  })
  finish(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: BasedOnUpdatedAtDto,
  ) {
    return this.stages.move(actor, id, 'finish', body?.basedOnUpdatedAt);
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
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({
    description: 'job_changed (with job); job_closed; invalid_state',
  })
  receive(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: ReceiveJobDto,
  ) {
    return this.stages.receive(
      actor,
      id,
      body.odometerKm,
      body.basedOnUpdatedAt,
    );
  }

  @Post('handover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Hand the car over: record the final price, completing the booking',
  })
  @ApiOkResponse({ type: JobDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: PRICED })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({
    description: `job_changed (with job); job_not_done; already_handed_over (with finalPriceBani); ${MOVED} of the booking`,
  })
  handover(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: FinalPriceDto,
  ) {
    return this.stages.handover(
      actor,
      id,
      body.finalPriceBani,
      body.basedOnUpdatedAt,
    );
  }

  @Patch('final-price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Correct the final price, within 48 hours of the handover',
  })
  @ApiOkResponse({ type: JobDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: PRICED })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiResponse({ description: LOCKED, status: HttpStatus.LOCKED })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  @ApiConflictResponse({
    description:
      'job_changed (with job); not_handed_over; correction_window_closed',
  })
  correct(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: FinalPriceDto,
  ) {
    return this.stages.correct(
      actor,
      id,
      body.finalPriceBani,
      body.basedOnUpdatedAt,
    );
  }
}
