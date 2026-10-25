import {
  AccessResetDto,
  AdminAccountPageDto,
  DeleteAccountOnRequestDto,
  RestoreAccountDto,
  SuspendAccountDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';

import { AccountService } from './account.service';
import { CurrentActor, Requires } from '../../../auth/actor.guard';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';

const NOT_FOUND =
  'not_found: not an admin, or no such account (unknown, malformed or deleted id)';
const ADMIN = 'admin_account: the account holds admin';

// A malformed id is an account that does not exist, as an unknown one is.
function accountId(id: string) {
  if (!isUUID(id)) {
    throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such account');
  }
  return id;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get(':id')
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountPageDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  read(@Param('id') id: string): Promise<AdminAccountPageDto> {
    return this.accounts.read(accountId(id));
  }

  @Post(':id/reset-access')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.users')
  @ApiOkResponse({ type: AccessResetDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: ADMIN })
  resetAccess(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
  ): Promise<AccessResetDto> {
    return this.accounts.resetAccess(accountId(id), actor);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountPageDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a reason under 10 or over 500 characters',
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({
    description: `${ADMIN}; account_already_suspended`,
  })
  suspend(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @Body() body: SuspendAccountDto,
  ): Promise<AdminAccountPageDto> {
    return this.accounts.suspend(accountId(id), actor, body.reason);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountPageDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: a note over 500 characters',
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: `${ADMIN}; account_not_suspended` })
  restore(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @Body() body: RestoreAccountDto,
  ): Promise<AdminAccountPageDto> {
    return this.accounts.restore(accountId(id), actor, body.note || undefined);
  }

  @Post(':id/delete-on-request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requires('admin.users')
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a reference not like DR-2026-0001, a date after today, or identity not checked',
  })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({
    description: `${ADMIN}; deletion_not_allowed: the account owns a garage`,
  })
  deleteOnRequest(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @Body() body: DeleteAccountOnRequestDto,
  ): Promise<void> {
    return this.accounts.deleteOnRequest(accountId(id), actor, {
      receivedOn: body.receivedOn,
      reference: body.reference,
    });
  }
}
