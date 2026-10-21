import { ActiveRequestAnswerDto } from '@motor-fix/contracts';
import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ActiveRequestService } from './active-request.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('requests')
@ApiBearerAuth()
@Controller('quote-requests')
export class ActiveRequestController {
  constructor(private readonly active: ActiveRequestService) {}

  @Get('active')
  @ApiOkResponse({ type: ActiveRequestAnswerDto })
  @ApiNotFoundResponse({ description: 'not_found: not a driver' })
  get(@CurrentActor() actor: Actor): Promise<ActiveRequestAnswerDto> {
    return this.active.get(actor);
  }
}
