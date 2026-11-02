import { JobLockTakenDto, TakeJobLockDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JobLockService } from './job-lock.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

const MISSING = 'not_found: not this garage’s job';
const UNAVAILABLE = 'try_again: the lock store is unreachable; nothing changed';

// The first person who opens a job to change it holds it until their change,
// a release, the owner's force or five idle minutes.
@ApiTags('garage-jobs')
@ApiBearerAuth()
@Controller('garage/jobs/:id/lock')
export class JobLockController {
  constructor(private readonly locks: JobLockService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take the job, or refresh the caller’s own lock' })
  @ApiBody({ required: false, type: TakeJobLockDto })
  @ApiOkResponse({ type: JobLockTakenDto })
  @ApiForbiddenResponse({
    description:
      'forbidden: a mechanic not on this job; the desk for anything but reception or handover',
  })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiResponse({
    description: 'job_locked (with holder)',
    status: HttpStatus.LOCKED,
  })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  take(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TakeJobLockDto,
  ) {
    return this.locks.take(actor, id, body?.purpose);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Release the caller’s lock; the owner forces another’s',
  })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  @ApiNoContentResponse({ description: 'Released, or nothing to release' })
  @ApiForbiddenResponse({
    description: 'forbidden: force by anyone but the owner',
  })
  @ApiNotFoundResponse({ description: MISSING })
  @ApiServiceUnavailableResponse({ description: UNAVAILABLE })
  release(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('force', new ParseBoolPipe({ optional: true })) force?: boolean,
  ) {
    return this.locks.release(actor, id, force ?? false);
  }
}
