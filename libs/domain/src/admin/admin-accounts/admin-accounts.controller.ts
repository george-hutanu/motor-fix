import {
  AdminAccountsPageDto,
  AdminAccountsQueryDto,
  AdminAccountsSummaryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AdminAccountsService } from './admin-accounts.service';
import { FailureLog } from './failure-log';
import { Requires } from '../../auth/actor.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/accounts')
@UseInterceptors(FailureLog)
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountsPageDto })
  @ApiBadRequestResponse({
    description: 'invalid_cursor, or a query parameter it does not take',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(@Query() query: AdminAccountsQueryDto): Promise<AdminAccountsPageDto> {
    return this.accounts.page(query.cursor, new Date());
  }

  @Get('summary')
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountsSummaryDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  summary(): Promise<AdminAccountsSummaryDto> {
    return this.accounts.summary(new Date());
  }
}
