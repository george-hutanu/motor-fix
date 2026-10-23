import { DeleteMeDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AccountDeletionService } from './account-deletion.service';
import { CurrentActor } from '../actor.guard';
import { cookieOf, forget, JsonOnly } from '../auth.controller';
import type { Actor } from '../policy';

// Under /auth so the browser sends the session cookie, whose sign-in must
// be recent.
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/account')
export class AccountDeletionController {
  constructor(private readonly deletions: AccountDeletionService) {}

  @Delete()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Deleted; every session ended and the cookie cleared',
  })
  @ApiBadRequestResponse({
    description: 'validation_failed, also when the confirmation does not match',
  })
  @ApiUnauthorizedResponse({
    description: 'reauth_required, sign_in_required',
  })
  @ApiForbiddenResponse({ description: 'forbidden: an assistant session' })
  @ApiConflictResponse({
    description: 'deletion_not_allowed: the account owns a garage',
  })
  async deleteAccount(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: DeleteMeDto,
  ): Promise<void> {
    await this.deletions.deleteAccount(
      actor,
      cookieOf(req, 'mf_refresh'),
      body,
    );
    forget(res);
  }
}
