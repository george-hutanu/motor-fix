import { PasswordChangeDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { PasswordChangeService } from './password-change.service';
import { CurrentActor } from '../../actor.guard';
import { cookieOf, JsonOnly } from '../../auth.controller';
import type { Actor } from '../../policy';

// Under /auth so the browser sends the session cookie, which names the
// session that stays signed in.
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/password')
export class PasswordChangeController {
  constructor(private readonly changes: PasswordChangeService) {}

  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Changed or set; every other session ended',
  })
  @ApiBadRequestResponse({ description: 'weak_password, validation_failed' })
  @ApiUnauthorizedResponse({
    description: 'invalid_credentials, sign_in_required',
  })
  @ApiForbiddenResponse({ description: 'recent_sign_in_required' })
  @ApiConflictResponse({ description: 'email_required' })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  async change(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Body() body: PasswordChangeDto,
  ): Promise<void> {
    await this.changes.change(actor, cookieOf(req, 'mf_refresh'), body);
  }
}
