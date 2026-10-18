import { ReportDecisionDto, VerificationFileDto } from '@motor-fix/contracts';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ReportDecisionService } from './report-decision.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { VerificationFileService } from '../verification-file/verification-file.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/verification-files')
export class ReportDecisionController {
  constructor(
    private readonly decisions: ReportDecisionService,
    private readonly files: VerificationFileService,
  ) {}

  // The verdict on a file's open reports; the answer is the file as it now
  // stands.
  @Post(':id/report-decision')
  @HttpCode(200)
  @Requires('admin.garages')
  @ApiOkResponse({ type: VerificationFileDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no file' })
  @ApiConflictResponse({
    description:
      'verification_transition_refused: decided already (decidedBy, decidedAt, currentStatus), or in review with no open report',
  })
  @ApiUnprocessableEntityResponse({ description: 'reason_required' })
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: ReportDecisionDto,
  ): Promise<VerificationFileDto> {
    await this.decisions.decide(actor, id, body);
    return this.files.read(id);
  }
}
