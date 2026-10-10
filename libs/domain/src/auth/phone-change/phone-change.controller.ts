import { MeDto, PhoneChangeDto, PhoneConfirmDto } from '@motor-fix/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { PhoneChangeService } from './phone-change.service';
import { CurrentActor } from '../actor.guard';
import type { Actor } from '../policy';
import { WhoAmI } from '../who-am-i';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/phone')
export class PhoneChangeController {
  constructor(
    private readonly changes: PhoneChangeService,
    private readonly view: WhoAmI,
  ) {}

  // A code by WhatsApp to the new number; the number changes once it is typed.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'The code went out by WhatsApp' })
  @ApiConflictResponse({ description: 'phone_taken, phone_unchanged' })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  @ApiServiceUnavailableResponse({ description: 'send_failed' })
  async request(
    @CurrentActor() actor: Actor,
    @Body() body: PhoneChangeDto,
  ): Promise<void> {
    await this.changes.request(actor, body.phone);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse({ description: 'code_invalid' })
  @ApiConflictResponse({ description: 'phone_taken' })
  @ApiGoneResponse({ description: 'code_expired' })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  async confirm(
    @CurrentActor() actor: Actor,
    @Body() body: PhoneConfirmDto,
  ): Promise<MeDto> {
    await this.changes.confirm(actor, body.code);
    return this.view.read(actor);
  }
}
