import {
  JobStepDoneDto,
  JobStepDto,
  JobStepTextDto,
  ReorderJobStepsDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JobStepsService } from './job-steps.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { refusal } from '../../auth/sign-up.service';

const KEY = 'Idempotency-Key';
const uuid = () => new ParseUUIDPipe();

const FORBIDDEN = 'forbidden: the desk, or a mechanic not on this job';
const MISSING = 'not_found: not this garage’s job, or not its step';

// The owner and the job's own mechanic write a job's steps; the desk reads
// them through GET /garage/jobs/:id.
@ApiTags('garage-jobs')
@ApiBearerAuth()
@Controller('garage/jobs/:id/steps')
export class JobStepsController {
  constructor(private readonly steps: JobStepsService) {}

  @Post()
  @ApiOperation({ summary: 'Add a step at the end of the job' })
  @ApiHeader({
    description: 'One per step the person means; a repeat answers the first',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ type: JobStepDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: 'too_many_steps; job_closed' })
  add(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Headers(KEY) key: string | undefined,
    @Body() body: JobStepTextDto,
  ): Promise<JobStepDto> {
    if (!key || key.length > 64) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Idempotency-Key must hold 1 to 64 characters',
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    return this.steps.add(actor, id, key, body.text);
  }

  // Declared before the `:stepId` routes, so `order` is never read as an id.
  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Put every step of the job in a new order' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'validation_failed; not_a_permutation',
  })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: 'job_closed' })
  async reorder(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Body() body: ReorderJobStepsDto,
  ): Promise<void> {
    await this.steps.reorder(actor, id, body.stepIds);
  }

  @Patch(':stepId')
  @ApiOperation({ summary: 'Rename a step' })
  @ApiOkResponse({ type: JobStepDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: 'job_closed' })
  rename(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Param('stepId', uuid()) stepId: string,
    @Body() body: JobStepTextDto,
  ): Promise<JobStepDto> {
    return this.steps.rename(actor, id, stepId, body.text);
  }

  @Delete(':stepId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a step; the rest close the gap' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: 'job_closed' })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Param('stepId', uuid()) stepId: string,
  ): Promise<void> {
    await this.steps.remove(actor, id, stepId);
  }

  @Put(':stepId/done')
  @ApiOperation({ summary: 'Tick or untick a step; a repeat changes nothing' })
  @ApiOkResponse({ type: JobStepDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiForbiddenResponse({ description: FORBIDDEN })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiConflictResponse({ description: 'job_not_started; job_closed' })
  tick(
    @CurrentActor() actor: Actor,
    @Param('id', uuid()) id: string,
    @Param('stepId', uuid()) stepId: string,
    @Body() body: JobStepDoneDto,
  ): Promise<JobStepDto> {
    return this.steps.tick(actor, id, stepId, body.done);
  }
}
