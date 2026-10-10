import { EmailChangeDto, PendingEmailDto } from '@motor-fix/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { EmailChangeService } from './email-change.service';
import { CurrentActor } from '../actor.guard';
import type { Actor } from '../policy';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/email')
export class EmailChangeController {
  constructor(private readonly changes: EmailChangeService) {}

  // A link to the new address; the address changes once it is opened.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: PendingEmailDto })
  request(
    @CurrentActor() actor: Actor,
    @Body() body: EmailChangeDto,
  ): Promise<PendingEmailDto> {
    return this.changes.request(actor, body.email);
  }
}
